import { detectLeaks, type LeakFinding } from "@khabardar/shared";

/*
 * The logic behind the privacy check step, kept out of the screen so it can
 * be tested without React.
 *
 * Nothing here blocks submission. The reporter sees each finding and can fix
 * it, redact it, or keep it as written. The detectors are pure functions, so
 * the check makes no network requests.
 */

/**
 * A stable identity for a finding that survives edits elsewhere in the text.
 * Offsets move whenever the reporter changes an earlier sentence, so "keep
 * anyway" is remembered by what was flagged, not where.
 */
export function findingKey(f: Pick<LeakFinding, "type" | "rule" | "text">): string {
  return `${f.type}|${f.rule ?? ""}|${f.text.trim().toLowerCase()}`;
}

/** Findings the reporter still has to look at: everything detected, minus what they chose to keep. */
export function openFindings(body: string, kept: ReadonlySet<string>): LeakFinding[] {
  return detectLeaks(body).filter((f) => !kept.has(findingKey(f)));
}

/**
 * Replace a finding's span with new text. Returns the body unchanged when the
 * finding no longer matches what is at those offsets, so a stale finding can
 * never overwrite the wrong words.
 */
export function replaceFinding(body: string, f: LeakFinding, replacement: string): string {
  if (body.slice(f.start, f.end) !== f.text) return body;
  return body.slice(0, f.start) + replacement + body.slice(f.end);
}

/** Redact a finding with a placeholder the reader can see was removed. */
export function redactFinding(body: string, f: LeakFinding, placeholder: string): string {
  return replaceFinding(body, f, placeholder);
}

export interface Segment {
  text: string;
  /** Set when this segment is a flagged span, so the screen can highlight it. */
  finding?: LeakFinding;
}

/**
 * Split the body into plain and flagged segments, in order, for highlighting.
 * Expects non-overlapping findings, which `detectLeaks` guarantees; any
 * overlap is skipped rather than drawn twice.
 */
export function segmentBody(body: string, findings: readonly LeakFinding[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const f of [...findings].sort((a, b) => a.start - b.start)) {
    if (f.start < at || f.end > body.length) continue;
    if (f.start > at) out.push({ text: body.slice(at, f.start) });
    out.push({ text: body.slice(f.start, f.end), finding: f });
    at = f.end;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}

/** The i18n key for a finding's explanation: per rule for quasi-identifiers, per type otherwise. */
export function reasonKey(f: Pick<LeakFinding, "type" | "rule">): string {
  return f.type === "quasi-identifier" && f.rule ? `privacy.rule.${f.rule}` : `privacy.reason.${f.type}`;
}
