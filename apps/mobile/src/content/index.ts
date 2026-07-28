import { IpfsContentStore } from "./ipfsContentStore";
import { MockContentStore } from "./mockContentStore";
import type { ContentStore } from "./types";

export type { ContentStore, PutResult, StoredBundle } from "./types";
export { MockContentStore } from "./mockContentStore";
export { IpfsContentStore } from "./ipfsContentStore";

let instance: ContentStore | null = null;

export function getContentStore(): ContentStore {
  if (instance) return instance;

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
