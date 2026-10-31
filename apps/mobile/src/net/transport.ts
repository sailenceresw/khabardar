import AsyncStorage from "@react-native-async-storage/async-storage";
import { custom } from "viem";

/**
 * The single point every byte leaves this app through.
 *
 * ## Why this exists
 *
 * Network metadata is what deanonymizes people, not ciphertext. A reporter's
 * IP contacting a known relayer, gateway, or RPC endpoint is a stronger signal
 * than anything in the encrypted payload — it is *when* and *from where*, which
 * is exactly what an adversary with network visibility already collects. The
 * cryptography in this app is genuinely good and completely beside the point if
 * the connection itself identifies you.
 *
 * Before this module, egress was scattered: `fetch` in the content store, a
 * second `fetch` in the relayer, viem's own HTTP transport for RPC. Three
 * independent leaks with no shared policy and no way to see them. Routing
 * everything through one seam is the prerequisite for doing anything about it —
 * you cannot put traffic through Tor that you cannot enumerate.
 *
 * ## What this module does and does not give you
 *
 * It does NOT make you anonymous. There is no Tor here; React Native's `fetch`
 * cannot open a SOCKS connection and shipping Arti needs a dev build with
 * native bindings (see {@link ANONYMITY_INTEGRATION}). What it does give you:
 *
 *  1. **One choke point**, so adding a transport later is one change.
 *  2. **Fail-closed policy.** With {@link setRequireAnonymity} on, a request
 *     that would go out unprotected is refused instead of quietly leaking. A
 *     user who has been told they are protected must not silently not be.
 *  3. **Egress accounting.** Every host contacted is recorded and shown in
 *     Settings, so "what does this app talk to" has an answer the user can read
 *     rather than a claim they have to trust.
 */

const REQUIRE_ANONYMITY_KEY = "khabardar.net.requireAnonymity.v1";
const EGRESS_LOG_KEY = "khabardar.net.egress.v1";
const MAX_EGRESS_ENTRIES = 50;

/**
 * How to finish this properly, in preference order:
 *
 *  1. **Arti (Tor in Rust) as an Expo native module.** Real onion routing,
 *     works on both platforms, no dependency on a separate app being installed.
 *     Needs a dev build; will not run in Expo Go.
 *  2. **Orbot in VPN mode (Android).** Orbot routes the whole device through
 *     Tor, so this module needs no change — but it also cannot *verify* that it
 *     happened, which is why {@link probeAnonymity} exists and why trusting it
 *     silently would be wrong.
 *  3. **A trusted relay that never sees the client IP.** Weaker than Tor and
 *     only as good as the relay operator, but far better than direct, and it
 *     ships without native code.
 */
export const ANONYMITY_INTEGRATION = "arti | orbot-vpn | trusted-relay";

export interface Transport {
  readonly name: string;
  /** True only when traffic is genuinely routed away from the client IP. */
  readonly anonymised: boolean;
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** Plain fetch. The current default, and the reason mainnet is not ready. */
class DirectTransport implements Transport {
  readonly name = "direct";
  readonly anonymised = false;

  fetch(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

/**
 * Routes through an HTTP proxy that fronts Tor — an Orbot HTTP port, or a
 * self-hosted privoxy→tor pair.
 *
 * Honest limits: this is a *forward proxy by URL rewrite*, so it only works
 * where the proxy accepts absolute-form requests, and the proxy itself sees
 * every destination you contact (though not the payload, over TLS). It is a
 * meaningful improvement over direct and strictly weaker than real onion
 * routing. `anonymised` is true because the client IP does not reach the
 * destination — the trust simply moves to the proxy operator.
 */
class ProxyTransport implements Transport {
  readonly name = "proxy";
  readonly anonymised = true;

  constructor(private readonly proxyUrl: string) {}

  fetch(url: string, init?: RequestInit): Promise<Response> {
    const target = `${this.proxyUrl.replace(/\/$/, "")}/${encodeURIComponent(url)}`;
    return fetch(target, init);
  }
}

let transport: Transport | null = null;
let override: Transport | null = null;

/**
 * Pick a transport. Preference order, strongest first:
 *
 *  1. **Tor** when the native module is present and Arti has bootstrapped.
 *     Real onion routing — the only option that actually hides the client IP
 *     from the destination *and* from the operator of anything in between.
 *  2. **HTTP proxy** when `EXPO_PUBLIC_ANONYMISING_PROXY_URL` is set. Weaker:
 *     the proxy operator sees every destination.
 *  3. **Direct**, which is not anonymous at all.
 *
 * Tor is checked at call time rather than cached at startup, because it
 * bootstraps asynchronously — a transport chosen once at launch would be
 * `direct` forever even after Tor came up.
 */
export function getTransport(): Transport {
  if (override) return override;

  const tor = activeTorTransport();
  if (tor) return tor;

  if (transport) return transport;

  const proxyUrl = process.env.EXPO_PUBLIC_ANONYMISING_PROXY_URL;
  transport = proxyUrl ? new ProxyTransport(proxyUrl) : new DirectTransport();
  return transport;
}

/**
 * The Tor transport, but only while Arti is actually running.
 *
 * Returning it while Tor is merely *installed* would mark traffic as
 * anonymised when it is not — which, combined with the fail-closed policy
 * below, is the exact failure this module is written to prevent. Imported
 * lazily so that web and Expo Go, where `expo-tor` cannot load, never touch it.
 */
function activeTorTransport(): Transport | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tor = require("./torTransport") as typeof import("./torTransport");
    if (tor.torAvailability() !== "available") return null;
    if (tor.torStatus().state !== "running") return null;

    torTransportInstance ??= new tor.TorTransport();
    return torTransportInstance;
  } catch {
    // No native module on this platform. Not an error — see torTransport.ts.
    return null;
  }
}

let torTransportInstance: Transport | null = null;

/**
 * Ask for fresh circuits before a group of requests that must not be linkable
 * to the previous group — the app calls this before each report submission.
 *
 * Without it, two submissions from one device can share a circuit, which means
 * one exit relay sees both, at a known interval, from the same source. Each
 * report stays individually anonymous and the pair does not: that inference is
 * exactly what the blinded entity tags and aggregate-only sponsor attribution
 * elsewhere in this app are built to prevent, so letting the transport hand it
 * back would waste the effort.
 *
 * Returns whether isolation was actually obtained. False is normal — it means
 * Tor is off — and must not be read as success.
 */
export async function isolateNextRequests(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tor = require("./torTransport") as typeof import("./torTransport");
    return await tor.rotateCircuit();
  } catch {
    return false;
  }
}

/** Test seam. Overrides selection entirely. Not used by app code. */
export function setTransport(next: Transport | null): void {
  override = next;
  transport = null;
  torTransportInstance = null;
}

export function isAnonymised(): boolean {
  return getTransport().anonymised;
}

// ---------------------------------------------------------------------------
// Fail-closed policy
// ---------------------------------------------------------------------------

export class AnonymityRequiredError extends Error {
  constructor(readonly host: string) {
    super(
      `Refused to contact ${host}: anonymising transport required but the active transport is "${getTransport().name}".`
    );
    this.name = "AnonymityRequiredError";
  }
}

let requireAnonymityCache: boolean | null = null;

/**
 * When on, any request that would leave over a non-anonymising transport throws
 * instead of being sent.
 *
 * This is deliberately a hard failure rather than a warning. A user in a
 * situation where they need Tor is a user for whom one leaked connection is the
 * whole threat; degrading gracefully to "leaked, but we told you" is the wrong
 * default for them, even though it is the friendlier one.
 */
export async function setRequireAnonymity(required: boolean): Promise<void> {
  requireAnonymityCache = required;
  await AsyncStorage.setItem(REQUIRE_ANONYMITY_KEY, required ? "true" : "false");
}

export async function getRequireAnonymity(): Promise<boolean> {
  if (requireAnonymityCache !== null) return requireAnonymityCache;
  requireAnonymityCache = (await AsyncStorage.getItem(REQUIRE_ANONYMITY_KEY)) === "true";
  return requireAnonymityCache;
}

// ---------------------------------------------------------------------------
// Egress accounting
// ---------------------------------------------------------------------------

export interface EgressEntry {
  /** Host only — never the full URL, which can carry a CID or an API key. */
  host: string;
  purpose: string;
  at: number;
  anonymised: boolean;
}

export async function egressLog(): Promise<EgressEntry[]> {
  const raw = await AsyncStorage.getItem(EGRESS_LOG_KEY);
  try {
    return raw ? (JSON.parse(raw) as EgressEntry[]) : [];
  } catch {
    return [];
  }
}

export async function clearEgressLog(): Promise<void> {
  await AsyncStorage.removeItem(EGRESS_LOG_KEY);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

async function recordEgress(host: string, purpose: string, anonymised: boolean): Promise<void> {
  const entries = await egressLog();
  const next = [{ host, purpose, at: Date.now(), anonymised }, ...entries].slice(0, MAX_EGRESS_ENTRIES);
  await AsyncStorage.setItem(EGRESS_LOG_KEY, JSON.stringify(next));
}

// ---------------------------------------------------------------------------
// The one call everything goes through
// ---------------------------------------------------------------------------

/**
 * Make a network request. Every outbound byte in the app uses this.
 *
 * @param purpose Short label for the egress log, e.g. "content-store:get".
 * Written for a person reading Settings, not for a developer reading a stack.
 */
export async function netFetch(
  url: string,
  init: RequestInit | undefined,
  purpose: string
): Promise<Response> {
  const active = getTransport();
  const host = hostOf(url);

  if (!active.anonymised && (await getRequireAnonymity())) {
    // Log the refusal too: a user should be able to see what the app *wanted*
    // to contact and did not, which is itself useful information.
    await recordEgress(host, `${purpose} (refused)`, false);
    throw new AnonymityRequiredError(host);
  }

  await recordEgress(host, purpose, active.anonymised);
  return active.fetch(url, init);
}

/** JSON-RPC helper over {@link netFetch}, used by the relayer. */
export async function rpcCall<T = unknown>(
  url: string,
  method: string,
  params: unknown[],
  purpose: string
): Promise<T> {
  const res = await netFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    purpose
  );

  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error) {
    throw new Error(`${method} failed: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

/**
 * A viem transport that speaks JSON-RPC through {@link netFetch}.
 *
 * viem's built-in `http()` calls global fetch directly, which would bypass both
 * the policy check and the egress log — chain reads are exactly as identifying
 * as anything else, so they must not get a private door.
 */
export function anonymisingRpcTransport(url: string, purpose = "chain:rpc") {
  return custom({
    async request({ method, params }) {
      return rpcCall(url, method, (params as unknown[]) ?? [], purpose);
    },
  });
}

/**
 * Check whether traffic really is leaving where we think it is.
 *
 * `verified` is true only for the embedded Tor transport, and only because
 * there we own the whole path: Arti runs in this process, we hold its SOCKS
 * port, and the platform HTTP client is pointed at that port and nothing else.
 *
 * It stays false for the HTTP-proxy transport, which we cannot confirm reaches
 * Tor rather than an operator's plain server, and for anything Orbot does in
 * VPN mode, which is invisible from inside the app. Reporting an unverified
 * claim as verified would be exactly the false assurance this module exists to
 * prevent — the number of people who would act on it is the reason to be strict.
 */
export function probeAnonymity(): { claimed: boolean; verified: boolean; transport: string } {
  const active = getTransport();
  return {
    claimed: active.anonymised,
    verified: active.name === "tor",
    transport: active.name,
  };
}
