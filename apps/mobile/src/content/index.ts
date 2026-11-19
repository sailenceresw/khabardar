import { getRuntimeConfig } from "../runtimeConfig";
import { IpfsContentStore } from "./ipfsContentStore";
import { MockContentStore } from "./mockContentStore";
import type { ContentStore } from "./types";

export type { ContentStore, PutResult, StoredBundle } from "./types";
export { MockContentStore } from "./mockContentStore";
export { IpfsContentStore } from "./ipfsContentStore";

let instance: ContentStore | null = null;

/** The content store `KHABARDAR_MODE` selects. See `runtimeConfig.ts` for when live falls back to mock. */
export function getContentStore(): ContentStore {
  if (instance) return instance;

  const { content } = getRuntimeConfig();
  instance =
    content.kind === "ipfs"
      ? new IpfsContentStore({
          apiUrl: content.apiUrl,
          apiToken: content.apiToken,
          gatewayUrl: content.gatewayUrl,
        })
      : new MockContentStore();
  return instance;
}
