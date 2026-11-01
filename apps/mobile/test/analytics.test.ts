import { describe, it, expect, beforeEach } from "vitest";
import { resetStubs } from "./stubs/native";
import { OrgKind, OrgPlan, ReportCategory, VerificationTier, type FeedReport } from "@khabardar/shared";
import { registerOrg, devSetAccredited } from "../src/org";
import { computeAnalytics, MIN_BUCKET_SIZE, AnalyticsNotEntitledError } from "../src/analytics";

beforeEach(resetStubs);

let nextId = 0;
function report(over: Partial<FeedReport> = {}): FeedReport {
  return {
    onChainReportId: nextId++,
    reportHash: "0xhash",
    cid: "bafy",
    category: 0,
    visibility: 0,
    tier: VerificationTier.Unverified,
    coarseGeohash: "tsj9",
    entityTag: "0xaa",
    timestamp: Date.UTC(2026, 0, 1),
    reporter: "0x01",
    reporterCodename: "quiet-heron-1",
    corroborations: 0,
    ...over,
  } as FeedReport;
}

async function entitle() {
  await registerOrg({
    name: "Test Newsroom",
    kind: OrgKind.Newsroom,
    plan: OrgPlan.Pro,
    contactEmail: "a@b.c",
  });
  // A new org is Community until a human accredits it, by design.
  await devSetAccredited(true);
}

describe("analytics entitlement gate", () => {
  it("refuses without an entitled org", async () => {
    nextId = 0;
    await expect(computeAnalytics([report()])).rejects.toBeInstanceOf(AnalyticsNotEntitledError);
  });
});

describe("k-anonymity suppression", () => {
  beforeEach(async () => {
    nextId = 0;
    await entitle();
  });

  it("publishes a bucket at the threshold and withholds one below it", async () => {
    const corpus = [
      ...Array.from({ length: MIN_BUCKET_SIZE }, () => report({ category: 0 })),
      ...Array.from({ length: MIN_BUCKET_SIZE - 1 }, () => report({ category: 1 })),
    ];
    const a = await computeAnalytics(corpus);
    const cats = a.byCategory.map((b) => b.key);
    expect(cats).toContain("0");
    expect(cats).not.toContain("1");
  });

  // Regression: suppressed reports were summed across three bucketizations of
  // the same corpus, so one report counted up to three times and the figure
  // could exceed the corpus size. A dashboard claiming more reports withheld
  // than exist is not a rounding error, it is a number nobody can trust.
  it("never claims more reports withheld than exist", async () => {
    // Every report is alone in its category, its region and its entity, so all
    // three dimensions suppress all of them.
    const corpus = Array.from({ length: 4 }, (_, i) =>
      report({ category: i as ReportCategory, coarseGeohash: `r${i}`, entityTag: `0x0${i}` })
    );
    const a = await computeAnalytics(corpus);
    expect(a.totalReports).toBe(4);
    expect(a.suppressedReports).toBeLessThanOrEqual(a.totalReports);
    expect(a.suppressedReports).toBe(4);
  });

  it("counts a report once even when several dimensions withhold it", async () => {
    const corpus = [
      ...Array.from({ length: MIN_BUCKET_SIZE }, () =>
        report({ category: ReportCategory.Bribery, coarseGeohash: "big", entityTag: "0xbig" })
      ),
      report({ category: ReportCategory.Other, coarseGeohash: "lonely", entityTag: "0xlonely" }),
    ];
    const a = await computeAnalytics(corpus);
    expect(a.suppressedReports).toBe(1);
  });

  it("still counts suppressed buckets across dimensions", async () => {
    const corpus = [report({ category: ReportCategory.AbuseOfPower, coarseGeohash: "zz", entityTag: "0x77" })];
    const a = await computeAnalytics(corpus);
    // One withheld group on each of category, region and entity.
    expect(a.suppressedBuckets).toBeGreaterThanOrEqual(3);
  });
});
