import type { Transport, TransportConfig, TransportService } from "./types";

/**
 * Tor-aware transport (Orbot-first design).
 *
 * Because Expo has no reliable SOCKS5 support today:
 * - Prefer onion endpoints for any service we control (IPFS API / gateway).
 * - Fall back to clearnet endpoints only when no onion URL is configured.
 * - Protection status is true only when the caller confirms Orbot VPN is active
 *   (or a future probe succeeds). Public RPCs still require Orbot.
 *
 * When real SOCKS or embedded Tor becomes practical, only the `fetch`
 * method needs to change. The rest of the app stays the same.
 */
export class TorTransport implements Transport {
  readonly mode = "tor" as const;

  constructor(
    private readonly config: TransportConfig,
    /**
     * True when Orbot (or equivalent) is known to be routing this process.
     * This is the only thing that makes isProtected() return true.
     */
    private readonly orbotActive: boolean = false
  ) {}

  resolve(service: TransportService): string | null {
    // Prefer onion when present
    const onion = this.config.onion[service];
    if (onion) return onion;

    // Fallback to clearnet (weaker protection)
    return this.config.clearnet[service] ?? null;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Still normal fetch. Orbot VPN (if active) routes the packets.
    // Future: replace this body with a real SOCKS5 client when available.
    return globalThis.fetch(input, init);
  }

  isProtected(): boolean {
    return this.orbotActive;
  }
}
