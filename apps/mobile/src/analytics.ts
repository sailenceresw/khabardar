import {
  REPORT_CATEGORY_KEYS,
  TIER_SLUGS,
  VerificationTier,
  type FeedReport,
  type ReportCategory,
} from "@khabardar/shared";
import { getEntitlements } from "./org";

/**
 * Cross-report analytics — one of the two surfaces the paid tiers actually sell.
 *
 * ## The k-anonymity rule, and why it is not negotiable
 *
 * Aggregates over a whistleblower corpus are more dangerous than the individual
 * reports, not less. "Three bribery reports in geohash tsj9 this month" sounds
 * anonymous and is not: if the reader knows the area, three is a small enough
 * set to start guessing, and a sponsor or an official with local knowledge can
 * often close the gap alone. Fine-grained counts are a targeting tool wearing a
 * dashboard's clothes.
 *
 * So every bucket below {@link MIN_BUCKET_SIZE} is suppressed rather than
 * rounded or shown with a caveat — a caveat does not stop anyone reading the
 * number. Suppressed buckets are counted and reported, so an analyst can see
 * that data was withheld rather than concluding the region is clean.
 *
 * ## What is deliberately absent
 *
 * No per-reporter statistics of any kind, not even counts. "This codename filed
 * 9 reports about this office" is a deanonymization aid and nothing else, and
 * the fact that the codename is pseudonymous does not help — it is the pattern
 * that identifies, not the label.
 */

/**
 * Minimum reports before a bucket is publishable.
 *
 * Five is the conventional floor in official statistics for exactly this
 * reason, and it is a floor rather than a target — for a narrow region crossed
 * with a narrow category, larger would be defensible.
 */
export const MIN_BUCKET_SIZE = 5;

export interface Bucket {
  key: string;
  /** Translation key when the bucket is an enum; otherwise the raw label. */
  labelKey?: string;
  count: number;
}

export interface CorpusAnalytics {
  totalReports: number;
  /** Reports excluded because their bucket was too small to publish. */
  suppressedReports: number;
  suppressedBuckets: number;
  byCategory: Bucket[];
  byTier: Bucket[];
  byRegion: Bucket[];
  /** Entity clusters with enough independent reports to be worth looking at. */
  topEntities: Bucket[];
  /** Reports per week, oldest first. Coarse on purpose. */
  weeklyVolume: Array<{ weekStart: number; count: number }>;
  verifiedShare: number;
  corroborationRate: number;
}

export class AnalyticsNotEntitledError extends Error {
  constructor() {
    super("Analytics requires an accredited Pro or Institutional organization plan");
    this.name = "AnalyticsNotEntitledError";
  }
}

export async function computeAnalytics(reports: FeedReport[]): Promise<CorpusAnalytics> {
  const entitlements = await getEntitlements();
  if (!entitlements.analytics) throw new AnalyticsNotEntitledError();

  // Sample rows would inflate every number with fiction.
  const corpus = reports.filter((r) => !r.demo);

  const { buckets: byCategory, suppressed: catSup } = bucketize(
    corpus,
    (r) => String(r.category),
    (key) => REPORT_CATEGORY_KEYS[Number(key) as ReportCategory]
  );

  // Tier is not suppressed: it describes the review process rather than
  // pointing at any report's origin, and hiding it would hide exactly the
  // credibility signal readers most need.
  const byTier = countBy(corpus, (r) => TIER_SLUGS[r.tier as VerificationTier] ?? "unknown").map(
    (b) => ({ ...b, labelKey: `tier.${b.key}` })
  );

  const { buckets: byRegion, suppressed: regionSup } = bucketize(corpus, (r) => r.coarseGeohash || "—");

  const { buckets: topEntities, suppressed: entitySup } = bucketize(
    corpus.filter((r) => r.entityTag && !isZeroTag(r.entityTag)),
    (r) => r.entityTag!
  );

  const verified = corpus.filter((r) => r.tier === VerificationTier.Verified).length;
  const corroborated = corpus.filter((r) => r.corroborations > 0).length;

  return {
    totalReports: corpus.length,
    suppressedReports: catSup.reports + regionSup.reports + entitySup.reports,
    suppressedBuckets: catSup.buckets + regionSup.buckets + entitySup.buckets,
    byCategory,
    byTier,
    byRegion,
    topEntities: topEntities.slice(0, 10),
    weeklyVolume: weeklyVolume(corpus),
    verifiedShare: corpus.length ? verified / corpus.length : 0,
    corroborationRate: corpus.length ? corroborated / corpus.length : 0,
  };
}

function countBy(reports: FeedReport[], keyOf: (r: FeedReport) => string): Bucket[] {
  const counts = new Map<string, number>();
  for (const r of reports) {
    const key = keyOf(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Count, then drop every bucket too small to publish safely. */
function bucketize(
  reports: FeedReport[],
  keyOf: (r: FeedReport) => string,
  labelKeyOf?: (key: string) => string
): { buckets: Bucket[]; suppressed: { buckets: number; reports: number } } {
  const all = countBy(reports, keyOf);
  const publishable = all.filter((b) => b.count >= MIN_BUCKET_SIZE);
  const withheld = all.filter((b) => b.count < MIN_BUCKET_SIZE);

  return {
    buckets: publishable.map((b) => ({
      ...b,
      ...(labelKeyOf ? { labelKey: labelKeyOf(b.key) } : {}),
    })),
    suppressed: {
      buckets: withheld.length,
      reports: withheld.reduce((n, b) => n + b.count, 0),
    },
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Weekly rather than daily. A daily series over a small corpus reconstructs
 * individual submission dates, which combined with a coarse geohash narrows a
 * reporter considerably.
 */
function weeklyVolume(reports: FeedReport[]): Array<{ weekStart: number; count: number }> {
  const counts = new Map<number, number>();
  for (const r of reports) {
    const week = Math.floor(r.timestamp / WEEK_MS) * WEEK_MS;
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([weekStart, count]) => ({ weekStart, count }))
    .sort((a, b) => a.weekStart - b.weekStart);
}

function isZeroTag(tag: string): boolean {
  return /^0x0+$/.test(tag);
}
