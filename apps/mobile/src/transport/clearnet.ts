import type { Transport, TransportConfig, TransportService } from "./types";

/**
 * Default transport — current behaviour.
 * Uses clearnet endpoints and reports unprotected.
 */
export class ClearnetTransport implements Transport {
  readonly mode = "clearnet" as const;

  constructor(private readonly config: TransportConfig) {}

  resolve(service: TransportService): string | null {
    return this.config.clearnet[service] ?? null;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
  }

  isProtected(): boolean {
    return false;
  }
}
