import { AMBIGUOUS_ALONE, GIVEN_NAMES, SURNAMES, TITLES } from "./names";
import { detectQuasiIdentifiers } from "./quasi";
import type { LeakFinding, LeakSeverity, LeakType } from "./types";

/*
 * Rule-based detectors for details that can identify a reporter.
 *
 * Everything here is plain string work so it runs on the device with no
 * network and no model. Each detector favours precision: a checker that flags
 * every number gets ignored, and then it catches nothing. The limits are
 * written up in docs/LEAK_CHECKER.md.
 *
 * Regex lookbehind is avoided on purpose. Older Hermes builds (React Native's
 * engine) reject it, so where a match needs context before it, the offset is
 * computed by hand instead.
 */

const REASONS: Record<LeakType, string> = {
  email: "An email address points straight to its owner.",
  phone: "A phone number can be traced to the person who owns it.",
  "national-id": "An ID number identifies exactly one person.",
  "vehicle-plate": "A number plate can be traced to the vehicle's owner.",
  "personal-url": "A social media link or handle leads to a personal account.",
  "street-address": "An exact address narrows the report down to one household.",
  "personal-name":
    "This looks like a person's name. If it is you, a relative or someone close to you, it can identify you. Names of the people you are reporting on are expected.",
  // Each quasi-identifier rule has its own reason in quasi.ts; this one is the fallback.
  "quasi-identifier": "This detail could narrow down who wrote the report.",
};

function finding(type: LeakType, start: number, text: string, severity: LeakSeverity): LeakFinding {
  return { type, start, end: start + text.length, text, severity, reason: REASONS[type] };
}

/**
 * Run a global regex and turn each match into a finding. When `group` is set,
 * only that capture group is flagged, located inside the full match by hand.
 */
function scan(
  text: string,
  re: RegExp,
  type: LeakType,
  severity: LeakSeverity,
  options: { group?: number; accept?: (span: string, match: RegExpMatchArray) => boolean } = {}
): LeakFinding[] {
  const out: LeakFinding[] = [];
  for (const m of text.matchAll(re)) {
    const whole = m[0];
    const span = options.group === undefined ? whole : m[options.group];
    if (!span) continue;
    if (options.accept && !options.accept(span, m)) continue;
    const offset = options.group === undefined ? 0 : whole.lastIndexOf(span);
    out.push(finding(type, (m.index ?? 0) + offset, span, severity));
  }
  return out;
}

// Email

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export function detectEmails(text: string): LeakFinding[] {
  return scan(text, EMAIL_RE, "email", "high");
}

// Phone

/** Nepal mobile: 96/97/98 then 8 more digits, optionally after +977 or 977. */
const NEPAL_MOBILE_RE = /(?:\+977[\s-]?|\b977[\s-]?|\b)9[678]\d(?:[\s-]?\d){7}\b/g;
/** Nepal landline with country code: +977-1-4412345, 977 61 523456. */
const NEPAL_LANDLINE_INTL_RE = /(?:\+977|\b977)[\s-]?0?\d{1,2}[\s-]?\d{6,7}\b/g;
/**
 * Nepal landline without country code. The dash after the area code is
 * required: "01-4412345" is a phone number, "014412345" could be anything.
 */
const NEPAL_LANDLINE_LOCAL_RE = /\b0\d{1,2}-\d{6,7}\b/g;
/** UK: +44 or a leading 0, then 10 digits starting 1, 2, 3 or 7, spaces and dashes allowed. */
const UK_PHONE_RE = /(?:\+44\s?(?:\(0\)\s?)?|\b0)[1237](?:[\s-]?\d){9}\b/g;

export function detectPhones(text: string): LeakFinding[] {
  return [
    ...scan(text, NEPAL_MOBILE_RE, "phone", "high"),
    ...scan(text, NEPAL_LANDLINE_INTL_RE, "phone", "high"),
    ...scan(text, NEPAL_LANDLINE_LOCAL_RE, "phone", "high"),
    ...scan(text, UK_PHONE_RE, "phone", "high"),
  ];
}

// National ID, citizenship, passport, licence

/** Nepali citizenship certificate numbers are often district-ward-year-serial: 27-01-72-12345. */
const CITIZENSHIP_SHAPE_RE = /\b\d{2}-\d{2}-\d{2}-\d{3,6}\b/g;
/**
 * Any number introduced by an ID keyword: "citizenship no. 123/4567",
 * "passport number PA1234567", "PAN: 302456789". Only the number is flagged.
 */
const ID_KEYWORD_RE =
  /\b(?:citizenship|nagarikta|national\s+id(?:entity)?|nid|nin|pan|passport|driving\s+licen[cs]e|licen[cs]e)(?:\s+card)?\s*(?:no\.?|number|num|#)?(?:\s+is)?\s*[:#.-]?\s*(\d[\d/ -]{3,18}\d|[A-Z]{1,2}\d{6,8})\b/gi;
/** UK National Insurance number, upper case only, with the prefixes HMRC never issues excluded. */
const UK_NINO_RE = /\b(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g;

export function detectNationalIds(text: string): LeakFinding[] {
  return [
    ...scan(text, CITIZENSHIP_SHAPE_RE, "national-id", "high"),
    ...scan(text, ID_KEYWORD_RE, "national-id", "high", { group: 1, accept: (span) => /\d/.test(span) }),
    ...scan(text, UK_NINO_RE, "national-id", "high"),
  ];
}

// Vehicle plates

/** Nepal zonal format: "Ba 2 Pa 1234", "Ga 1 Ja 45". */
const NEPAL_PLATE_RE =
  /\b(?:ba|ga|ja|ko|lu|me|na|pa|ra|sa|se|bhe|dha|ka|ma|mah)\s?\d{1,2}\s?(?:pa|cha|kha|ja|jha|ka|ga)\s?\d{1,4}\b/gi;
/** Nepal provincial format: "Bagmati 01-002 Pa 1234", "Province 3-01-002 Cha 5678". */
const NEPAL_PROVINCE_PLATE_RE =
  /\b(?:pradesh|province|koshi|madhesh|bagmati|gandaki|lumbini|karnali|sudurpaschim)\s?\d{1,2}[\s-]\d{2,3}(?:[\s-]\d{3})?\s?(?:pa|cha|kha|ja|jha|ka)\s?\d{1,4}\b/gi;
/** UK current format, upper case only: "AB12 CDE". */
const UK_PLATE_RE = /\b[A-Z]{2}\d{2}\s?[A-Z]{3}\b/g;

export function detectVehiclePlates(text: string): LeakFinding[] {
  return [
    ...scan(text, NEPAL_PLATE_RE, "vehicle-plate", "medium"),
    ...scan(text, NEPAL_PROVINCE_PLATE_RE, "vehicle-plate", "medium"),
    ...scan(text, UK_PLATE_RE, "vehicle-plate", "medium"),
  ];
}

// Personal URLs and handles

const SOCIAL_URL_RE =
  /\b(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|linkedin\.com\/in|youtube\.com|github\.com|t\.me|wa\.me)\/(@?[A-Za-z0-9_.-]{2,})/gi;
/** Paths on those sites that are not someone's account. */
const NON_PERSONAL_PATHS = new Set([
  "groups", "events", "watch", "share", "sharer", "sharer.php", "hashtag", "help", "policies", "login",
  "home", "explore", "search", "about", "intent", "p", "reel", "reels", "results", "privacy", "legal",
]);
/** A bare @handle after whitespace or an opening bracket, so emails are not matched. */
const HANDLE_RE = /(?:^|[\s(])(@[A-Za-z0-9_](?:[A-Za-z0-9_.]{1,28}[A-Za-z0-9_])?)/g;

export function detectPersonalUrls(text: string): LeakFinding[] {
  const urls = scan(text, SOCIAL_URL_RE, "personal-url", "high", {
    accept: (_span, m) => !NON_PERSONAL_PATHS.has(m[1].replace(/^@/, "").toLowerCase()),
  });
  const handles = scan(text, HANDLE_RE, "personal-url", "high", { group: 1 });
  return [...urls, ...handles];
}

// Street addresses

/** "house no. 23", "H. No 45", "flat 3B", "plot number 12/4". */
const HOUSE_NUMBER_RE =
  /\b(?:(?:house|flat|apartment|apt|plot)\s*(?:no\.?|number|#)?|h\.\s?no\.?)\s*[:.]?\s*\d+[A-Za-z]?(?:\/\d+)?\b/gi;
/** A house number followed by a capitalised street name: "12 Durbar Marg", "221B Baker Street". */
const NUMBERED_STREET_RE =
  /\b\d{1,4}[A-Za-z]?,?\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Close|Drive|Way|Place|Court|Gardens|Terrace|Crescent|Marg|Sadak|Galli|Tole)\b/g;
/** Full UK postcode, upper case: "NE1 8ST", "SW1A 1AA". A full postcode covers about fifteen addresses. */
const UK_POSTCODE_RE = /\b[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2}\b/g;

export function detectStreetAddresses(text: string): LeakFinding[] {
  return [
    ...scan(text, HOUSE_NUMBER_RE, "street-address", "medium"),
    ...scan(text, NUMBERED_STREET_RE, "street-address", "high"),
    ...scan(text, UK_POSTCODE_RE, "street-address", "high"),
  ];
}

// Personal names

/** Runs of capitalised words, plus the all-caps surnames KC and BK. */
const CAPITALISED_RUN_RE = /\b(?:[A-Z][a-z]+|KC|BK)(?:\s+(?:[A-Z][a-z]+|KC|BK))*\b/g;
const WORD_RE = /(?:[A-Z][a-z]+|KC|BK)/g;
/** An honorific then one to three capitalised words: "Mr. Thapa", "Shree Ram Bahadur". */
const TITLE_RE = /\b(Mr|Mrs|Ms|Miss|Dr|Shri|Shree|Sri|Smt|Sir)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g;
/** Capitalised words that end a name rather than continue it: "Laxmi Bank", "Krishna Mandir". */
const NOT_NAME_WORDS = new Set([
  "bank", "mandir", "temple", "road", "street", "marg", "sadak", "office", "ministry", "hospital",
  "school", "campus", "college", "chowk", "tole", "nagar", "municipality", "company", "limited", "ltd",
  "group", "trust", "foundation", "council", "department",
]);

function isListedName(word: string): boolean {
  const w = word.toLowerCase();
  return GIVEN_NAMES.has(w) || SURNAMES.has(w);
}

export function detectPersonalNames(text: string): LeakFinding[] {
  const out: LeakFinding[] = [...scan(text, TITLE_RE, "personal-name", "medium", {
    accept: (_span, m) => TITLES.has(m[1].toLowerCase()),
  })];

  for (const run of text.matchAll(CAPITALISED_RUN_RE)) {
    const runStart = run.index ?? 0;
    const words = [...run[0].matchAll(WORD_RE)].map((w) => ({
      word: w[0],
      start: runStart + (w.index ?? 0),
    }));

    const listed = words.map((w, i) => (isListedName(w.word) ? i : -1)).filter((i) => i >= 0);
    if (listed.length === 0) continue;
    const first = listed[0];
    let last = listed[listed.length - 1];

    if (listed.length === 1) {
      // One known word on its own. Surnames alone are skipped because many are
      // also community or language names ("Tamang", "Nepali"); ambiguous given
      // names alone are skipped because they are also everyday words.
      const only = words[first].word.toLowerCase();
      if (!GIVEN_NAMES.has(only) || AMBIGUOUS_ALONE.has(only)) continue;
    }

    // A given name is often followed by unlisted middle names or surnames
    // ("Hari Prasad Koirala"), so carry the span right over them.
    if (GIVEN_NAMES.has(words[last].word.toLowerCase())) {
      while (last + 1 < words.length && last - first < 3 && !NOT_NAME_WORDS.has(words[last + 1].word.toLowerCase())) {
        last++;
      }
    }

    const start = words[first].start;
    const end = words[last].start + words[last].word.length;
    out.push(finding("personal-name", start, text.slice(start, end), "medium"));
  }
  return out;
}

// All detectors

const SEVERITY_RANK: Record<LeakSeverity, number> = { high: 2, medium: 1, low: 0 };

/**
 * Keep one finding per stretch of text. Where two overlap, the more severe one
 * wins, then the longer one, so "ram.thapa@example.com" is reported as an email
 * and not also as a name.
 */
export function resolveOverlaps(findings: LeakFinding[]): LeakFinding[] {
  const ranked = [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start
  );
  const kept: LeakFinding[] = [];
  for (const f of ranked) {
    if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Every detector, in one pass, overlaps resolved, ordered by position. */
export function detectLeaks(text: string): LeakFinding[] {
  return resolveOverlaps([
    ...detectEmails(text),
    ...detectPhones(text),
    ...detectNationalIds(text),
    ...detectVehiclePlates(text),
    ...detectPersonalUrls(text),
    ...detectStreetAddresses(text),
    ...detectPersonalNames(text),
    ...detectQuasiIdentifiers(text),
  ]);
}
