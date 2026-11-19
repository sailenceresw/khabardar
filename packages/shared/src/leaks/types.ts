/** What kind of identifying detail a finding is. One detector per type. */
export type LeakType =
  | "email"
  | "phone"
  | "national-id"
  | "vehicle-plate"
  | "personal-url"
  | "street-address"
  | "personal-name";

/**
 * How directly the detail points at a person.
 *
 * - `high`: identifies someone on its own (an email, a phone number, an ID).
 * - `medium`: narrows things a lot, or identifies someone only some of the time
 *   (a name that may be the accused's rather than the reporter's, a plate).
 */
export type LeakSeverity = "high" | "medium";

export interface LeakFinding {
  type: LeakType;
  /** Start offset in the checked text, inclusive, in UTF-16 code units like `String.slice`. */
  start: number;
  /** End offset, exclusive. `text.slice(start, end)` is the flagged span. */
  end: number;
  /** The flagged span, copied out so a caller does not need the original text. */
  text: string;
  severity: LeakSeverity;
  /**
   * Plain English for the reporter. The app shows a translated string keyed on
   * `type`; this one is for logs-free contexts such as the evaluation output.
   */
  reason: string;
}
