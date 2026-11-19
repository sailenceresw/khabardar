/** What kind of identifying detail a finding is. One detector per type. */
export type LeakType =
  | "email"
  | "phone"
  | "national-id"
  | "vehicle-plate"
  | "personal-url"
  | "street-address"
  | "personal-name"
  | "quasi-identifier";

/**
 * Which quasi-identifier rule produced a finding. Quasi-identifiers do not
 * name anyone; they narrow the field until one person is left.
 */
export type QuasiRule =
  | "unique-role"
  | "only-i"
  | "first-person-role"
  | "personal-workspace"
  | "personal-access"
  | "small-group"
  | "exact-time"
  | "exact-date";

/**
 * How directly the detail points at a person.
 *
 * - `high`: identifies someone on its own (an email, a phone number, an ID).
 * - `medium`: narrows things a lot, or identifies someone only some of the time
 *   (a name that may be the accused's rather than the reporter's, a plate).
 * - `low`: worth a second look. Often needed in a report (a date), but it can
 *   narrow things down when combined with other details.
 */
export type LeakSeverity = "high" | "medium" | "low";

export interface LeakFinding {
  type: LeakType;
  /** Start offset in the checked text, inclusive, in UTF-16 code units like `String.slice`. */
  start: number;
  /** End offset, exclusive. `text.slice(start, end)` is the flagged span. */
  end: number;
  /** The flagged span, copied out so a caller does not need the original text. */
  text: string;
  severity: LeakSeverity;
  /** Set only on `quasi-identifier` findings. */
  rule?: QuasiRule;
  /**
   * Plain English for the reporter. The app shows a translated string keyed on
   * `type`; this one is for logs-free contexts such as the evaluation output.
   */
  reason: string;
}
