export type TorState = "stopped" | "starting" | "running" | "failed";

export interface TorStatus {
  state: TorState;
  /** Loopback SOCKS5 port, or 0 when not running. */
  socksPort: number;
  lastError?: string | null;
}

export interface TorResponse {
  status: number;
  headers: Record<string, string>;
  /** Base64 so binary bodies survive the JS bridge intact. */
  bodyBase64: string;
}

/**
 * The native surface. Small on purpose: native owns running Arti and offering
 * a SOCKS port, and the platform HTTP stacks do everything else — we are not
 * reimplementing TLS in Rust.
 */
export interface ExpoTorNativeModule {
  /**
   * Whether the native Tor core actually loaded.
   *
   * The module can exist while the library behind it does not — an Android
   * build assembled without the Rust step produces exactly that. Separating
   * "module present" from "module usable" is what stops such a build reporting
   * Tor as available right up until it crashes.
   */
  isSupported(): boolean;
  /** Bootstraps Tor. Resolves with the SOCKS port. Slow — 10–60s is normal. */
  start(): Promise<number>;
  stop(): Promise<void>;
  /**
   * Move subsequent requests onto fresh circuits. Resolves false when Tor is
   * not running, so a caller that requires isolation can refuse to proceed
   * rather than assume it got it.
   */
  newCircuit(): Promise<boolean>;
  getStatus(): TorStatus;
  request(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | null
  ): Promise<TorResponse>;
}
