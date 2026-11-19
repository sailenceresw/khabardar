import { describe, expect, it } from "vitest";
import { TABS, tabBarVisible } from "../src/tabs";
import en from "../src/i18n/en.json";
import hi from "../src/i18n/hi.json";

const lookup = (pack: unknown, key: string) =>
  key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], pack);

describe("tab bar", () => {
  it("shows on the top-level screens", () => {
    for (const path of ["/", "/feed", "/org", "/settings"]) expect(tabBarVisible(path), path).toBe(true);
  });

  it("stays out of flows where it would lose the reporter's place", () => {
    for (const path of ["/onboarding", "/compose", "/compose/privacy", "/compose/review", "/feed/9001", "/report/rep_1", "/org-feed"]) {
      expect(tabBarVisible(path), path).toBe(false);
    }
  });

  it("has exactly one primary action, and it starts a report", () => {
    const primary = TABS.filter((tab) => tab.primary);
    expect(primary).toHaveLength(1);
    expect(primary[0].href).toBe("/compose");
  });

  it("has a label in English and Hindi for every tab", () => {
    for (const tab of TABS) {
      expect(typeof lookup(en, tab.labelKey), tab.labelKey).toBe("string");
      expect(typeof lookup(hi, tab.labelKey), tab.labelKey).toBe("string");
    }
  });
});
