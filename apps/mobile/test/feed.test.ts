import { describe, it, expect } from "vitest";
import { VerificationTier } from "@khabardar/shared";
import type { ChainReportRow } from "../src/feed/types";
import { applyQuery } from "../src/feed/mockNetworkIndex";

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

describe("feed query filtering", () => {
  it("returns everything when there is no query", () => {
    const rows = [row(), row()];
    expect(applyQuery(rows, undefined)).toHaveLength(2);
  });

  it("filters by category and tier", () => {
    const rows = [
      row({ category: 0, tier: VerificationTier.Verified }),
      row({ category: 1, tier: VerificationTier.Verified }),
      row({ category: 0, tier: VerificationTier.Disputed }),
    ];
    expect(applyQuery(rows, { category: 0 })).toHaveLength(2);
    expect(applyQuery(rows, { tier: VerificationTier.Verified })).toHaveLength(2);
    expect(applyQuery(rows, { category: 0, tier: VerificationTier.Verified })).toHaveLength(1);
  });

  it("matches a region by prefix, case-insensitively", () => {
    const rows = [row({ coarseGeohash: "tsj9" }), row({ coarseGeohash: "wxyz" })];
    expect(applyQuery(rows, { region: "ts" })).toHaveLength(1);
    expect(applyQuery(rows, { region: "TS" })).toHaveLength(1);
    expect(applyQuery(rows, { region: "q" })).toHaveLength(0);
  });

  it("bounds by time inclusively at both ends", () => {
    const rows = [row({ timestamp: 10 }), row({ timestamp: 20 }), row({ timestamp: 30 })];
    expect(applyQuery(rows, { since: 20 })).toHaveLength(2);
    expect(applyQuery(rows, { until: 20 })).toHaveLength(2);
    expect(applyQuery(rows, { since: 20, until: 20 })).toHaveLength(1);
  });

  it("matches an entity tag exactly, not by prefix", () => {
    const rows = [row({ entityTag: "0xaabb" }), row({ entityTag: "0xaa" })];
    expect(applyQuery(rows, { entityTag: "0xaa" })).toHaveLength(1);
  });

  /**
   * Regression context for the chain feed.
   *
   * `ChainNetworkIndex` used to cap its log scan at `limit` and only then call
   * `applyQuery`, so a filtered query returned nothing whenever the newest
   * `limit` reports did not match, while matching reports sat further back. The
   * fix filters each hydrated row before it counts against the limit, which
   * relies on `applyQuery` ignoring `limit` entirely. If that ever changes,
   * the per-row call starts truncating and the bug comes back.
   */
  it("ignores limit, because the caller applies it after filtering", () => {
    const rows = [row(), row(), row()];
    expect(applyQuery(rows, { limit: 1 })).toHaveLength(3);
  });

  it("decides a single row the same way it decides a batch", () => {
    const keep = row({ category: 3 });
    const drop = row({ category: 4 });
    expect(applyQuery([keep], { category: 3 })).toHaveLength(1);
    expect(applyQuery([drop], { category: 3 })).toHaveLength(0);
    expect(applyQuery([keep, drop], { category: 3 })).toHaveLength(1);
  });
});
