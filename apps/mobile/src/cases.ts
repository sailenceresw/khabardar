import AsyncStorage from "@react-native-async-storage/async-storage";
import { getEntitlements } from "./org";
import { safeJsonParse } from "./safeJson";

/**
 * Case management — the workflow layer a newsroom or oversight body actually
 * buys, sitting on top of a corpus that stays free and public.
 *
 * A case groups reports an investigator believes are related, tracks what was
 * done about them, and records the outcome. That last part is the point: the
 * value of this platform is not reports filed, it is investigations that
 * concluded. Without outcome tracking there is no way to tell a funder whether
 * any of this worked, and no way to tell a reporter that filing was worth the
 * risk they took.
 *
 * ## Two rules that constrain the data model
 *
 *  1. **Cases reference report ids, never report content.** A case is an
 *     investigator's workspace; the underlying report stays where it is,
 *     encrypted and anchored. Copying report bodies into case notes would
 *     create a second, unprotected corpus with none of the guarantees.
 *  2. **No reporter identifiers, ever.** Not the address, not the codename.
 *     An investigator's private notes are exactly where "I think this is the
 *     same person as case #12" gets written down, and a case file that can
 *     answer that question is a deanonymization database. Notes are free text
 *     and this cannot be enforced in code — so it is enforced in the model by
 *     giving that field nowhere to live, and stated in the UI.
 */

const CASES_KEY = "khabardar.cases.v1";

export enum CaseStatus {
  Open = "open",
  Investigating = "investigating",
  /** Handed to an oversight body, regulator, or court. */
  Referred = "referred",
  Published = "published",
  /** Closed without action; the reason is required. */
  Closed = "closed",
}

export const CASE_STATUS_KEYS: Record<CaseStatus, string> = {
  [CaseStatus.Open]: "cases.status.open",
  [CaseStatus.Investigating]: "cases.status.investigating",
  [CaseStatus.Referred]: "cases.status.referred",
  [CaseStatus.Published]: "cases.status.published",
  [CaseStatus.Closed]: "cases.status.closed",
};

/** What actually happened. The metric that justifies the whole project. */
export enum CaseOutcome {
  None = "none",
  StoryPublished = "story-published",
  OfficialInquiry = "official-inquiry",
  FundsRecovered = "funds-recovered",
  Sanction = "sanction",
  NoActionTaken = "no-action-taken",
  Unsubstantiated = "unsubstantiated",
}

export const CASE_OUTCOME_KEYS: Record<CaseOutcome, string> = {
  [CaseOutcome.None]: "cases.outcome.none",
  [CaseOutcome.StoryPublished]: "cases.outcome.storyPublished",
  [CaseOutcome.OfficialInquiry]: "cases.outcome.officialInquiry",
  [CaseOutcome.FundsRecovered]: "cases.outcome.fundsRecovered",
  [CaseOutcome.Sanction]: "cases.outcome.sanction",
  [CaseOutcome.NoActionTaken]: "cases.outcome.noActionTaken",
  [CaseOutcome.Unsubstantiated]: "cases.outcome.unsubstantiated",
};

export interface CaseNote {
  id: string;
  body: string;
  at: number;
}

export interface InvestigationCase {
  id: string;
  title: string;
  status: CaseStatus;
  outcome: CaseOutcome;
  /** On-chain report ids in this case. Ids only — never content. */
  reportIds: number[];
  /** Blinded entity tag when the case is about one office. Never a name. */
  entityTag?: string;
  notes: CaseNote[];
  createdAt: number;
  updatedAt: number;
  /** Required when status is Closed. */
  closedReason?: string;
}

export class CasesNotEntitledError extends Error {
  constructor() {
    super("Case management requires an accredited Pro or Institutional organization plan");
    this.name = "CasesNotEntitledError";
  }
}

async function requireEntitlement(): Promise<void> {
  const entitlements = await getEntitlements();
  if (!entitlements.caseManagement) throw new CasesNotEntitledError();
}

export async function listCases(): Promise<InvestigationCase[]> {
  await requireEntitlement();
  return readCases();
}

async function readCases(): Promise<InvestigationCase[]> {
  return safeJsonParse<InvestigationCase[]>(await AsyncStorage.getItem(CASES_KEY)) ?? [];
}

async function writeCases(cases: InvestigationCase[]): Promise<void> {
  await AsyncStorage.setItem(CASES_KEY, JSON.stringify(cases));
}

export async function createCase(input: {
  title: string;
  reportIds?: number[];
  entityTag?: string;
}): Promise<InvestigationCase> {
  await requireEntitlement();

  const now = Date.now();
  const created: InvestigationCase = {
    id: `case_${now}_${Math.floor(Math.random() * 1e6)}`,
    title: input.title.trim(),
    status: CaseStatus.Open,
    outcome: CaseOutcome.None,
    reportIds: input.reportIds ?? [],
    entityTag: input.entityTag,
    notes: [],
    createdAt: now,
    updatedAt: now,
  };

  await writeCases([created, ...(await readCases())]);
  return created;
}

export async function updateCase(
  id: string,
  patch: Partial<Omit<InvestigationCase, "id" | "createdAt">>
): Promise<InvestigationCase | null> {
  await requireEntitlement();

  const cases = await readCases();
  const index = cases.findIndex((c) => c.id === id);
  if (index === -1) return null;

  const next = { ...cases[index], ...patch, updatedAt: Date.now() };
  if (next.status === CaseStatus.Closed && !next.closedReason?.trim()) {
    throw new Error("Closing a case requires a reason");
  }

  cases[index] = next;
  await writeCases(cases);
  return next;
}

export async function attachReport(caseId: string, reportId: number): Promise<InvestigationCase | null> {
  const cases = await readCases();
  const found = cases.find((c) => c.id === caseId);
  if (!found) return null;
  if (found.reportIds.includes(reportId)) return found;
  return updateCase(caseId, { reportIds: [...found.reportIds, reportId] });
}

export async function addNote(caseId: string, body: string): Promise<InvestigationCase | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const cases = await readCases();
  const found = cases.find((c) => c.id === caseId);
  if (!found) return null;

  const note: CaseNote = {
    id: `note_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    body: trimmed,
    at: Date.now(),
  };
  return updateCase(caseId, { notes: [note, ...found.notes] });
}

export async function deleteCase(id: string): Promise<void> {
  await requireEntitlement();
  await writeCases((await readCases()).filter((c) => c.id !== id));
}

export async function clearCases(): Promise<void> {
  await AsyncStorage.removeItem(CASES_KEY);
}

export interface OutcomeSummary {
  total: number;
  byOutcome: Array<{ outcome: CaseOutcome; count: number }>;
  /** Cases that reached a concrete result, over cases that concluded. */
  actionRate: number;
}

/**
 * The number to put in a grant report: of the cases that concluded, how many
 * produced a real-world result. Counting only concluded cases is deliberate —
 * including open ones would let a backlog of untouched cases quietly deflate
 * the figure, or a fresh batch inflate it.
 */
export async function outcomeSummary(): Promise<OutcomeSummary> {
  const cases = await readCases();
  const counts = new Map<CaseOutcome, number>();
  for (const c of cases) counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1);

  const concluded = cases.filter((c) => c.outcome !== CaseOutcome.None);
  const actioned = concluded.filter(
    (c) =>
      c.outcome === CaseOutcome.StoryPublished ||
      c.outcome === CaseOutcome.OfficialInquiry ||
      c.outcome === CaseOutcome.FundsRecovered ||
      c.outcome === CaseOutcome.Sanction
  );

  return {
    total: cases.length,
    byOutcome: [...counts.entries()].map(([outcome, count]) => ({ outcome, count })),
    actionRate: concluded.length ? actioned.length / concluded.length : 0,
  };
}
