#!/usr/bin/env node
/**
 * Fail the build when the two language packs disagree.
 *
 * Hindi is not a nice-to-have in this app. A reporter who cannot read the
 * warning that their connection is direct cannot judge the risk of filing, and
 * a missing key renders as its own raw dotted path — so a half-translated
 * screen ships looking like a glitch instead of reading like a warning.
 *
 * Parsing is checked too, not just parity. The language packs are large and get
 * edited by hand, and invalid JSON in one of them is what broke CI the last time
 * this repo went red: `tsc` reported it as a syntax error at line 1 column 1,
 * which says nothing useful about which edit caused it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const localeDir = join(here, "..", "apps", "mobile", "src", "i18n");

function load(name) {
  const path = join(localeDir, `${name}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`${name}.json could not be read as JSON: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Flatten to dotted paths, so a report names the key a screen actually asks for
 * rather than the section it happens to live in.
 */
function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, inner]) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? flatten(inner, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );
}

const enKeys = flatten(load("en"));
const hiKeys = flatten(load("hi"));

const missing = enKeys.filter((key) => !hiKeys.includes(key));
const extra = hiKeys.filter((key) => !enKeys.includes(key));

function report(label, keys) {
  if (!keys.length) return;
  console.error(`${label} (${keys.length}):`);
  for (const key of keys) console.error(`  ${key}`);
}

if (missing.length || extra.length) {
  report("Missing from hi.json", missing);
  report("In hi.json but not en.json", extra);
  console.error("\nEvery string needs both locales. Add the key, or remove it from both.");
  process.exit(1);
}

console.log(`i18n parity OK: ${enKeys.length} keys in both locales.`);
