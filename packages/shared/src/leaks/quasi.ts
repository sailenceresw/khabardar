import type { LeakFinding, LeakSeverity, QuasiRule } from "./types";

/*
 * Quasi-identifiers: first-person details that do not name anyone but narrow
 * the field until one person is left. "I am the only accountant" is enough for
 * anyone in that office.
 *
 * Every rule needs the reporter to be talking about themselves ("I", "my"),
 * because the same detail about someone else is the substance of a report, not
 * a leak. Dates and times are the exception: they are flagged at low severity
 * because a witness-only time can identify the witness whoever's voice it is in.
 */

interface Rule {
  rule: QuasiRule;
  re: RegExp;
  severity: LeakSeverity | ((match: string) => LeakSeverity);
  reason: string;
}

const ROLE_WORDS =
  "accountant|cashier|driver|secretary|storekeeper|store\\s+keeper|clerk|engineer|officer|auditor|treasurer|guard|peon|typist|receptionist|nurse|doctor|teacher|principal|manager|supervisor|inspector|surveyor|kharidar|subba|nayab\\s+subba|assistant";
const ROLE_PREFIX = "(?:(?:chief|head|senior|junior|assistant|deputy|personal|private|only)\\s+)?";

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?" +
  "|baisakh|jestha|asar|ashad|shrawan|saun|bhadra|asoj|ashwin|kartik|mangsir|poush|magh|falgun|chaitra";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";

const RULES: Rule[] = [
  {
    rule: "unique-role",
    // "I am the only accountant", "I'm the sole driver", "I was the one cashier".
    re: /\b(?:i\s+am|i'm|i\s+was|i've\s+been|i\s+have\s+been)\s+the\s+(?:only|sole|one|single)\s+(?:[a-z]+\s+){0,2}?[a-z]+(?:\s+(?:in|at|on|for)\s+(?:the|our|this|my)\s+[a-z]+)?/gi,
    severity: "medium",
    reason: "Saying you are the only person in a role points straight to you.",
  },
  {
    rule: "only-i",
    // "only I had the key", "only I can approve".
    re: /\bonly\s+i\s+(?:have|had|can|could|know|knew|handle|handled|sign|signed|keep|kept|hold|held|see|saw)\b(?:\s+[a-z]+){0,2}/gi,
    severity: "medium",
    reason: "If only you could have known or done this, the detail identifies you.",
  },
  {
    rule: "first-person-role",
    // "I work as the cashier", "my post is head accountant".
    re: new RegExp(
      `\\b(?:i\\s+am|i'm|i\\s+was|i\\s+work(?:ed)?\\s+as|my\\s+(?:job|post|position|role|title)\\s+is)\\s+(the|a|an)?\\s*${ROLE_PREFIX}(?:${ROLE_WORDS})\\b`,
      "gi"
    ),
    // "the cashier" is one person; "a clerk" may be one of many.
    severity: (m) => (/\bthe\b|\bis\s+(?!a\b|an\b)/i.test(m) ? "medium" : "low"),
    reason: "Your job title narrows down who wrote this, especially in a small office.",
  },
  {
    rule: "personal-workspace",
    // "my desk", "my own counter", "my login".
    re: /\bmy\s+(?:own\s+)?(?:desk|office|counter|cabin|cubicle|computer|laptop|login|password|drawer|locker|section|branch|unit|shift|team|room)\b/gi,
    severity: "medium",
    reason: "A place or account that is yours narrows the report to whoever uses it.",
  },
  {
    rule: "personal-access",
    // "I was asked to sign", "I personally approved".
    re: /\bi\s+(?:(?:was|am)\s+(?:asked|told|ordered|made|forced)\s+to|had\s+to)\s+(?:sign|approve|process|stamp|enter|delete|forge|change|hide|shred|pay|transfer|release|alter)\b|\bi\s+(?:personally\s+)?(?:signed|approved|processed|stamped|deleted|transferred|released|handled|typed|prepared|audited|forged|altered)\b/gi,
    severity: "medium",
    reason: "Describing what you did with the file or the money shows you had access to it, which few people may have.",
  },
  {
    rule: "small-group",
    // "only three of us", "just me and the manager", "since I joined", "after my transfer".
    re: /\b(?:only|just)\s+(?:two|three|four|five|2|3|4|5)\s+of\s+us\b|\b(?:just|only)\s+me\s+and\b|\b(?:since|when|after|before)\s+i\s+(?:joined|was\s+transferred|was\s+promoted|was\s+appointed|started)\b|\bmy\s+(?:transfer|promotion|appointment|posting)\b/gi,
    severity: "medium",
    reason: "A small group or a recent move narrows the report to very few people.",
  },
  {
    rule: "exact-time",
    // "at 4:15", "16:45", "4 pm", "10.30 a.m.". A bare "4.50" is left alone: it is usually money.
    re: /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:am|pm|a\.m\.|p\.m\.))?(?![\d:])|\b(?:1[0-2]|0?[1-9])(?:[.:][0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.)(?![a-z])/gi,
    severity: "low",
    reason: "An exact time can show who was there. Consider \"in the afternoon\" instead.",
  },
  {
    rule: "exact-date",
    // "3 March", "March 3rd", "15 Falgun", "2081/05/12", "12/03/2024".
    re: new RegExp(
      `\\b(?:${DAY}\\s+(?:of\\s+)?(?:${MONTHS})|(?:${MONTHS})\\s+${DAY}(?!\\d))\\b|\\b\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}\\b|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b`,
      "gi"
    ),
    severity: "low",
    reason: "An exact date can narrow things down if few people were there that day. A week or a month may be enough.",
  },
];

export function detectQuasiIdentifiers(text: string): LeakFinding[] {
  const out: LeakFinding[] = [];
  for (const { rule, re, severity, reason } of RULES) {
    for (const m of text.matchAll(re)) {
      const span = m[0].trimEnd();
      const start = m.index ?? 0;
      out.push({
        type: "quasi-identifier",
        rule,
        start,
        end: start + span.length,
        text: span,
        severity: typeof severity === "function" ? severity(span) : severity,
        reason,
      });
    }
  }
  return out;
}
