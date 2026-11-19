import { ORG_PLAN_KEYS, OrgPlan, PLAN_ENTITLEMENTS, PLAN_PRICE_USD_MONTH } from "@khabardar/shared";

/**
 * What the plans page shows, built from the same constants the app enforces
 * (`PLAN_PRICE_USD_MONTH`, `PLAN_ENTITLEMENTS`), so the page cannot promise a
 * limit the app does not apply. Who each plan is for comes from BUSINESS.md.
 */

export interface PlanCard {
  plan: OrgPlan;
  nameKey: string;
  /** i18n key for who the plan is for. */
  forKey: string;
  priceUsdMonth: number;
  /** Feature lines as i18n keys with their options, in display order. */
  features: Array<{ key: string; options?: Record<string, unknown> }>;
}

const FOR_KEYS: Record<OrgPlan, string> = {
  [OrgPlan.Community]: "plans.for.community",
  [OrgPlan.Pro]: "plans.for.pro",
  [OrgPlan.Institutional]: "plans.for.institutional",
};

export const PLAN_ORDER: OrgPlan[] = [OrgPlan.Community, OrgPlan.Pro, OrgPlan.Institutional];

export function planCards(): PlanCard[] {
  return PLAN_ORDER.map((plan) => {
    const e = PLAN_ENTITLEMENTS[plan];
    const features: PlanCard["features"] = [{ key: "plans.feature.seats", options: { count: e.seats } }];
    if (e.advancedSearch) features.push({ key: "plans.feature.search" });
    if (e.export) features.push({ key: "plans.feature.export" });
    if (e.analytics) features.push({ key: "plans.feature.analytics" });
    if (e.caseManagement) features.push({ key: "plans.feature.cases" });
    if (e.api) features.push({ key: "plans.feature.api", options: { count: e.apiCallsPerDay.toLocaleString("en-US") } });
    return {
      plan,
      nameKey: ORG_PLAN_KEYS[plan],
      forKey: FOR_KEYS[plan],
      priceUsdMonth: PLAN_PRICE_USD_MONTH[plan],
      features,
    };
  });
}
