import { detectLeaks, type LeakFinding, type LeakType, type QuasiRule } from "@khabardar/shared";

/*
 * Precision and recall for the leak detectors against a labelled dataset.
 *
 * Each detector is scored on its own. A quasi-identifier rule counts as its
 * own detector, because "exact-date" and "unique-role" fail in different ways
 * and one good number should not hide a bad one.
 *
 * Matching is one to one and by overlapping span: a prediction is a true
 * positive when it overlaps a not-yet-matched label for the same detector.
 * Exact boundaries are not scored, since "Mr. Adhikari" and "Adhikari" point
 * the reporter at the same thing.
 */

export interface Label {
  type: LeakType;
  rule?: QuasiRule;
  /** Must appear verbatim in the item's text. */
  text: string;
}

export interface EvalItem {
  id: string;
  text: string;
  expected: Label[];
}

export interface Dataset {
  items: EvalItem[];
}

export interface Row {
  detector: string;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export interface Outcome {
  itemId: string;
  detector: string;
  text: string;
}

export interface EvalResult {
  items: number;
  labels: number;
  rows: Row[];
  quasiTotal: Row;
  directTotal: Row;
  overall: Row;
  /** Labels nothing matched. */
  misses: Outcome[];
  /** Predictions that matched no label. */
  falseAlarms: Outcome[];
}

const DIRECT: LeakType[] = [
  "email",
  "phone",
  "national-id",
  "vehicle-plate",
  "personal-url",
  "street-address",
  "personal-name",
];
const RULES: QuasiRule[] = [
  "unique-role",
  "only-i",
  "first-person-role",
  "personal-workspace",
  "personal-access",
  "small-group",
  "exact-time",
  "exact-date",
];

export function detectorKey(x: { type: LeakType; rule?: QuasiRule }): string {
  return x.type === "quasi-identifier" ? `quasi:${x.rule ?? "unknown"}` : x.type;
}

interface Span {
  key: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Turn an item's labels into spans. A label text that appears twice is matched
 * to successive occurrences. Throws on a label that is not in the text, since
 * that is a broken dataset, not a detector result.
 */
export function labelSpans(item: EvalItem): Span[] {
  const used = new Map<string, number>();
  return item.expected.map((label) => {
    const from = used.get(label.text) ?? 0;
    const start = item.text.indexOf(label.text, from);
    if (start < 0) throw new Error(`${item.id}: label "${label.text}" is not in the text`);
    used.set(label.text, start + label.text.length);
    return { key: detectorKey(label), start, end: start + label.text.length, text: label.text };
  });
}

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

function row(detector: string, tp: number, fp: number, fn: number): Row {
  return { detector, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
}

function sum(detector: string, rows: Row[]): Row {
  const total = (k: "tp" | "fp" | "fn") => rows.reduce((n, r) => n + r[k], 0);
  return row(detector, total("tp"), total("fp"), total("fn"));
}

export function evaluate(dataset: Dataset, detect: (text: string) => LeakFinding[] = detectLeaks): EvalResult {
  const counts = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (key: string, field: "tp" | "fp" | "fn") => {
    const c = counts.get(key) ?? { tp: 0, fp: 0, fn: 0 };
    c[field]++;
    counts.set(key, c);
  };
  const misses: Outcome[] = [];
  const falseAlarms: Outcome[] = [];
  let labels = 0;

  for (const item of dataset.items) {
    const expected = labelSpans(item);
    labels += expected.length;
    const matched = new Set<number>();

    for (const p of detect(item.text)) {
      const key = detectorKey(p);
      const hit = expected.findIndex(
        (e, i) => !matched.has(i) && e.key === key && p.start < e.end && e.start < p.end
      );
      if (hit >= 0) {
        matched.add(hit);
        bump(key, "tp");
      } else {
        bump(key, "fp");
        falseAlarms.push({ itemId: item.id, detector: key, text: p.text });
      }
    }
    expected.forEach((e, i) => {
      if (matched.has(i)) return;
      bump(e.key, "fn");
      misses.push({ itemId: item.id, detector: e.key, text: e.text });
    });
  }

  const rowFor = (key: string) => {
    const c = counts.get(key) ?? { tp: 0, fp: 0, fn: 0 };
    return row(key, c.tp, c.fp, c.fn);
  };
  const directRows = DIRECT.map(rowFor);
  const quasiRows = RULES.map((r) => rowFor(`quasi:${r}`));
  const directTotal = sum("direct identifiers", directRows);
  const quasiTotal = sum("quasi-identifiers", quasiRows);

  return {
    items: dataset.items.length,
    labels,
    rows: [...directRows, ...quasiRows],
    directTotal,
    quasiTotal,
    overall: sum("all detectors", [directTotal, quasiTotal]),
    misses,
    falseAlarms,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

/** A markdown table, the same text printed to the console and written to the docs. */
export function formatTable(result: EvalResult): string {
  const line = (r: Row) => `| ${r.detector} | ${r.tp} | ${r.fp} | ${r.fn} | ${pct(r.precision)} | ${pct(r.recall)} |`;
  return [
    "| Detector | True positives | False positives | Missed | Precision | Recall |",
    "|---|---|---|---|---|---|",
    ...result.rows.map(line),
    line(result.directTotal),
    line(result.quasiTotal),
    line(result.overall),
  ].join("\n");
}
