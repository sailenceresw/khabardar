//! Minimal SOCKS5 CONNECT server bound to loopback.
//!
//! # Why a SOCKS proxy rather than speaking HTTP over Arti directly
//!
//! `arti-client` gives us a `DataStream` to an arbitrary host:port, so we could
//! write HTTP onto it ourselves. We deliberately do not, because that would
//! also mean owning TLS, certificate validation, HTTP/2, redirects, and
//! connection pooling in Rust — reimplementing the platform's HTTP stack, badly,
//! in the one place where a mistake silently costs a user their anonymity.
//!
//! Instead we expose a standard SOCKS5 proxy on loopback and point OkHttp
//! (Android) and `URLSession` (iOS) at it. Both speak SOCKS5 natively, and both
//! keep their own audited TLS. The proxy is bound to 127.0.0.1 on an ephemeral
//! port, so nothing outside this process can reach it.
//!
//! # The DNS leak, which is the whole reason to be careful here
//!
//! The classic way to leak while "using Tor" is to resolve the hostname
//! locally and hand the proxy an IP: the traffic is anonymised, and the DNS
//! query that says exactly where you are going is not. SOCKS5 has an address
//! type for domain names (`ATYP=0x03`) precisely so the proxy resolves instead.
//!
//! This server therefore passes domain names through to Arti untouched and
//! never calls a resolver itself. The client side has to cooperate — see the
//! notes in the Kotlin and Swift modules about keeping addresses unresolved.

use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const SOCKS_VERSION: u8 = 0x05;
const METHOD_NO_AUTH: u8 = 0x00;
const METHOD_UNACCEPTABLE: u8 = 0xFF;
const CMD_CONNECT: u8 = 0x01;

const ATYP_IPV4: u8 = 0x01;
const ATYP_DOMAIN: u8 = 0x03;
const ATYP_IPV6: u8 = 0x04;

const REP_SUCCESS: u8 = 0x00;
const REP_GENERAL_FAILURE: u8 = 0x01;
const REP_CMD_NOT_SUPPORTED: u8 = 0x07;
const REP_ATYP_NOT_SUPPORTED: u8 = 0x08;

/// A duplex byte stream. `arti_client::DataStream` and `tokio::net::TcpStream`
/// both satisfy this, which is what lets the protocol logic below be tested
/// against plain TCP with no Tor network involved.
pub trait DuplexStream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> DuplexStream for T {}

pub type BoxedStream = Box<dyn DuplexStream>;
pub type ConnectFuture = Pin<Box<dyn Future<Output = io::Result<BoxedStream>> + Send>>;

/// Opens an outbound stream on behalf of a SOCKS client.
///
/// The host is passed as the client supplied it — a domain name stays a domain
/// name. An implementation that resolves it locally reintroduces the DNS leak
/// this whole design exists to avoid.
pub trait Connector: Send + Sync + 'static {
    fn connect(&self, host: &str, port: u16) -> ConnectFuture;
}

/// Direct TCP, for tests and for nothing else.
///
/// Never wire this into the app: it defeats the entire purpose, and it is
/// `pub` only so the protocol tests can exercise the server without carrying a
/// dependency on a live Tor network.
pub struct DirectConnector;

impl Connector for DirectConnector {
    fn connect(&self, host: &str, port: u16) -> ConnectFuture {
        let target = format!("{host}:{port}");
        Box::pin(async move {
            let stream = TcpStream::connect(target).await?;
            Ok(Box::new(stream) as BoxedStream)
        })
    }
}

/// Bind a SOCKS5 listener on loopback and serve until the task is dropped.
///
/// Returns the bound port. Port 0 asks the OS for an ephemeral one, which is
/// what production uses — a fixed, predictable port is one more thing another
/// app on the device could find and use as an open proxy.
pub async fn serve(
    connector: Arc<dyn Connector>,
    port: u16,
) -> io::Result<(u16, tokio::task::JoinHandle<()>)> {
    // Loopback only. Binding 0.0.0.0 here would turn the phone into an open
    // Tor proxy for anything on the same network.
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await?;
    let bound = listener.local_addr()?.port();

    let handle = tokio::spawn(async move {
        loop {
            let (client, _peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(e) => {
                    tracing::warn!("socks accept failed: {e}");
                    continue;
                }
            };

            let connector = Arc::clone(&connector);
            tokio::spawn(async move {
                if let Err(e) = handle_client(client, connector).await {
                    // Expected constantly in normal use — clients hang up.
                    tracing::debug!("socks session ended: {e}");
                }
            });
        }
    });

    Ok((bound, handle))
}

async fn handle_client(mut client: TcpStream, connector: Arc<dyn Connector>) -> io::Result<()> {
    negotiate_auth(&mut client).await?;

    let (host, port) = match read_request(&mut client).await {
        Ok(target) => target,
        Err(RequestError::Io(e)) => return Err(e),
        Err(RequestError::Rejected(code)) => return reject(&mut client, code).await,
    };

    let upstream = match connector.connect(&host, port).await {
        Ok(stream) => stream,
        Err(e) => {
            tracing::debug!("tor connect to {host}:{port} failed: {e}");
            return reject(&mut client, REP_GENERAL_FAILURE).await;
        }
    };

    write_reply(&mut client, REP_SUCCESS).await?;

    // Splice until either side closes.
    let (mut client_read, mut client_write) = tokio::io::split(client);
    let (mut up_read, mut up_write) = tokio::io::split(upstream);

    let up = async { tokio::io::copy(&mut client_read, &mut up_write).await };
    let down = async { tokio::io::copy(&mut up_read, &mut client_write).await };

    tokio::select! {
        r = up => { r?; }
        r = down => { r?; }
    }

    Ok(())
}

async fn negotiate_auth(client: &mut TcpStream) -> io::Result<()> {
    let mut header = [0u8; 2];
    client.read_exact(&mut header).await?;

    if header[0] != SOCKS_VERSION {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unsupported SOCKS version {}", header[0]),
        ));
    }

    let mut methods = vec![0u8; header[1] as usize];
    client.read_exact(&mut methods).await?;

    // No authentication: the listener is loopback-only and single-process, so a
    // credential here would protect nothing and only add a way to misconfigure.
    if !methods.contains(&METHOD_NO_AUTH) {
        client.write_all(&[SOCKS_VERSION, METHOD_UNACCEPTABLE]).await?;
        client.flush().await?;
        let _ = client.shutdown().await;
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "client offered no acceptable auth method",
        ));
    }

    client.write_all(&[SOCKS_VERSION, METHOD_NO_AUTH]).await?;
    Ok(())
}

enum RequestError {
    Io(io::Error),
    /// Protocol-level refusal; the code is sent back to the client.
    Rejected(u8),
}

impl From<io::Error> for RequestError {
    fn from(e: io::Error) -> Self {
        RequestError::Io(e)
    }
}

async fn read_request(client: &mut TcpStream) -> Result<(String, u16), RequestError> {
    let mut head = [0u8; 4];
    client.read_exact(&mut head).await?;

    if head[0] != SOCKS_VERSION {
        return Err(RequestError::Rejected(REP_GENERAL_FAILURE));
    }
    if head[1] != CMD_CONNECT {
        // BIND and UDP ASSOCIATE are not meaningful over Tor circuits.
        return Err(RequestError::Rejected(REP_CMD_NOT_SUPPORTED));
    }

    let host = match head[3] {
        // Kept as a literal string; Arti treats it as an address, no lookup.
        ATYP_IPV4 => {
            let mut octets = [0u8; 4];
            client.read_exact(&mut octets).await?;
            format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], octets[3])
        }
        // The path that matters: the name travels to Arti and is resolved
        // inside the Tor network, so no local DNS query is ever made.
        ATYP_DOMAIN => {
            let mut len = [0u8; 1];
            client.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            client.read_exact(&mut name).await?;
            String::from_utf8(name).map_err(|_| RequestError::Rejected(REP_GENERAL_FAILURE))?
        }
        ATYP_IPV6 => {
            let mut octets = [0u8; 16];
            client.read_exact(&mut octets).await?;
            let addr = std::net::Ipv6Addr::from(octets);
            addr.to_string()
        }
        _ => return Err(RequestError::Rejected(REP_ATYP_NOT_SUPPORTED)),
    };

    let mut port_bytes = [0u8; 2];
    client.read_exact(&mut port_bytes).await?;
    let port = u16::from_be_bytes(port_bytes);

    Ok((host, port))
}

/// Send an error reply and close the connection cleanly.
///
/// The subtlety worth writing down: a rejected request usually has bytes we
/// never read — an unsupported address type has an address after it, a BIND
/// request has a target — and closing a socket that still holds unread data
/// makes the OS send RST rather than FIN. RST discards anything already queued
/// for transmission, so the client sees a bare connection reset instead of the
/// error code we carefully chose, and cannot tell "unsupported command" from
/// "the proxy died".
///
/// So: reply, flush, drain what the client already sent, then close the write
/// side gracefully.
async fn reject(client: &mut TcpStream, code: u8) -> io::Result<()> {
    write_reply(client, code).await?;
    client.flush().await?;

    // Bounded: enough to clear a request already in flight, capped so a client
    // that keeps talking cannot hold this task open.
    let mut sink = [0u8; 512];
    for _ in 0..8 {
        match tokio::time::timeout(Duration::from_millis(50), client.read(&mut sink)).await {
            Ok(Ok(n)) if n > 0 => continue,
            _ => break,
        }
    }

    let _ = client.shutdown().await;
    Ok(())
}

async fn write_reply(client: &mut TcpStream, code: u8) -> io::Result<()> {
    // BND.ADDR/BND.PORT are reported as 0.0.0.0:0. Clients ignore them for
    // CONNECT, and reporting the real local address would hand out information
    // about the device for no benefit.
    client
        .write_all(&[SOCKS_VERSION, code, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    /// Stand up an echo server, a SOCKS5 proxy in front of it, and drive the
    /// protocol by hand. Exercises the exact byte sequence a real client sends.
    async fn echo_server() -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    while let Ok(n) = sock.read(&mut buf).await {
                        if n == 0 || sock.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });
        (addr, handle)
    }

    async fn connect_through_proxy(proxy_port: u16, atyp: u8, host: &str, port: u16) -> (TcpStream, u8) {
        let mut client = TcpStream::connect(("127.0.0.1", proxy_port)).await.unwrap();

        // Greeting: version 5, one method, no-auth.
        client.write_all(&[SOCKS_VERSION, 1, METHOD_NO_AUTH]).await.unwrap();
        let mut greeting = [0u8; 2];
        client.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [SOCKS_VERSION, METHOD_NO_AUTH]);

        let mut req = vec![SOCKS_VERSION, CMD_CONNECT, 0x00, atyp];
        match atyp {
            ATYP_DOMAIN => {
                req.push(host.len() as u8);
                req.extend_from_slice(host.as_bytes());
            }
            ATYP_IPV4 => {
                for part in host.split('.') {
                    req.push(part.parse().unwrap());
                }
            }
            _ => panic!("unsupported atyp in test helper"),
        }
        req.extend_from_slice(&port.to_be_bytes());
        client.write_all(&req).await.unwrap();

        let mut reply = [0u8; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[0], SOCKS_VERSION);
        (client, reply[1])
    }

    #[tokio::test]
    async fn proxies_a_connection_by_ip() {
        let (echo, _echo_task) = echo_server().await;
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();

        let (mut client, rep) =
            connect_through_proxy(port, ATYP_IPV4, "127.0.0.1", echo.port()).await;
        assert_eq!(rep, REP_SUCCESS);

        client.write_all(b"khabardar").await.unwrap();
        let mut buf = [0u8; 9];
        client.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"khabardar");
    }

    #[tokio::test]
    async fn proxies_a_connection_by_domain_name() {
        // The property that matters: a hostname is accepted and forwarded, so
        // the client never has to resolve it and never leaks a DNS query.
        let (echo, _echo_task) = echo_server().await;
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();

        let (mut client, rep) =
            connect_through_proxy(port, ATYP_DOMAIN, "localhost", echo.port()).await;
        assert_eq!(rep, REP_SUCCESS);

        client.write_all(b"by-name").await.unwrap();
        let mut buf = [0u8; 7];
        client.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"by-name");
    }

    #[tokio::test]
    async fn binds_loopback_only() {
        // Binding a wildcard address would make the device an open Tor proxy
        // for anything else on the network.
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();
        let listener = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))).await;
        assert!(
            listener.is_ok(),
            "the proxy port must not be bound on the wildcard address"
        );
    }

    #[tokio::test]
    async fn rejects_non_connect_commands() {
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();

        client.write_all(&[SOCKS_VERSION, 1, METHOD_NO_AUTH]).await.unwrap();
        let mut greeting = [0u8; 2];
        client.read_exact(&mut greeting).await.unwrap();

        // 0x02 = BIND, which has no meaning over a Tor circuit.
        client
            .write_all(&[SOCKS_VERSION, 0x02, 0x00, ATYP_IPV4, 127, 0, 0, 1, 0, 80])
            .await
            .unwrap();

        let mut reply = [0u8; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[1], REP_CMD_NOT_SUPPORTED);
    }

    #[tokio::test]
    async fn refuses_unknown_address_types() {
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();

        client.write_all(&[SOCKS_VERSION, 1, METHOD_NO_AUTH]).await.unwrap();
        let mut greeting = [0u8; 2];
        client.read_exact(&mut greeting).await.unwrap();

        client
            .write_all(&[SOCKS_VERSION, CMD_CONNECT, 0x00, 0x09, 0, 0])
            .await
            .unwrap();

        let mut reply = [0u8; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[1], REP_ATYP_NOT_SUPPORTED);
    }

    #[tokio::test]
    async fn reports_failure_when_the_connector_cannot_reach_the_target() {
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();

        // Port 1 on loopback: nothing listens, so the connect fails and the
        // client must be told rather than left hanging.
        let (_client, rep) = connect_through_proxy(port, ATYP_IPV4, "127.0.0.1", 1).await;
        assert_eq!(rep, REP_GENERAL_FAILURE);
    }

    #[tokio::test]
    async fn rejects_a_wrong_protocol_version() {
        let (port, _proxy) = serve(Arc::new(DirectConnector), 0).await.unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();

        // SOCKS4 greeting: must not be served.
        client.write_all(&[0x04, 1, METHOD_NO_AUTH]).await.unwrap();

        let mut reply = [0u8; 2];
        let result = client.read_exact(&mut reply).await;
        assert!(result.is_err(), "server must close on an unsupported version");
    }
}
