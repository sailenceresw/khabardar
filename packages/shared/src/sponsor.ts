import type { ReportCategory } from "./types";

/**
 * Sponsored gas pools — turning the paymaster from a pure cost centre into a
 * funded line item.
 *
 * An organisation (usually an NGO, foundation, or municipality running a
 * transparency programme) commits a budget to cover submission gas for a
 * region and/or category. Reporters never see a payment step either way; the
 * only difference is who reimburses the paymaster.
 *
 * ANONYMITY RULE — the important part of this file:
 *
 * Sponsor attribution is AGGREGATE ONLY. It is never written per-report, on
 * chain or off. The reason: a per-report sponsor tag is a side channel. If a
 * sponsor's scope is narrow ("bribery reports in one district"), then tagging
 * a report with that sponsor narrows its anonymity set to exactly that
 * sponsor's scope — which can be far smaller than the set implied by the
 * coarse geohash the reporter consciously agreed to publish.
 *
 * So a sponsor gets verifiable impact metrics ("your pool funded 1,240
 * submissions this month") and never a per-report ledger. `MIN_SCOPE_REPORTS`
 * additionally refuses attribution for pools too small to hide in.
 */

export interface SponsorPool {
  id: string;
  /** Organization id of the funder. */
  orgId: string;
  /** Public-facing sponsor name, shown as attribution in-app. */
  displayName: string;
  /** Coarse geohash prefix this pool covers; empty means nationwide. */
  regionPrefix: string;
  /** Categories covered; empty means all categories. */
  categories: ReportCategory[];
  /** Committed budget in USD for the current period. */
  budgetUsd: number;
  /** Spent so far in USD, updated from paymaster accounting. */
  spentUsd: number;
  /** Submissions funded this period — the metric sponsors actually get. */
  fundedCount: number;
  periodStart: number;
  active: boolean;
}

/**
 * Below this many funded reports in a period, a pool is too small for its
 * attribution to be safe to display alongside a region, so the UI falls back
 * to the generic "gas sponsored by the Khabardar pool" wording.
 */
export const MIN_SCOPE_REPORTS = 50;

/** Indicative cost to sponsor one submission, all-in. See BUSINESS.md. */
export const EST_COST_PER_REPORT_USD = 0.03;

export function poolCoversReport(
  pool: SponsorPool,
  region: string,
  category: ReportCategory
): boolean {
  if (!pool.active) return false;
  if (pool.budgetUsd - pool.spentUsd < EST_COST_PER_REPORT_USD) return false;
  if (pool.regionPrefix && !region.toLowerCase().startsWith(pool.regionPrefix.toLowerCase())) {
    return false;
  }
  if (pool.categories.length && !pool.categories.includes(category)) return false;
  return true;
}

/**
 * Whether this pool is large enough that naming it cannot meaningfully narrow
 * who a given reporter might be.
 */
export function attributionIsSafe(pool: SponsorPool): boolean {
  return pool.fundedCount >= MIN_SCOPE_REPORTS;
}

export function remainingBudget(pool: SponsorPool): number {
  return Math.max(0, pool.budgetUsd - pool.spentUsd);
}

export function estimatedRemainingReports(pool: SponsorPool): number {
  return Math.floor(remainingBudget(pool) / EST_COST_PER_REPORT_USD);
}
