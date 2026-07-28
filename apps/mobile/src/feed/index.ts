import type { Address } from "viem";
import { ChainNetworkIndex } from "./chainNetworkIndex";
import { MockNetworkIndex } from "./mockNetworkIndex";
import type { NetworkIndex } from "./types";

export type { ChainReportRow, FeedQuery, NetworkIndex } from "./types";
export { resolveFeedReport, resolveFeedReports } from "./resolve";

let instance: NetworkIndex | null = null;

export function getNetworkIndex(): NetworkIndex {
  if (instance) return instance;

  const registry = process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS as Address | undefined;
  const provider = process.env.EXPO_PUBLIC_GASLESS_PROVIDER ?? "mock";

  // Only read from chain when we are actually writing to it.
  instance = provider !== "mock" && registry ? new ChainNetworkIndex(registry) : new MockNetworkIndex();
  return instance;
}
