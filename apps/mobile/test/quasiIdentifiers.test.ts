import { describe, expect, it } from "vitest";
import { detectLeaks, detectQuasiIdentifiers, type QuasiRule } from "@khabardar/shared";

/** Findings for one rule only, so each test is about that rule and nothing else. */
function byRule(text: string, rule: QuasiRule) {
  return detectQuasiIdentifiers(text).filter((f) => f.rule === rule);
}

/**
 * Each rule has sentences it must flag, with the expected span and severity,
 * and sentences it must not flag. The negatives matter as much as the
 * positives: a checker that warns on every sentence teaches people to ignore it.
 */
const CASES: Record<
  QuasiRule,
  { flag: Array<[sentence: string, span: string, severity: "medium" | "low"]>; ignore: string[] }
> = {
  "unique-role": {
    flag: [
      ["I am the only accountant in the office and I saw it.", "I am the only accountant in the office", "medium"],
      // The place after the role is part of what identifies someone, so it is in the span.
      ["I'm the sole driver for the district chief.", "I'm the sole driver for the district", "medium"],
      ["I was the only woman on the committee.", "I was the only woman on the committee", "medium"],
    ],
    ignore: [
      "The only reason I went was the notice.",
      "I am not the only one who noticed.",
      "He is the only accountant there.",
      "This is the only office that charges extra.",
    ],
  },
  "only-i": {
    flag: [
      ["Only I had the key to that cabinet.", "Only I had the key", "medium"],
      ["only I can approve payments", "only I can approve payments", "medium"],
    ],
    ignore: ["Only they had the key.", "I only had the key for a day.", "Not only I but many others saw it."],
  },
  "first-person-role": {
    flag: [
      ["I work as the cashier at the branch.", "I work as the cashier", "medium"],
      ["My post is head accountant.", "My post is head accountant", "medium"],
      ["I am a clerk in the land office.", "I am a clerk", "low"],
      ["I was an engineer on that project.", "I was an engineer", "low"],
    ],
    ignore: [
      "The cashier took the money.",
      "I am a citizen of this ward.",
      "I am worried about the engineer.",
      "She works as the accountant.",
    ],
  },
  "personal-workspace": {
    flag: [
      ["The files were left on my desk overnight.", "my desk", "medium"],
      ["They used my login to approve it.", "my login", "medium"],
      ["Someone opened my own drawer.", "my own drawer", "medium"],
    ],
    ignore: ["In my opinion this is wrong.", "My family is worried.", "The desk was empty.", "Their office was locked."],
  },
  "personal-access": {
    flag: [
      ["I was asked to sign the false voucher.", "I was asked to sign", "medium"],
      ["I personally approved the transfer under pressure.", "I personally approved", "medium"],
      ["I had to delete the entries.", "I had to delete", "medium"],
    ],
    ignore: ["They signed the voucher.", "He approved it himself.", "I think it was approved.", "I entered the room late."],
  },
  "small-group": {
    flag: [
      ["There are only three of us in the section.", "only three of us", "medium"],
      ["It was just me and the manager.", "just me and", "medium"],
      ["Since I joined in 2079 this has happened.", "Since I joined", "medium"],
      ["After my transfer the payments started.", "my transfer", "medium"],
    ],
    ignore: ["Three of them were involved.", "After they joined, it got worse.", "Many of us have seen it."],
  },
  "exact-time": {
    flag: [
      ["He took the cash at 4:15 on Friday.", "4:15", "low"],
      ["The meeting ended at 16:45.", "16:45", "low"],
      ["They came back at 10.30 a.m.", "10.30 a.m.", "low"],
      ["It happens every day at 4 pm.", "4 pm", "low"],
    ],
    ignore: ["The fee was Rs 4.50 per page.", "The ratio was 3:1 in their favour.", "I am sure of it.", "It was in the afternoon."],
  },
  "exact-date": {
    flag: [
      ["It happened on 3 March.", "3 March", "low"],
      ["He was paid on March 3rd.", "March 3rd", "low"],
      ["The audit was on 15 Falgun.", "15 Falgun", "low"],
      ["Entered on 2081/05/12 in the register.", "2081/05/12", "low"],
      ["The receipt is dated 12/03/2024.", "12/03/2024", "low"],
    ],
    ignore: [
      "It started in March 2024.",
      "This has gone on since 2080.",
      "May I add one more thing?",
      "They gave 2 marks to everyone.",
      "Half of them, 1/2, never came.",
    ],
  },
};

describe.each(Object.entries(CASES) as Array<[QuasiRule, (typeof CASES)[QuasiRule]]>)("rule %s", (rule, { flag, ignore }) => {
  it.each(flag)("flags %j", (sentence, span, severity) => {
    const found = byRule(sentence, rule);
    expect(found.map((f) => f.text)).toEqual([span]);
    expect(found[0].severity).toBe(severity);
    expect(found[0].type).toBe("quasi-identifier");
    expect(sentence.slice(found[0].start, found[0].end)).toBe(span);
    expect(found[0].reason.length).toBeGreaterThan(10);
  });

  it.each(ignore)("does not flag %j", (sentence) => {
    expect(byRule(sentence, rule)).toEqual([]);
  });
});

describe("quasi-identifiers inside detectLeaks", () => {
  it("reports one finding where a unique role and a job title overlap", () => {
    const found = detectLeaks("I am the only accountant here.").filter((f) => f.type === "quasi-identifier");
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe("I am the only accountant");
  });

  it("keeps a direct identifier over an overlapping low-severity date", () => {
    const found = detectLeaks("certificate 27-01-72-12345 issued");
    expect(found.map((f) => f.type)).toEqual(["national-id"]);
  });

  it("flags nothing in a report written without first-person details", () => {
    const text =
      "Staff at the district land office charge Rs 5,000 extra per registration. " +
      "The money is collected in cash and is not receipted. This has gone on since 2080.";
    expect(detectLeaks(text)).toEqual([]);
  });
});
