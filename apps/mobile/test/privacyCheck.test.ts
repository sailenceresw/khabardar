import { describe, expect, it } from "vitest";
import { detectLeaks, type LeakFinding } from "@khabardar/shared";
import {
  findingKey,
  openFindings,
  reasonKey,
  redactFinding,
  replaceFinding,
  segmentBody,
} from "../src/privacyCheck";
import en from "../src/i18n/en.json";

const BODY = "I am the only accountant here. Call me on 9841234567 or write to sita.k@gmail.com.";

const first = (body: string, type: LeakFinding["type"]) => {
  const f = detectLeaks(body).find((x) => x.type === type);
  if (!f) throw new Error(`no ${type} finding in test body`);
  return f;
};

describe("openFindings", () => {
  it("returns every finding when nothing is kept", () => {
    expect(openFindings(BODY, new Set()).map((f) => f.type)).toEqual(["quasi-identifier", "phone", "email"]);
  });

  it("drops a finding the reporter chose to keep", () => {
    const kept = new Set([findingKey(first(BODY, "phone"))]);
    expect(openFindings(BODY, kept).map((f) => f.type)).toEqual(["quasi-identifier", "email"]);
  });

  it("still treats a kept finding as kept after earlier text changes", () => {
    const kept = new Set([findingKey(first(BODY, "email"))]);
    const edited = "Some new opening sentence. " + BODY;
    expect(openFindings(edited, kept).some((f) => f.type === "email")).toBe(false);
  });
});

describe("findingKey", () => {
  it("ignores case and surrounding spaces, so a re-detected span matches", () => {
    const a = { type: "email" as const, text: "Sita.K@gmail.com" };
    const b = { type: "email" as const, text: " sita.k@gmail.com " };
    expect(findingKey(a)).toBe(findingKey(b));
  });

  it("tells two rules apart even on the same text", () => {
    expect(findingKey({ type: "quasi-identifier", rule: "exact-time", text: "4 pm" })).not.toBe(
      findingKey({ type: "quasi-identifier", rule: "exact-date", text: "4 pm" })
    );
  });
});

describe("redactFinding and replaceFinding", () => {
  it("redacts the exact span and leaves the rest alone", () => {
    const out = redactFinding(BODY, first(BODY, "phone"), "[removed]");
    expect(out).toBe("I am the only accountant here. Call me on [removed] or write to sita.k@gmail.com.");
  });

  it("replaces a span with the reporter's own wording", () => {
    const out = replaceFinding(BODY, first(BODY, "quasi-identifier"), "I work in the accounts section");
    expect(out.startsWith("I work in the accounts section here.")).toBe(true);
  });

  it("refuses to edit when the finding no longer matches the text", () => {
    const stale = first(BODY, "phone");
    const changed = BODY.replace("Call me", "Ring me");
    expect(replaceFinding(changed, { ...stale, start: stale.start + 1, end: stale.end + 1 }, "X")).toBe(changed);
  });

  it("clears the finding once redacted", () => {
    const out = redactFinding(BODY, first(BODY, "email"), "[removed]");
    expect(openFindings(out, new Set()).some((f) => f.type === "email")).toBe(false);
  });
});

describe("segmentBody", () => {
  it("covers the whole body in order, with flagged spans marked", () => {
    const findings = detectLeaks(BODY);
    const segments = segmentBody(BODY, findings);
    expect(segments.map((s) => s.text).join("")).toBe(BODY);
    expect(segments.filter((s) => s.finding).map((s) => s.text)).toEqual(findings.map((f) => f.text));
  });

  it("returns the body as one plain segment when nothing is flagged", () => {
    expect(segmentBody("Nothing here.", [])).toEqual([{ text: "Nothing here." }]);
  });

  it("skips an overlapping finding instead of drawing it twice", () => {
    const a: LeakFinding = { type: "email", start: 0, end: 5, text: "abcde", severity: "high", reason: "" };
    const b: LeakFinding = { type: "phone", start: 3, end: 7, text: "defg", severity: "high", reason: "" };
    expect(segmentBody("abcdefgh", [a, b]).map((s) => s.text)).toEqual(["abcde", "fgh"]);
  });
});

describe("reasonKey", () => {
  /** Every key this module can ask for must exist in the English pack, or the screen shows a raw key. */
  const lookup = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);

  it("has an English explanation for every finding type and quasi-identifier rule", () => {
    const samples = [
      "I am the only accountant here. Only I had the key. I work as the cashier. It was on my desk.",
      "I was asked to sign it. Only three of us knew. It was at 4:15 on 3 March.",
      "Mail a@b.co, call 9841234567, ID 27-01-72-12345, jeep Ba 2 Pa 1234, facebook.com/ram.k, house no. 3, Sita Thapa.",
    ];
    const keys = new Set(samples.flatMap((s) => detectLeaks(s).map(reasonKey)));
    expect(keys.size).toBeGreaterThanOrEqual(14);
    for (const key of keys) expect(typeof lookup(key), key).toBe("string");
  });
});
