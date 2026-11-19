import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LeakFinding } from "@khabardar/shared";
import { detectorKey, evaluate, formatTable, labelSpans, type Dataset } from "../scripts/leakEval";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const dataset = JSON.parse(
  readFileSync(path.join(root, "packages", "shared", "eval", "leaks.dataset.json"), "utf8")
) as Dataset;

const TYPES = new Set([
  "email",
  "phone",
  "national-id",
  "vehicle-plate",
  "personal-url",
  "street-address",
  "personal-name",
  "quasi-identifier",
]);

describe("the evaluation dataset", () => {
  it("has at least 60 texts with unique ids", () => {
    expect(dataset.items.length).toBeGreaterThanOrEqual(60);
    expect(new Set(dataset.items.map((i) => i.id)).size).toBe(dataset.items.length);
  });

  it("has every label verbatim in its text, with a known type, and a rule on quasi-identifiers", () => {
    for (const item of dataset.items) {
      expect(() => labelSpans(item), item.id).not.toThrow();
      for (const label of item.expected) {
        expect(TYPES.has(label.type), `${item.id} ${label.type}`).toBe(true);
        if (label.type === "quasi-identifier") expect(label.rule, item.id).toBeTruthy();
      }
    }
  });

  it("includes clean texts, so false alarms can be counted", () => {
    expect(dataset.items.filter((i) => i.expected.length === 0).length).toBeGreaterThanOrEqual(15);
  });
});

/** A fake detector that returns fixed findings, to test the scoring on its own. */
const finding = (over: Partial<LeakFinding>): LeakFinding => ({
  type: "phone",
  start: 0,
  end: 1,
  text: "",
  severity: "high",
  reason: "",
  ...over,
});

const tiny: Dataset = {
  items: [
    { id: "a", text: "call 9841234567 now", expected: [{ type: "phone", text: "9841234567" }] },
    { id: "b", text: "nothing to see", expected: [] },
  ],
};

describe("evaluate", () => {
  it("scores a perfect detector at 100% precision and recall", () => {
    const perfect = (text: string) =>
      text.includes("9841234567") ? [finding({ start: 5, end: 15, text: "9841234567" })] : [];
    const r = evaluate(tiny, perfect);
    expect(r.overall).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 });
  });

  it("reports precision as n/a, not 0 or 100%, when a detector never fires", () => {
    const r = evaluate(tiny, () => []);
    expect(r.overall).toMatchObject({ tp: 0, fp: 0, fn: 1, precision: null, recall: 0 });
    expect(r.misses).toEqual([{ itemId: "a", detector: "phone", text: "9841234567" }]);
  });

  it("counts a finding on a clean text as a false alarm", () => {
    const r = evaluate(tiny, (text) => (text === "nothing to see" ? [finding({ start: 0, end: 7, text: "nothing" })] : []));
    expect(r.overall.fp).toBe(1);
    expect(r.falseAlarms[0]).toMatchObject({ itemId: "b", text: "nothing" });
  });

  it("matches one prediction per label, so a duplicate counts as a false alarm", () => {
    const twice = () => [finding({ start: 5, end: 15 }), finding({ start: 6, end: 10 })];
    const r = evaluate({ items: [tiny.items[0]] }, twice);
    expect(r.overall).toMatchObject({ tp: 1, fp: 1, fn: 0 });
  });

  it("does not credit a finding of the wrong type", () => {
    const wrong = () => [finding({ type: "email", start: 5, end: 15 })];
    const r = evaluate({ items: [tiny.items[0]] }, wrong);
    expect(r.overall).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });

  it("scores each quasi-identifier rule as its own detector", () => {
    expect(detectorKey({ type: "quasi-identifier", rule: "exact-date" })).toBe("quasi:exact-date");
    expect(detectorKey({ type: "phone" })).toBe("phone");
  });
});

describe("published results", () => {
  it("match what the script produces now, so the docs cannot go stale", () => {
    const doc = readFileSync(path.join(root, "docs", "LEAK_CHECKER.md"), "utf8");
    const section = doc.slice(doc.indexOf("<!-- eval:start -->"), doc.indexOf("<!-- eval:end -->"));
    const result = evaluate(dataset);
    expect(section, "run `npm run eval:leaks -- --write` and commit the result").toContain(formatTable(result));
    expect(section).toContain(`Measured on ${result.items} synthetic texts with ${result.labels} labelled details`);
  });
});
