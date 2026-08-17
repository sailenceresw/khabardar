/**
 * Transport abstraction for Khabardar.
 *
 * Goal: every outbound network call goes through this layer so we can
 * prefer onion endpoints when available and report honest protection status.
 *
 * Expo currently has no reliable production SOCKS5 support, so the Tor
 * implementation prefers .onion endpoints (for services we control) and
 * relies on Orbot VPN mode for everything else (public RPCs, etc.).
 */

export type TransportMode = "clearnet" | "tor";

export type TransportService = "ipfsApi" | "ipfsGateway";

export interface TransportEndpoints {
  ipfsApi?: string;
  ipfsGateway?: string;
}

export interface TransportConfig {
  /** Clearnet (normal HTTPS) endpoints */
  clearnet: TransportEndpoints;
  /** Onion endpoints — preferred when mode === "tor" */
  onion: TransportEndpoints;
}

export interface Transport {
  readonly mode: TransportMode;

  /**
   * Resolve the best URL for a service under the current mode.
   * Returns null if nothing is configured.
   */
  resolve(service: TransportService): string | null;

  /**
   * Drop-in replacement for global fetch.
   * All ContentStore / future network code should use this.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;

  /**
   * Whether traffic is currently considered protected.
   * Used only for UI warnings — never sent off-device.
   */
  isProtected(): boolean;
}
