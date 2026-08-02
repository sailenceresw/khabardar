import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EST_COST_PER_REPORT_USD,
  attributionIsSafe,
  poolCoversReport,
  type ReportCategory,
  type SponsorPool,
} from "@khabardar/shared";
import { safeJsonParse } from "./safeJson";

/**
 * Local store for sponsored gas pools.
 *
 * In production these live server-side next to the paymaster, because the
 * paymaster is what actually decides whether to sponsor a UserOperation and
 * which budget to debit. This module keeps the same shape so the client can
 * show correct attribution and the swap is mechanical.
 */

const POOLS_KEY = "khabardar.sponsor.pools.v1";

/** Seeded so the sponsorship surface is demonstrable without a backend. */
const DEMO_POOLS: SponsorPool[] = [
  {
    id: "pool_default",
    orgId: "org_khabardar",
    displayName: "Khabardar community pool",
    regionPrefix: "",
    categories: [],
    budgetUsd: 500,
    spentUsd: 12.4,
    fundedCount: 413,
    periodStart: Date.now() - 20 * 24 * 60 * 60 * 1000,
    active: true,
  },
  {
    id: "pool_demo_ngo",
    orgId: "org_demo_ngo",
    displayName: "Sample Transparency NGO (demo)",
    regionPrefix: "tsj",
    categories: [],
    budgetUsd: 250,
    spentUsd: 3.1,
    fundedCount: 104,
    periodStart: Date.now() - 12 * 24 * 60 * 60 * 1000,
    active: true,
  },
];

export async function listPools(): Promise<SponsorPool[]> {
  const stored = safeJsonParse<SponsorPool[]>(await AsyncStorage.getItem(POOLS_KEY));
  return stored ?? DEMO_POOLS;
}

export async function savePools(pools: SponsorPool[]): Promise<void> {
  await AsyncStorage.setItem(POOLS_KEY, JSON.stringify(pools));
}

export interface SponsorAttribution {
  poolId: string;
  /** Display string, or null when the pool is too small to name safely. */
  displayName: string | null;
}

/**
 * Pick the pool that will fund a submission.
 *
 * Most specific covering pool wins so earmarked regional money is spent before
 * the general pool. If the chosen pool is too small for safe attribution, the
 * pool still pays but goes unnamed — budget and anonymity are decided
 * separately, and anonymity wins.
 */
export async function resolveSponsor(
  region: string,
  category: ReportCategory
): Promise<SponsorAttribution | null> {
  const pools = (await listPools()).filter((p) => poolCoversReport(p, region, category));
  if (!pools.length) return null;

  const chosen = pools.sort(
    (a, b) => b.regionPrefix.length - a.regionPrefix.length || b.categories.length - a.categories.length
  )[0];

  return {
    poolId: chosen.id,
    displayName: attributionIsSafe(chosen) ? chosen.displayName : null,
  };
}

/**
 * Record that a pool funded one submission. Deliberately increments counters
 * only — no report id, hash, or timestamp is associated with the pool, because
 * a per-report sponsor ledger is exactly the correlation risk this design
 * avoids (see packages/shared/src/sponsor.ts).
 */
export async function recordSponsoredSubmission(poolId: string): Promise<void> {
  const pools = await listPools();
  await savePools(
    pools.map((p) =>
      p.id === poolId
        ? { ...p, spentUsd: p.spentUsd + EST_COST_PER_REPORT_USD, fundedCount: p.fundedCount + 1 }
        : p
    )
  );
}
