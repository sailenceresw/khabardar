import { DEMO_ROWS } from "./demoSeed";
import { readMirror } from "./localChainMirror";
import type { ChainReportRow, FeedQuery, NetworkIndex } from "./types";

/**
 * Feed source for mock mode: everything published on this device (via the
 * local chain mirror) plus the clearly-labelled demo rows, newest first.
 */
export class MockNetworkIndex implements NetworkIndex {
  readonly name = "mock";

  async list(query?: FeedQuery): Promise<ChainReportRow[]> {
    const mine = await readMirror();
    const rows = [...mine, ...DEMO_ROWS].sort((a, b) => b.timestamp - a.timestamp);
    return applyQuery(rows, query);
  }

  async get(onChainReportId: number): Promise<ChainReportRow | null> {
    const rows = await this.list();
    return rows.find((r) => r.onChainReportId === onChainReportId) ?? null;
  }
}

export function applyQuery(rows: ChainReportRow[], query?: FeedQuery): ChainReportRow[] {
  if (!query) return rows;
  return rows.filter((r) => {
    if (query.category !== undefined && r.category !== query.category) return false;
    if (query.tier !== undefined && r.tier !== query.tier) return false;
    if (query.region && !r.coarseGeohash.toLowerCase().startsWith(query.region.toLowerCase())) {
      return false;
    }
    if (query.since !== undefined && r.timestamp < query.since) return false;
    if (query.until !== undefined && r.timestamp > query.until) return false;
    if (query.entityTag && r.entityTag !== query.entityTag) return false;
    return true;
  });
}
