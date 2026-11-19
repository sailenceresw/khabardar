import { describe, expect, it } from "vitest";
import { OrgPlan, PLAN_ENTITLEMENTS, PLAN_PRICE_USD_MONTH } from "@khabardar/shared";
import { planCards } from "../src/plans";
import en from "../src/i18n/en.json";

const lookup = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);

describe("planCards", () => {
  const cards = planCards();

  it("lists the three plans in order, cheapest first", () => {
    expect(cards.map((c) => c.plan)).toEqual([OrgPlan.Community, OrgPlan.Pro, OrgPlan.Institutional]);
  });

  it("takes prices from the constants the app enforces, matching BUSINESS.md", () => {
    expect(cards.map((c) => c.priceUsdMonth)).toEqual([0, 400, 1500]);
    for (const c of cards) expect(c.priceUsdMonth).toBe(PLAN_PRICE_USD_MONTH[c.plan]);
  });

  it("promises only features the plan's entitlements grant", () => {
    for (const c of cards) {
      const e = PLAN_ENTITLEMENTS[c.plan];
      const keys = c.features.map((f) => f.key);
      expect(keys.includes("plans.feature.export")).toBe(e.export);
      expect(keys.includes("plans.feature.api")).toBe(e.api);
      expect(keys.includes("plans.feature.analytics")).toBe(e.analytics);
      expect(keys.includes("plans.feature.cases")).toBe(e.caseManagement);
      expect(c.features[0]).toEqual({ key: "plans.feature.seats", options: { count: e.seats } });
    }
  });

  it("shows the API limit with thousands separators", () => {
    const pro = cards.find((c) => c.plan === OrgPlan.Pro)!;
    expect(pro.features.find((f) => f.key === "plans.feature.api")?.options).toEqual({ count: "5,000" });
  });

  it("has an English string for every key it uses", () => {
    for (const c of cards) {
      for (const key of [c.nameKey, c.forKey, ...c.features.map((f) => f.key)]) {
        expect(lookup(key), key).toBeTruthy();
      }
    }
  });
});
