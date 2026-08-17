import { IpfsContentStore } from "./ipfsContentStore";
import { MockContentStore } from "./mockContentStore";
import type { ContentStore } from "./types";
import { configFromEnv, initTransport } from "../transport";

export type { ContentStore, PutResult, StoredBundle } from "./types";
export { MockContentStore } from "./mockContentStore";
export { IpfsContentStore } from "./ipfsContentStore";

let instance: ContentStore | null = null;

/**
 * Initialise the transport layer early so ContentStore and any other
 * network code see a consistent mode + endpoint resolution.
 *
 * Mode is controlled by EXPO_PUBLIC_TRANSPORT_MODE=tor|clearnet (default clearnet).
 * Orbot status is currently a simple env flag; later this can become a runtime
 * probe or Settings toggle.
 */
function ensureTransport() {
  const mode =
    (process.env.EXPO_PUBLIC_TRANSPORT_MODE as "tor" | "clearnet") || "clearnet";
  const orbotActive =
    process.env.EXPO_PUBLIC_ORBOT_ACTIVE === "1" ||
    process.env.EXPO_PUBLIC_ORBOT_ACTIVE === "true";

  initTransport(mode, configFromEnv(), orbotActive);
}

export function getContentStore(): ContentStore {
  if (instance) return instance;

  ensureTransport();

  const provider = process.env.EXPO_PUBLIC_CONTENT_STORE ?? "mock";
  const apiUrl = process.env.EXPO_PUBLIC_IPFS_API_URL;
  const apiToken = process.env.EXPO_PUBLIC_IPFS_API_TOKEN;
  const gatewayUrl = process.env.EXPO_PUBLIC_IPFS_GATEWAY_URL;

  if (provider === "ipfs" && apiUrl && apiToken && gatewayUrl) {
    instance = new IpfsContentStore({ apiUrl, apiToken, gatewayUrl });
  } else {
    if (provider === "ipfs") {
      console.warn(
        "[content] EXPO_PUBLIC_CONTENT_STORE=ipfs but API url/token/gateway missing — falling back to mock"
      );
    }
    instance = new MockContentStore();
  }
  return instance;
}
