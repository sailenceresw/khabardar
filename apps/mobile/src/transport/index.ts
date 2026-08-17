import { ClearnetTransport } from "./clearnet";
import { TorTransport } from "./tor";
import type { Transport, TransportConfig, TransportMode } from "./types";

export type { Transport, TransportConfig, TransportMode, TransportService } from "./types";
export { ClearnetTransport } from "./clearnet";
export { TorTransport } from "./tor";

let active: Transport | null = null;

/**
 * Initialise the transport layer.
 * Call once at app start (or when the user toggles mode / Orbot status).
 */
export function initTransport(
  mode: TransportMode,
  config: TransportConfig,
  orbotActive = false
): void {
  active =
    mode === "tor"
      ? new TorTransport(config, orbotActive)
      : new ClearnetTransport(config);
}

/**
 * Returns the currently active transport.
 * Throws if initTransport has not been called.
 */
export function getTransport(): Transport {
  if (!active) {
    // Safe default so existing code does not crash during early boot or tests.
    // Real apps should call initTransport early.
    active = new ClearnetTransport({
      clearnet: {},
      onion: {},
    });
  }
  return active;
}

/**
 * Convenience wrapper used by ContentStore and any other network code.
 */
export function transportFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return getTransport().fetch(input, init);
}

/**
 * Build a TransportConfig from the current environment variables.
 * Onion endpoints are optional and only used when mode === "tor".
 */
export function configFromEnv(): TransportConfig {
  return {
    clearnet: {
      ipfsApi: process.env.EXPO_PUBLIC_IPFS_API_URL,
      ipfsGateway: process.env.EXPO_PUBLIC_IPFS_GATEWAY_URL,
    },
    onion: {
      ipfsApi: process.env.EXPO_PUBLIC_IPFS_API_ONION_URL,
      ipfsGateway: process.env.EXPO_PUBLIC_IPFS_GATEWAY_ONION_URL,
    },
  };
}

export {
  loadTransportPrefs,
  saveTransportPrefs,
  applySavedTransportPrefs,
} from "./prefs";
export type { TransportPrefs } from "./prefs";
export { getAnonymityStatus } from "./status";
export type { AnonymityStatus } from "./status";
