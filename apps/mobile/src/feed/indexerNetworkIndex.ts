import { netFetch } from "../net/transport";
import { safeJsonParse } from "../safeJson";
import type { ChainReportRow, FeedQuery, NetworkIndex } from "./types";

/**
 * Feed backed by a real indexer (Ponder, a subgraph, SubQuery — anything that
 * ingests `ReportSubmitted` and serves it back queryably).
 *
 * ## Why this exists
 *
 * {@link ChainNetworkIndex} rescans `eth_getLogs` and then makes two contract
 * reads per report, on every page view. That cost is proportional to the whole
 * corpus and paid by every reader, so it stops working long before the project
 * would want it to. An indexer does that work once, on ingest.
 *
 * ## What an indexer must not become
 *
 * A single queryable endpoint that every reader hits is a correlation
 * chokepoint: its operator sees which reports each IP reads, which is close to
 * a list of who is interested in whom. That is a different shape of the same
 * problem the content layer has, and it has the same three mitigations, none of
 * which are optional at scale:
 *
 *  1. Reads go through `net/transport` like everything else, so an anonymising
 *     transport covers them too.
 *  2. The indexer is **untrusted for correctness**. Every row it returns still
 *     carries `reportHash` from the chain, and `feed/resolve` recomputes the
 *     hash over the fetched bundle and compares. An indexer that edits or
 *     fabricates a report is detected exactly like a hostile gateway is.
 *  3. It should be self-hostable and plural — the interface is deliberately
 *     small enough that running your own is a weekend, not a quarter.
 *
 * Point 2 is the important one: this class adds a performance dependency, not a
 * trust dependency. Nothing here is believed on the indexer's say-so.
 *
 * ## The endpoint contract
 *
 * `GET {baseUrl}/reports?category=&tier=&region=&entityTag=&since=&until=&limit=&cursor=`
 * → `{ rows: ChainReportRow[], nextCursor?: string }`
 *
 * `GET {baseUrl}/reports/{id}` → `ChainReportRow` or 404.
 *
 * Rows must mirror on-chain state exactly. `packages/contracts` emits
 * everything needed; a Ponder handler for `ReportSubmitted`, `ReportCorroborated`
 * and `ReportTierChanged` is enough to populate it.
 */
export class IndexerNetworkIndex implements NetworkIndex {
  readonly name = "indexer";

  constructor(private readonly baseUrl: string) {}

  async list(query?: FeedQuery): Promise<ChainReportRow[]> {
    // Built by hand rather than with URLSearchParams: React Native's polyfill
    // does not implement `set` or `size`, so the convenient version throws on
    // any filtered query and drops the string entirely on an unfiltered one.
    const pairs: Array<[string, string]> = [];
    const add = (k: string, v: string | number | undefined) => {
      if (v !== undefined && v !== "") pairs.push([k, String(v)]);
    };
    add("category", query?.category);
    add("tier", query?.tier);
    add("region", query?.region);
    add("entityTag", query?.entityTag);
    add("since", query?.since);
    add("until", query?.until);
    add("limit", query?.limit);
    add("cursor", query?.cursor);

    const qs = pairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const url = `${this.base()}/reports${qs ? `?${qs}` : ""}`;
    const res = await netFetch(url, undefined, "feed:indexer-list");
    if (!res.ok) throw new Error(`Indexer list failed: ${res.status}`);

    const body = safeJsonParse<{ rows?: ChainReportRow[] }>(await res.text());
    // A malformed response degrades to an empty feed rather than throwing: a
    // broken indexer must not be able to crash every reader's app.
    return Array.isArray(body?.rows) ? body!.rows.filter(isPlausibleRow) : [];
  }

  async get(onChainReportId: number): Promise<ChainReportRow | null> {
    const res = await netFetch(
      `${this.base()}/reports/${onChainReportId}`,
      undefined,
      "feed:indexer-get"
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Indexer get failed: ${res.status}`);

    const row = safeJsonParse<ChainReportRow>(await res.text());
    return row && isPlausibleRow(row) ? row : null;
  }

  private base(): string {
    return this.baseUrl.replace(/\/$/, "");
  }
}

/**
 * Shape check only — this is not an integrity check and must not be mistaken
 * for one. The real check is the hash recomputation in `feed/resolve`; this
 * just keeps obviously-malformed rows from reaching the UI as `undefined`s.
 */
function isPlausibleRow(row: unknown): row is ChainReportRow {
  const r = row as Partial<ChainReportRow>;
  return (
    !!r &&
    typeof r.onChainReportId === "number" &&
    typeof r.reportHash === "string" &&
    typeof r.cid === "string" &&
    typeof r.timestamp === "number" &&
    typeof r.reporter === "string"
  );
}
