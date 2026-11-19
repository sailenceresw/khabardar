import { describe, expect, it, vi } from "vitest";
import { VerificationTier } from "@khabardar/shared";
import type { ChainReportRow } from "../src/feed/types";
import { applyQuery } from "../src/feed/mockNetworkIndex";

// The indexer reads through the transport seam; stub it so no test touches a network.
const netFetch = vi.fn();
vi.mock("../src/net/transport", () => ({ netFetch: (...args: unknown[]) => netFetch(...args) }));
const { IndexerNetworkIndex } = await import("../src/feed/indexerNetworkIndex");

let id = 0;
function row(over: Partial<ChainReportRow> = {}): ChainReportRow {
  return {
    onChainReportId: id++,
    reportHash: "0xhash",
    cid: "bafy",
    category: 0,
    visibility: 0,
    tier: VerificationTier.Unverified,
    coarseGeohash: "tsj9",
    entityTag: "0xaa",
    timestamp: 1_000,
    reporter: "0x01",
    corroborations: 0,
    ...over,
  } as ChainReportRow;
}

describe("minCorroborations in applyQuery", () => {
  const rows = [row({ corroborations: 0 }), row({ corroborations: 2 }), row({ corroborations: 5 })];

  it("keeps reports at or above the floor", () => {
    expect(applyQuery(rows, { minCorroborations: 2 }).map((r) => r.corroborations)).toEqual([2, 5]);
  });

  it("keeps everything when the floor is 0 or unset", () => {
    expect(applyQuery(rows, { minCorroborations: 0 })).toHaveLength(3);
    expect(applyQuery(rows, {})).toHaveLength(3);
  });

  it("combines with the other filters", () => {
    const mixed = [
      row({ corroborations: 4, tier: VerificationTier.Verified, coarseGeohash: "tuvz" }),
      row({ corroborations: 4, tier: VerificationTier.Verified, coarseGeohash: "tsj9" }),
      row({ corroborations: 1, tier: VerificationTier.Verified, coarseGeohash: "tuvz" }),
    ];
    const out = applyQuery(mixed, { minCorroborations: 3, tier: VerificationTier.Verified, region: "tuv" });
    expect(out).toHaveLength(1);
    expect(out[0].coarseGeohash).toBe("tuvz");
  });
});

describe("minCorroborations through an indexer", () => {
  const respond = (rows: ChainReportRow[]) =>
    netFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ rows }) });

  it("sends the floor to the indexer", async () => {
    respond([]);
    await new IndexerNetworkIndex("https://idx.example").list({ minCorroborations: 3 });
    expect(String(netFetch.mock.calls.at(-1)?.[0])).toContain("minCorroborations=3");
  });

  it("re-applies the floor when an indexer ignores it", async () => {
    respond([row({ corroborations: 0 }), row({ corroborations: 4 })]);
    const out = await new IndexerNetworkIndex("https://idx.example").list({ minCorroborations: 3 });
    expect(out.map((r) => r.corroborations)).toEqual([4]);
  });
});
