/*
 * npm run eval:leaks
 *
 * Scores the leak detectors against packages/shared/eval/leaks.dataset.json
 * and prints precision and recall per detector, then every miss and every
 * false alarm so the numbers can be checked by hand.
 *
 * npm run eval:leaks -- --write also replaces the results section of
 * docs/LEAK_CHECKER.md (between the eval:start and eval:end markers), so the
 * published numbers are always the output of this script and nothing else.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluate, formatTable, type Dataset, type Outcome } from "./leakEval";

const root = path.resolve(__dirname, "..", "..", "..");
const datasetPath = path.join(root, "packages", "shared", "eval", "leaks.dataset.json");
const docPath = path.join(root, "docs", "LEAK_CHECKER.md");

const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as Dataset;
const result = evaluate(dataset);
const table = formatTable(result);

const list = (outcomes: Outcome[]) =>
  outcomes.length === 0 ? "  none" : outcomes.map((o) => `  ${o.itemId}  ${o.detector}  "${o.text}"`).join("\n");

console.log(`Leak detector evaluation: ${result.items} texts, ${result.labels} labelled details\n`);
console.log(table);
console.log(`\nMissed (${result.misses.length}):\n${list(result.misses)}`);
console.log(`\nFalse alarms (${result.falseAlarms.length}):\n${list(result.falseAlarms)}`);

if (process.argv.includes("--write")) {
  const doc = readFileSync(docPath, "utf8");
  const start = "<!-- eval:start -->";
  const end = "<!-- eval:end -->";
  const a = doc.indexOf(start);
  const b = doc.indexOf(end);
  if (a < 0 || b < a) {
    console.error(`\n${docPath} has no ${start} ... ${end} section to replace.`);
    process.exit(1);
  }
  const section = [
    start,
    `Measured on ${result.items} synthetic texts with ${result.labels} labelled details (\`npm run eval:leaks\`).`,
    "",
    table,
    end,
  ].join("\n");
  writeFileSync(docPath, doc.slice(0, a) + section + doc.slice(b + end.length));
  console.log(`\nWrote the results table to ${path.relative(root, docPath)}.`);
}
