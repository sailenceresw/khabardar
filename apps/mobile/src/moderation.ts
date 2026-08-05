import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  JURY_QUORUM_WEIGHT,
  KARMA_PER_JURY_WEIGHT,
  MAX_JUROR_WEIGHT,
  VerificationTier,
} from "@khabardar/shared";
import { updateMirrorRow } from "./feed/localChainMirror";
import { codenameFromAddress } from "./identity";
import { safeJsonParse } from "./safeJson";

/**
 * Moderation by karma-weighted jury.
 *
 * This module mirrors `ReportRegistry.castJuryVote` so the mock path behaves
 * like the contract. Three properties carry over exactly, because they are the
 * design and not an implementation detail:
 *
 *  1. **No one decides alone.** A verdict needs {@link JURY_QUORUM_WEIGHT} of
 *     agreeing weight, and no single juror can hold that much.
 *  2. **Being wrong costs standing.** When a verdict lands, dissenting jurors
 *     lose more karma than agreeing jurors gain, so careless review decays a
 *     juror's influence toward nothing.
 *  3. **Every vote is public, reason included, before the outcome is known.**
 *     On-chain that is the `JuryVoteCast` event; here it is a local log that
 *     the UI renders in full. A moderation system nobody can audit is
 *     censorship with extra steps.
 *
 * And the constraint that outranks all three: a jury can move a report's
 * TIER and can never edit or delete the report. The content hash is anchored
 * on-chain, so moderation adds judgement on top of an immutable record.
 */

const VOTES_KEY = "khabardar.jury.votes.v1";
const KARMA_KEY = "khabardar.jury.karma.v1";
const JUROR_MODE_KEY = "khabardar.jury.isJuror.v1";

export interface JuryVote {
  reportId: number;
  /** Pseudonymous juror address. */
  juror: string;
  tier: VerificationTier;
  /** Weight this vote carried, snapshotted at cast time. */
  weight: number;
  reason: string;
  castAt: number;
  /** True for the clearly-labelled demo peers, never for a real juror. */
  simulated?: boolean;
}

export interface JuryTally {
  reportId: number;
  /** Accumulated weight behind each tier. */
  weightByTier: Record<number, number>;
  /** The tier that reached quorum, or null while the report is still open. */
  verdict: VerificationTier | null;
  votes: JuryVote[];
}

/**
 * Simulated peers so the quorum mechanic is demonstrable on one device.
 *
 * They exist for the same reason the sample feed rows do: without them a
 * single-device demo can never reach a three-weight quorum, and the most
 * important property of the design — that one person cannot decide alone —
 * would be invisible. They only ever vote when the operator explicitly asks
 * them to, they are badged as simulated everywhere they appear, and like the
 * demo rows they must be deleted before any real deployment.
 */
export const SIMULATED_JURORS = [
  "0xA11CE00000000000000000000000000000000001",
  "0xB0B0000000000000000000000000000000000002",
  "0xC4501E00000000000000000000000000000003",
] as const;

export function isSimulatedJuror(address: string): boolean {
  return SIMULATED_JURORS.some((j) => j.toLowerCase() === address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Juror mode (local dev affordance)
// ---------------------------------------------------------------------------

/**
 * v0 lets the local user flip into juror mode so the queue is explorable
 * without a deployed contract and a seated jury key. This is a DEV AFFORDANCE
 * ONLY — on a real deployment the contract's `onlyJuror` modifier is the
 * actual gate, and this toggle grants nothing on-chain.
 */
export async function isJurorMode(): Promise<boolean> {
  return (await AsyncStorage.getItem(JUROR_MODE_KEY)) === "true";
}

export async function setJurorMode(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(JUROR_MODE_KEY, enabled ? "true" : "false");
}

// ---------------------------------------------------------------------------
// Karma and weight
// ---------------------------------------------------------------------------

async function readKarma(): Promise<Record<string, number>> {
  return safeJsonParse<Record<string, number>>(await AsyncStorage.getItem(KARMA_KEY)) ?? {};
}

async function writeKarma(karma: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(KARMA_KEY, JSON.stringify(karma));
}

export async function karmaOf(address: string): Promise<number> {
  return (await readKarma())[address.toLowerCase()] ?? 0;
}

/** Matches `ReportRegistry.jurorWeight`: 1, plus a capped karma bonus. */
export function weightFromKarma(karma: number): number {
  return Math.min(1 + Math.floor(karma / KARMA_PER_JURY_WEIGHT), MAX_JUROR_WEIGHT);
}

export async function jurorWeightOf(address: string): Promise<number> {
  return weightFromKarma(await karmaOf(address));
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export async function allVotes(): Promise<JuryVote[]> {
  return safeJsonParse<JuryVote[]>(await AsyncStorage.getItem(VOTES_KEY)) ?? [];
}

export async function votesFor(reportId: number): Promise<JuryVote[]> {
  return (await allVotes()).filter((v) => v.reportId === reportId);
}

export async function hasVoted(reportId: number, juror: string): Promise<boolean> {
  const lower = juror.toLowerCase();
  return (await votesFor(reportId)).some((v) => v.juror.toLowerCase() === lower);
}

function tallyOf(reportId: number, votes: JuryVote[]): JuryTally {
  const weightByTier: Record<number, number> = {};
  for (const v of votes) {
    weightByTier[v.tier] = (weightByTier[v.tier] ?? 0) + v.weight;
  }

  const reached = Object.entries(weightByTier).find(([, w]) => w >= JURY_QUORUM_WEIGHT);
  return {
    reportId,
    weightByTier,
    verdict: reached ? (Number(reached[0]) as VerificationTier) : null,
    votes,
  };
}

export async function tallyFor(reportId: number): Promise<JuryTally> {
  return tallyOf(reportId, await votesFor(reportId));
}

export class JuryVoteRejected extends Error {
  constructor(readonly code: "already-voted" | "verdict-final" | "self-review" | "no-reason") {
    super(code);
    this.name = "JuryVoteRejected";
  }
}

/**
 * Cast one juror's verdict. Mirrors the contract's checks in the same order, so
 * a vote the mock accepts is one the chain would accept too.
 *
 * @returns the tally after this vote, including the verdict if quorum landed.
 */
export async function castJuryVote(input: {
  reportId: number;
  juror: string;
  reporter: string;
  tier: VerificationTier;
  reason: string;
  simulated?: boolean;
}): Promise<JuryTally> {
  const { reportId, juror, reporter, tier, simulated } = input;
  const reason = input.reason.trim();

  const existing = await votesFor(reportId);
  if (tallyOf(reportId, existing).verdict !== null) throw new JuryVoteRejected("verdict-final");
  if (existing.some((v) => v.juror.toLowerCase() === juror.toLowerCase())) {
    throw new JuryVoteRejected("already-voted");
  }
  if (juror.toLowerCase() === reporter.toLowerCase()) throw new JuryVoteRejected("self-review");
  if (!reason) throw new JuryVoteRejected("no-reason");

  const vote: JuryVote = {
    reportId,
    juror,
    tier,
    weight: await jurorWeightOf(juror),
    reason,
    castAt: Date.now(),
    ...(simulated ? { simulated: true } : {}),
  };

  const votes = await allVotes();
  await AsyncStorage.setItem(VOTES_KEY, JSON.stringify([vote, ...votes]));

  const tally = tallyOf(reportId, [...existing, vote]);
  if (tally.verdict !== null) await settleVerdict(tally, reporter);
  return tally;
}

/**
 * Apply a reached verdict: move the report's tier, move the reporter's karma,
 * and settle every juror who voted. Karma changes mirror the contract's
 * constants — dissent costs more than agreement earns, on purpose.
 */
async function settleVerdict(tally: JuryTally, reporter: string): Promise<void> {
  const verdict = tally.verdict;
  if (verdict === null) return;

  await updateMirrorRow(tally.reportId, { tier: verdict });

  const karma = await readKarma();
  const bump = (address: string, delta: number) => {
    const key = address.toLowerCase();
    karma[key] = Math.max(0, (karma[key] ?? 0) + delta);
  };

  if (verdict === VerificationTier.Verified) bump(reporter, 10);
  else if (verdict === VerificationTier.Disputed) bump(reporter, -5);

  for (const vote of tally.votes) {
    bump(vote.juror, vote.tier === verdict ? 3 : -6);
  }

  await writeKarma(karma);
}

/**
 * Have the simulated peers weigh in, so a one-device demo can actually reach
 * quorum. Explicitly operator-triggered and badged everywhere — this fabricates
 * agreement and must never run on a real deployment.
 */
export async function simulatePeerReview(input: {
  reportId: number;
  reporter: string;
  tier: VerificationTier;
  reason?: string;
}): Promise<JuryTally> {
  let tally = await tallyFor(input.reportId);

  for (const juror of SIMULATED_JURORS) {
    if (tally.verdict !== null) break;
    if (juror.toLowerCase() === input.reporter.toLowerCase()) continue;
    if (await hasVoted(input.reportId, juror)) continue;

    tally = await castJuryVote({
      reportId: input.reportId,
      juror,
      reporter: input.reporter,
      tier: input.tier,
      reason: input.reason ?? "Simulated peer juror (demo).",
      simulated: true,
    });
  }

  return tally;
}

/** Human-readable label for a juror, without ever revealing an address in UI. */
export function jurorLabel(address: string): string {
  return codenameFromAddress(address);
}

/**
 * The full public decision log, newest first.
 *
 * On a real deployment this is not read from the device at all — it is read
 * from `JuryVoteCast` events, so the public can audit moderators using nothing
 * but an RPC endpoint. That is the whole reason the reason string is on-chain.
 */
export async function publicDecisionLog(): Promise<JuryVote[]> {
  return allVotes();
}

export async function clearModerationLog(): Promise<void> {
  await AsyncStorage.multiRemove([VOTES_KEY, KARMA_KEY, JUROR_MODE_KEY]);
}
