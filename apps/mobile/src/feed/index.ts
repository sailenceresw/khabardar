import type { Address } from "viem";
import { getRuntimeConfig } from "../runtimeConfig";
import { ChainNetworkIndex } from "./chainNetworkIndex";
import { IndexerNetworkIndex } from "./indexerNetworkIndex";
import { MockNetworkIndex } from "./mockNetworkIndex";
import type { NetworkIndex } from "./types";

export type { ChainReportRow, FeedQuery, NetworkIndex } from "./types";
export { resolveFeedReport, resolveFeedReports } from "./resolve";
export { ChainNetworkIndex } from "./chainNetworkIndex";
export { IndexerNetworkIndex } from "./indexerNetworkIndex";

let instance: NetworkIndex | null = null;

/**
 * Pick the feed source. In mock mode this is always the mock: local mirror
 * plus labelled sample rows, no network. In live mode, most scalable first:
 *
 *  1. **Indexer** when `EXPO_PUBLIC_INDEXER_URL` is set — the only option that
 *     survives real volume.
 *  2. **Direct chain reads** when a registry address is configured — correct,
 *     no infrastructure, does not scale.
 *  3. **Mock** when neither is configured.
 */
export function getNetworkIndex(): NetworkIndex {
  if (instance) return instance;

  const { feed } = getRuntimeConfig();
  if (feed.kind === "indexer") {
    instance = new IndexerNetworkIndex(feed.url);
  } else if (feed.kind === "chain") {
    instance = new ChainNetworkIndex(feed.registryAddress as Address);
  } else {
    instance = new MockNetworkIndex();
  }
  return instance;
}

/** Test seam. Not used by app code. */
export function setNetworkIndex(next: NetworkIndex | null): void {
  instance = next;
}
