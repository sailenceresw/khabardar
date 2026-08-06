import type { Address } from "viem";
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
 * Pick the feed source. Preference order, most scalable first:
 *
 *  1. **Indexer** when `EXPO_PUBLIC_INDEXER_URL` is set — the only option that
 *     survives real volume.
 *  2. **Direct chain reads** when a registry address is configured — correct,
 *     no infrastructure, does not scale.
 *  3. **Mock** otherwise — local mirror plus labelled sample rows, no network.
 */
export function getNetworkIndex(): NetworkIndex {
  if (instance) return instance;

  const indexerUrl = process.env.EXPO_PUBLIC_INDEXER_URL;
  const registry = process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS as Address | undefined;
  const provider = process.env.EXPO_PUBLIC_GASLESS_PROVIDER ?? "mock";

  if (indexerUrl) {
    instance = new IndexerNetworkIndex(indexerUrl);
  } else if (provider !== "mock" && registry) {
    // Only read from chain when we are actually writing to it.
    instance = new ChainNetworkIndex(registry);
  } else {
    instance = new MockNetworkIndex();
  }
  return instance;
}

/** Test seam. Not used by app code. */
export function setNetworkIndex(next: NetworkIndex | null): void {
  instance = next;
}
