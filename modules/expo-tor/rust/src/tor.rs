//! Embedded Arti client lifecycle: bootstrap, expose a SOCKS port, shut down.

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use arti_client::config::BridgeConfigBuilder;
use arti_client::{TorClient, TorClientConfig};
use tokio::runtime::Runtime;
use tor_rtcompat::PreferredRuntime;

use crate::socks::{BoxedStream, ConnectFuture, Connector};

/// Bootstrap state, kept as a plain integer so the FFI layer can read it
/// without locking or allocating.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TorState {
    Stopped = 0,
    Starting = 1,
    Running = 2,
    Failed = 3,
}

impl From<u8> for TorState {
    fn from(v: u8) -> Self {
        match v {
            1 => TorState::Starting,
            2 => TorState::Running,
            3 => TorState::Failed,
            _ => TorState::Stopped,
        }
    }
}

/// Routes SOCKS requests onto Tor circuits.
///
/// `TorClient` is deliberately not `Clone` in Arti — cloning would silently
/// share one client's circuit isolation — so it is held behind an `Arc` and
/// `create_bootstrapped` hands one back already wrapped.
///
/// # Circuit isolation
///
/// Streams opened by one `TorClient` may share a circuit, which means one exit
/// relay sees them together. For ordinary browsing that is a performance win.
/// For this app it is a linkability bug: two reports submitted from the same
/// device would arrive at the same exit, at a known interval, on one circuit —
/// enough to conclude they came from one person even though each is
/// individually anonymous. The entity-tag and sponsor designs elsewhere in this
/// project go to some trouble to avoid exactly that inference; leaving the
/// transport to reintroduce it would waste the effort.
///
/// `isolated_client()` mints a client with a fresh isolation token, whose
/// streams will not share circuits with any other isolated client's. Rotating
/// it between submissions is what [`TorService::new_circuit`] does.
struct TorConnector {
    /// Long-lived client. Never used for traffic directly — only to mint
    /// isolated children, so every stream belongs to some isolation group.
    base: Arc<TorClient<PreferredRuntime>>,
    current: RwLock<Arc<TorClient<PreferredRuntime>>>,
}

impl TorConnector {
    fn new(base: Arc<TorClient<PreferredRuntime>>) -> Self {
        let first = base.isolated_client();
        Self {
            base,
            current: RwLock::new(first),
        }
    }

    /// Move to a fresh isolation group. Subsequent streams take new circuits.
    fn rotate(&self) {
        let next = self.base.isolated_client();
        if let Ok(mut slot) = self.current.write() {
            *slot = next;
        }
    }

    fn client(&self) -> Arc<TorClient<PreferredRuntime>> {
        match self.current.read() {
            Ok(guard) => Arc::clone(&guard),
            // Poisoned only if a rotate panicked mid-write. Falling back to the
            // base client keeps traffic flowing over Tor, which matters more
            // than the isolation guarantee we just lost.
            Err(poisoned) => Arc::clone(&poisoned.into_inner()),
        }
    }
}

impl Connector for TorConnector {
    fn connect(&self, host: &str, port: u16) -> ConnectFuture {
        let client = self.client();
        // The hostname is handed to Arti as a name. Arti resolves it inside the
        // network via the exit relay, so no DNS query leaves this device.
        let target = (host.to_string(), port);

        Box::pin(async move {
            let stream = client
                .connect(target)
                .await
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
            Ok(Box::new(stream) as BoxedStream)
        })
    }
}

/// The running embedded Tor, or the absence of one.
pub struct TorService {
    runtime: Mutex<Option<Runtime>>,
    connector: Mutex<Option<Arc<TorConnector>>>,
    state: AtomicU8,
    socks_port: AtomicU16,
    last_error: Mutex<Option<String>>,
}

impl Default for TorService {
    fn default() -> Self {
        Self::new()
    }
}

impl TorService {
    pub const fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
            connector: Mutex::new(None),
            state: AtomicU8::new(TorState::Stopped as u8),
            socks_port: AtomicU16::new(0),
            last_error: Mutex::new(None),
        }
    }

    pub fn state(&self) -> TorState {
        TorState::from(self.state.load(Ordering::SeqCst))
    }

    pub fn socks_port(&self) -> u16 {
        self.socks_port.load(Ordering::SeqCst)
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error.lock().ok().and_then(|g| g.clone())
    }

    /// Boot Arti and start the loopback SOCKS proxy.
    ///
    /// Blocks until bootstrap completes, which on a mobile network is routinely
    /// 10–60 seconds — the caller must run this off the UI thread and show
    /// progress. Returns the SOCKS port.
    ///
    /// `cache_dir` and `state_dir` must be inside the app's private storage.
    /// Arti keeps the consensus and directory data there; on shared storage it
    /// would be readable by other apps, and the set of guards it records is
    /// linkable across sessions.
    ///
    /// `bridges` is a newline-separated list of vanilla Tor bridge lines.
    /// Empty means connect to the public network (the old behaviour). See
    /// [`parse_bridge_lines`] for what is accepted and what is refused.
    pub fn start(
        &self,
        cache_dir: PathBuf,
        state_dir: PathBuf,
        bridges: &str,
    ) -> Result<u16, String> {
        if self.state() == TorState::Running {
            return Ok(self.socks_port());
        }

        self.state.store(TorState::Starting as u8, Ordering::SeqCst);
        self.set_error(None);

        let runtime = match Runtime::new() {
            Ok(rt) => rt,
            Err(e) => return Err(self.fail(format!("could not create async runtime: {e}"))),
        };

        let bridges = bridges.to_owned();
        let result = runtime.block_on(async move {
            let config = build_config(cache_dir, state_dir, &bridges)?;

            let client = TorClient::create_bootstrapped(config)
                .await
                .map_err(|e| format!("Tor bootstrap failed: {e}"))?;

            let connector = Arc::new(TorConnector::new(client));
            let (port, _handle) = crate::socks::serve(Arc::clone(&connector) as Arc<dyn Connector>, 0)
                .await
                .map_err(|e| format!("could not start SOCKS listener: {e}"))?;

            Ok::<(u16, Arc<TorConnector>), String>((port, connector))
        });

        match result {
            Ok((port, connector)) => {
                if let Ok(mut slot) = self.connector.lock() {
                    *slot = Some(connector);
                }
                self.socks_port.store(port, Ordering::SeqCst);
                self.state.store(TorState::Running as u8, Ordering::SeqCst);
                // Held so the runtime — and with it the SOCKS listener and every
                // circuit — outlives this call. Dropping it stops Tor.
                if let Ok(mut slot) = self.runtime.lock() {
                    *slot = Some(runtime);
                }
                Ok(port)
            }
            Err(e) => Err(self.fail(e)),
        }
    }

    /// Stop Tor and drop every circuit.
    ///
    /// Dropping the runtime aborts the SOCKS listener and all in-flight
    /// streams. In-flight requests fail rather than silently completing over a
    /// direct connection, which is the correct failure mode: a request the user
    /// asked to be anonymised must never quietly become one that is not.
    pub fn stop(&self) {
        if let Ok(mut slot) = self.connector.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.runtime.lock() {
            if let Some(runtime) = slot.take() {
                runtime.shutdown_background();
            }
        }
        self.socks_port.store(0, Ordering::SeqCst);
        self.state.store(TorState::Stopped as u8, Ordering::SeqCst);
    }

    /// Move subsequent traffic onto fresh circuits.
    ///
    /// Call this between actions the user would not want linked — the app calls
    /// it before each report submission. Two reports that share a circuit share
    /// an exit relay and a timing pattern, which is enough to infer they came
    /// from one person even though each is individually anonymous.
    ///
    /// Cheap: it only mints a new isolation token. The circuit itself is built
    /// lazily on the next connection, so the cost lands on that request rather
    /// than here.
    ///
    /// Returns false when Tor is not running, so a caller that requires
    /// isolation can refuse to proceed rather than assume it got it.
    pub fn new_circuit(&self) -> bool {
        match self.connector.lock() {
            Ok(slot) => match slot.as_ref() {
                Some(connector) => {
                    connector.rotate();
                    true
                }
                None => false,
            },
            Err(_) => false,
        }
    }

    fn fail(&self, message: String) -> String {
        self.state.store(TorState::Failed as u8, Ordering::SeqCst);
        self.set_error(Some(message.clone()));
        message
    }

    fn set_error(&self, message: Option<String>) {
        if let Ok(mut slot) = self.last_error.lock() {
            *slot = message;
        }
    }
}

/// Transports this build cannot run. Arti can parse these lines, but
/// connecting through them needs an external pluggable-transport binary
/// (lyrebird, snowflake-client) that we do not ship. Refusing here is
/// better than letting bootstrap hang and then fail with an opaque error.
const UNSUPPORTED_PTS: &[&str] = &[
    "obfs4",
    "obfs3",
    "snowflake",
    "meek",
    "meek_lite",
    "webtunnel",
    "scramblesuit",
];

/// Parse a paste of bridge lines into Arti builders.
///
/// Accepts the same text a user copies from bridges.torproject.org:
/// blank lines and `#` comments are ignored, a leading `Bridge ` is
/// optional. Vanilla lines (`ip:port fingerprint`) are accepted.
/// Lines that name a pluggable transport are refused with the transport
/// in the error, so the UI can say exactly what this build cannot do.
pub fn parse_bridge_lines(raw: &str) -> Result<Vec<BridgeConfigBuilder>, String> {
    let mut out = Vec::new();
    for (i, raw_line) in raw.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line
            .strip_prefix("Bridge ")
            .or_else(|| line.strip_prefix("bridge "))
            .unwrap_or(line)
            .trim();

        if let Some(pt) = first_token_is_pt(line) {
            return Err(format!(
                "bridge line {} uses the `{pt}` transport. This build can only use vanilla bridges (an IP, a port, and a fingerprint). `{pt}` needs a pluggable-transport binary we do not ship yet.",
                i + 1
            ));
        }

        let parsed: BridgeConfigBuilder = line.parse().map_err(|e| {
            format!(
                "bridge line {} is not a valid vanilla bridge: {e}",
                i + 1
            )
        })?;
        out.push(parsed);
    }
    Ok(out)
}

fn first_token_is_pt(line: &str) -> Option<&str> {
    let token = line.split_whitespace().next()?;
    UNSUPPORTED_PTS
        .iter()
        .copied()
        .find(|pt| token.eq_ignore_ascii_case(pt))
}

fn build_config(
    cache_dir: PathBuf,
    state_dir: PathBuf,
    bridges: &str,
) -> Result<TorClientConfig, String> {
    let mut builder = TorClientConfig::builder();
    builder
        .storage()
        .cache_dir(arti_client::config::CfgPath::new_literal(cache_dir))
        .state_dir(arti_client::config::CfgPath::new_literal(state_dir));

    let parsed = parse_bridge_lines(bridges)?;
    if !parsed.is_empty() {
        // Auto: use bridges because they are configured. We do not have a
        // separate "force bridges" switch — if the user pasted lines, those
        // are the only way this client is allowed onto the network.
        for bridge in parsed {
            builder.bridges().bridges().push(bridge);
        }
    }

    builder.build().map_err(|e| format!("invalid Tor config: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_stopped() {
        let service = TorService::new();
        assert_eq!(service.state(), TorState::Stopped);
        assert_eq!(service.socks_port(), 0);
        assert!(service.last_error().is_none());
    }

    #[test]
    fn state_round_trips_through_the_ffi_integer() {
        // The FFI hands this across as a u8; an unknown value must degrade to
        // Stopped rather than being read as Running.
        for state in [
            TorState::Stopped,
            TorState::Starting,
            TorState::Running,
            TorState::Failed,
        ] {
            assert_eq!(TorState::from(state as u8), state);
        }
        assert_eq!(TorState::from(99), TorState::Stopped);
    }

    #[test]
    fn stop_is_idempotent_and_clears_the_port() {
        let service = TorService::new();
        service.socks_port.store(9150, Ordering::SeqCst);
        service.state.store(TorState::Running as u8, Ordering::SeqCst);

        service.stop();
        service.stop();

        assert_eq!(service.state(), TorState::Stopped);
        assert_eq!(service.socks_port(), 0);
    }

    #[test]
    fn new_circuit_reports_failure_when_tor_is_not_running() {
        // A caller that needs isolation must be able to tell it did not get it,
        // rather than proceeding on the assumption that it did.
        let service = TorService::new();
        assert!(!service.new_circuit());
    }

    #[test]
    fn config_accepts_private_directories() {
        let dir = std::env::temp_dir().join("khabardar-tor-test");
        let config = build_config(dir.join("cache"), dir.join("state"), "");
        assert!(config.is_ok(), "config error: {:?}", config.err());
    }

    #[test]
    fn empty_and_comments_are_not_bridges() {
        let parsed = parse_bridge_lines("\n# a comment\n  \n").unwrap();
        assert!(parsed.is_empty());
    }

    #[test]
    fn vanilla_bridge_line_parses() {
        // Fictitious address. We only check that Arti accepts the syntax;
        // we do not connect.
        let line = "192.0.2.55:443 7DD62766BF2052432051D7B7E08A22F7E34A4543";
        let parsed = parse_bridge_lines(line).unwrap();
        assert_eq!(parsed.len(), 1);
        assert!(
            parsed[0]
                .get_transport()
                .map(|t| t.is_empty() || t == "bridge" || t == "-")
                .unwrap_or(true)
        );
    }

    #[test]
    fn bridge_prefix_is_optional() {
        let line = "Bridge 192.0.2.55:443 7DD62766BF2052432051D7B7E08A22F7E34A4543";
        assert_eq!(parse_bridge_lines(line).unwrap().len(), 1);
    }

    #[test]
    fn obfs4_is_refused_with_the_transport_named() {
        let line = "obfs4 192.0.2.55:38114 7DD62766BF2052432051D7B7E08A22F7E34A4543 cert=abcd iat-mode=0";
        let err = parse_bridge_lines(line).unwrap_err();
        assert!(err.contains("obfs4"), "error should name the transport: {err}");
        assert!(err.contains("do not ship"), "error should be honest about why: {err}");
    }

    #[test]
    fn snowflake_is_refused() {
        let err = parse_bridge_lines("snowflake 192.0.2.55:443 fingerprint").unwrap_err();
        assert!(err.contains("snowflake"));
    }

    #[test]
    fn config_with_a_vanilla_bridge_builds() {
        let dir = std::env::temp_dir().join("khabardar-tor-bridge-test");
        let line = "192.0.2.55:443 7DD62766BF2052432051D7B7E08A22F7E34A4543";
        let config = build_config(dir.join("cache"), dir.join("state"), line);
        assert!(config.is_ok(), "config error: {:?}", config.err());
    }
}
