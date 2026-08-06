import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToHex } from "@noble/ciphers/utils";
import * as Crypto from "expo-crypto";
import { keccak256, encodeAbiParameters, type Hex } from "viem";
import {
  APPEAL_QUORUM,
  JURY_QUORUM,
  JuryPhase,
  VerificationTier,
} from "@khabardar/shared";
import { updateMirrorRow } from "./feed/localChainMirror";
import { codenameFromAddress } from "./identity";
import { safeJsonParse } from "./safeJson";

/**
 * Moderation by an equal-weight, secret-ballot jury.
 *
 * This mirrors `ReportRegistry`'s commit–reveal so the mock path behaves like
 * the contract. Four properties carry over exactly, because they are the design
 * and not implementation detail:
 *
 *  1. **Every juror counts one.** No weighting, by anything.
 *  2. **Ballots are sealed until the panel is full.** Nobody can see which way
 *     the panel is leaning while there is still time to join it.
 *  3. **Dissent is free.** No juror gains or loses standing for the tier they
 *     chose. The only demerit is committing and never revealing — a failure to
 *     do the job, not a wrong opinion about the evidence.
 *  4. **A plurality is not a verdict.** Three jurors with three different
 *     answers produces "undecided", which is honest, rather than promoting
 *     whichever tier edged ahead.
 *
 * ## Why this replaced karma weighting
 *
 * The previous version weighted votes by karma and paid jurors for agreeing
 * with the eventual verdict while charging them more for dissenting. That made
 * voting with the expected winner the rational play regardless of the evidence,
 * and the reward compounded — agreeing bought karma, karma bought weight,
 * weight bought influence over the next verdict.
 *
 * For this application that is backwards. The reports most likely to attract a
 * confidently wrong majority are the ones accusing powerful people, which are
 * exactly the reports that need a juror willing to be the only "no" in the
 * room. Worse, reporter karma and juror weight shared one counter, so filing
 * reports bought judicial power over the review of one's own accusations.
 *
 * And the constraint that outranks all of it: a jury can move a report's TIER
 * and can never edit or delete the report. The content hash is anchored, so
 * moderation adds judgement on top of an immutable record.
 */

const BALLOTS_KEY = "khabardar.jury.ballots.v2";
const ROUNDS_KEY = "khabardar.jury.rounds.v2";
const RECORD_KEY = "khabardar.jury.record.v2";
const SALTS_KEY = "khabardar.jury.salts.v2";
const JUROR_MODE_KEY = "khabardar.jury.isJuror.v1";

export { JuryPhase, JURY_QUORUM, APPEAL_QUORUM };

export interface Ballot {
  reportId: number;
  round: number;
  juror: string;
  commitment: Hex;
  committedAt: number;
  /** Present only after reveal — this is what "sealed" means. */
  tier?: VerificationTier;
  reason?: string;
  revealedAt?: number;
  /** True for the clearly-labelled demo peers, never for a real juror. */
  simulated?: boolean;
}

export interface JuryRound {
  reportId: number;
  index: number;
  phase: JuryPhase;
  quorum: number;
  appealed: boolean;
  /** Winning tier once decided. */
  verdict?: VerificationTier;
  decidedAt?: number;
}

export interface JurorRecord {
  completed: number;
  abandoned: number;
}

/**
 * Simulated peers so the mechanism is demonstrable on one device.
 *
 * They exist for the same reason the sample feed rows do: a single-device demo
 * can never fill a three-seat panel, so the most important property — that one
 * person cannot decide alone — would be invisible. They only vote when the
 * operator explicitly asks, they are badged as simulated everywhere they
 * appear, and they must be deleted before any real deployment.
 */
export const SIMULATED_JURORS = [
  "0xA11CE00000000000000000000000000000000001",
  "0xB0B0000000000000000000000000000000000002",
  "0xC4501E00000000000000000000000000000003",
  "0xD00D000000000000000000000000000000000004",
  "0xE55E000000000000000000000000000000000005",
] as const;

export function isSimulatedJuror(address: string): boolean {
  return SIMULATED_JURORS.some((j) => j.toLowerCase() === address.toLowerCase());
}

// ---------------------------------------------------------------------------
// Juror mode (local dev affordance)
// ---------------------------------------------------------------------------

/**
 * v0 lets the local user flip into juror mode so the queue is explorable
 * without a deployed contract and a seated jury key. DEV AFFORDANCE ONLY — on a
 * real deployment the contract's `onlyJuror` modifier is the gate and this
 * toggle grants nothing on-chain.
 */
export async function isJurorMode(): Promise<boolean> {
  return (await AsyncStorage.getItem(JUROR_MODE_KEY)) === "true";
}

export async function setJurorMode(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(JUROR_MODE_KEY, enabled ? "true" : "false");
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

/**
 * Build the sealed commitment. Matches `ReportRegistry.commitmentFor` exactly,
 * including binding the juror's address so a commitment cannot be replayed onto
 * another report, reused after an appeal, or copied from another juror.
 */
export function commitmentFor(input: {
  reportId: number;
  round: number;
  tier: VerificationTier;
  salt: Hex;
  juror: string;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "address" },
      ],
      [
        BigInt(input.reportId),
        input.round,
        input.tier,
        input.salt,
        input.juror as Hex,
      ]
    )
  );
}

export function randomSalt(): Hex {
  return `0x${bytesToHex(Crypto.getRandomBytes(32))}`;
}

/** What a juror needs to reopen their own sealed ballot: the tier and the salt. */
export interface BallotSecret {
  tier: VerificationTier;
  salt: Hex;
}

/**
 * Both halves of the ballot have to survive between committing and revealing,
 * so they are kept on the device.
 *
 * The tier is stored too, not just the salt. Secrecy here is about other people
 * not seeing the vote before the panel closes — the chain holds only the
 * commitment — and it was never about hiding a juror's choice from themselves.
 * Keeping only the salt meant a juror who committed and then closed the app
 * could not reveal at all, which forced them into abandonment: the single thing
 * this design penalises, incurred for doing nothing wrong.
 *
 * Losing this store still means the ballot can never be opened, exactly as it
 * would on-chain, so a real client must treat it as important rather than as a
 * cache.
 */
async function saveBallotSecret(
  reportId: number,
  round: number,
  secret: BallotSecret
): Promise<void> {
  const store =
    safeJsonParse<Record<string, BallotSecret>>(await AsyncStorage.getItem(SALTS_KEY)) ?? {};
  store[`${reportId}:${round}`] = secret;
  await AsyncStorage.setItem(SALTS_KEY, JSON.stringify(store));
}

export async function loadBallotSecret(
  reportId: number,
  round: number
): Promise<BallotSecret | null> {
  const store =
    safeJsonParse<Record<string, BallotSecret>>(await AsyncStorage.getItem(SALTS_KEY)) ?? {};
  return store[`${reportId}:${round}`] ?? null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function readBallots(): Promise<Ballot[]> {
  return safeJsonParse<Ballot[]>(await AsyncStorage.getItem(BALLOTS_KEY)) ?? [];
}

async function writeBallots(ballots: Ballot[]): Promise<void> {
  await AsyncStorage.setItem(BALLOTS_KEY, JSON.stringify(ballots));
}

async function readRounds(): Promise<Record<number, JuryRound>> {
  return safeJsonParse<Record<number, JuryRound>>(await AsyncStorage.getItem(ROUNDS_KEY)) ?? {};
}

async function writeRounds(rounds: Record<number, JuryRound>): Promise<void> {
  await AsyncStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds));
}

export async function roundFor(reportId: number): Promise<JuryRound> {
  const rounds = await readRounds();
  return (
    rounds[reportId] ?? {
      reportId,
      index: 0,
      phase: JuryPhase.None,
      quorum: JURY_QUORUM,
      appealed: false,
    }
  );
}

export async function ballotsFor(reportId: number, round?: number): Promise<Ballot[]> {
  const target = round ?? (await roundFor(reportId)).index;
  return (await readBallots()).filter((b) => b.reportId === reportId && b.round === target);
}

export async function jurorRecord(address: string): Promise<JurorRecord> {
  const records =
    safeJsonParse<Record<string, JurorRecord>>(await AsyncStorage.getItem(RECORD_KEY)) ?? {};
  return records[address.toLowerCase()] ?? { completed: 0, abandoned: 0 };
}

async function bumpRecord(address: string, field: keyof JurorRecord): Promise<void> {
  const records =
    safeJsonParse<Record<string, JurorRecord>>(await AsyncStorage.getItem(RECORD_KEY)) ?? {};
  const key = address.toLowerCase();
  const current = records[key] ?? { completed: 0, abandoned: 0 };
  records[key] = { ...current, [field]: current[field] + 1 };
  await AsyncStorage.setItem(RECORD_KEY, JSON.stringify(records));
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export class JuryActionRejected extends Error {
  constructor(
    readonly code:
      | "already-committed"
      | "not-committing"
      | "not-revealing"
      | "already-revealed"
      | "nothing-committed"
      | "self-review"
      | "no-reason"
      | "no-salt"
  ) {
    super(code);
    this.name = "JuryActionRejected";
  }
}

/** Seal a ballot. The tier is not stored — only the commitment. */
export async function commitVote(input: {
  reportId: number;
  juror: string;
  reporter: string;
  tier: VerificationTier;
  simulated?: boolean;
}): Promise<JuryRound> {
  const { reportId, juror, reporter, tier, simulated } = input;
  if (juror.toLowerCase() === reporter.toLowerCase()) {
    throw new JuryActionRejected("self-review");
  }

  const rounds = await readRounds();
  let round = await roundFor(reportId);

  // A finished round has to be cleared before another opens, so a retry or an
  // appeal starts from a clean panel rather than inheriting half the last one.
  if (round.phase === JuryPhase.None || round.phase === JuryPhase.Undecided) {
    round = {
      ...round,
      index: round.index + 1,
      phase: JuryPhase.Committing,
      quorum: round.appealed ? APPEAL_QUORUM : round.quorum,
      verdict: undefined,
      decidedAt: undefined,
    };
  }
  if (round.phase !== JuryPhase.Committing) throw new JuryActionRejected("not-committing");

  const existing = await ballotsFor(reportId, round.index);
  if (existing.some((b) => b.juror.toLowerCase() === juror.toLowerCase())) {
    throw new JuryActionRejected("already-committed");
  }

  const salt = randomSalt();
  await saveBallotSecret(reportId, round.index, { tier, salt });

  const ballot: Ballot = {
    reportId,
    round: round.index,
    juror,
    commitment: commitmentFor({ reportId, round: round.index, tier, salt, juror }),
    committedAt: Date.now(),
    ...(simulated ? { simulated: true } : {}),
  };

  // Simulated peers cannot keep their own salts, so their tier rides along
  // out-of-band. A real juror's tier exists nowhere until they reveal.
  if (simulated) pendingSimulated.set(`${reportId}:${round.index}:${juror}`, { tier, salt });

  await writeBallots([ballot, ...(await readBallots())]);

  if (existing.length + 1 >= round.quorum) round = { ...round, phase: JuryPhase.Revealing };

  rounds[reportId] = round;
  await writeRounds(rounds);
  return round;
}

/** In-memory only: the demo peers' sealed choices, never persisted. */
const pendingSimulated = new Map<string, { tier: VerificationTier; salt: Hex }>();

/** Open a sealed ballot and publish the tier with its reason. */
export async function revealVote(input: {
  reportId: number;
  juror: string;
  reason: string;
  /** Omitted for the device's own ballot — both are recovered from storage. */
  tier?: VerificationTier;
  salt?: Hex;
}): Promise<JuryRound> {
  const { reportId, juror } = input;
  const reason = input.reason.trim();
  if (!reason) throw new JuryActionRejected("no-reason");

  const rounds = await readRounds();
  let round = await roundFor(reportId);
  if (round.phase !== JuryPhase.Revealing) throw new JuryActionRejected("not-revealing");

  const ballots = await readBallots();
  const index = ballots.findIndex(
    (b) =>
      b.reportId === reportId &&
      b.round === round.index &&
      b.juror.toLowerCase() === juror.toLowerCase()
  );
  if (index === -1) throw new JuryActionRejected("nothing-committed");
  if (ballots[index].tier !== undefined) throw new JuryActionRejected("already-revealed");

  // Recover both halves from the device unless the caller supplied them (the
  // simulated peers do, since they have no storage of their own).
  const stored = await loadBallotSecret(reportId, round.index);
  const tier = input.tier ?? stored?.tier;
  const salt = input.salt ?? stored?.salt;
  if (tier === undefined || !salt) throw new JuryActionRejected("no-salt");

  // The contract checks this; so does the mock, or the demo would let a juror
  // reveal something they never committed to.
  const expected = commitmentFor({ reportId, round: round.index, tier, salt, juror });
  if (expected !== ballots[index].commitment) throw new JuryActionRejected("nothing-committed");

  ballots[index] = { ...ballots[index], tier, reason, revealedAt: Date.now() };
  await writeBallots(ballots);
  await bumpRecord(juror, "completed");

  const inRound = ballots.filter((b) => b.reportId === reportId && b.round === round.index);
  const revealed = inRound.filter((b) => b.tier !== undefined);

  if (revealed.length === inRound.length) {
    round = await closeRound(reportId, round, inRound);
  }

  rounds[reportId] = round;
  await writeRounds(rounds);
  return round;
}

/** Tally revealed ballots. A plurality is not enough — a majority is required. */
async function closeRound(
  reportId: number,
  round: JuryRound,
  ballots: Ballot[]
): Promise<JuryRound> {
  const revealed = ballots.filter((b) => b.tier !== undefined);

  for (const b of ballots) {
    if (b.tier === undefined) await bumpRecord(b.juror, "abandoned");
  }

  const counts = new Map<VerificationTier, number>();
  for (const b of revealed) {
    counts.set(b.tier!, (counts.get(b.tier!) ?? 0) + 1);
  }

  let winner: VerificationTier | undefined;
  let top = 0;
  let runnerUp = 0;
  for (const [tier, n] of counts) {
    if (n > top) {
      runnerUp = top;
      top = n;
      winner = tier;
    } else if (n > runnerUp) {
      runnerUp = n;
    }
  }

  const majority = winner !== undefined && top > runnerUp && top * 2 > revealed.length;
  if (!majority) return { ...round, phase: JuryPhase.Undecided };

  await updateMirrorRow(reportId, { tier: winner! });
  return { ...round, phase: JuryPhase.Decided, verdict: winner, decidedAt: Date.now() };
}

/**
 * Contest a verdict. Reporter only, once, re-heard by a larger panel.
 *
 * A first-instance verdict with no way to challenge it is not a fair process
 * however carefully the panel was assembled — three people can be wrong, and
 * the reporter carries the cost.
 */
export async function appealVerdict(reportId: number): Promise<JuryRound> {
  const rounds = await readRounds();
  const round = await roundFor(reportId);
  if (round.phase !== JuryPhase.Decided || round.appealed) return round;

  // Under appeal is not the same as unjudged, and leaving the contested verdict
  // standing would be the unfair part.
  await updateMirrorRow(reportId, { tier: VerificationTier.UnderReview });

  const next: JuryRound = {
    ...round,
    phase: JuryPhase.Undecided,
    appealed: true,
    quorum: APPEAL_QUORUM,
    verdict: undefined,
    decidedAt: undefined,
  };
  rounds[reportId] = next;
  await writeRounds(rounds);
  return next;
}

export async function canAppeal(reportId: number): Promise<boolean> {
  const round = await roundFor(reportId);
  return round.phase === JuryPhase.Decided && !round.appealed;
}

/**
 * Have the simulated peers commit, then reveal, so a one-device demo can reach
 * quorum. Explicitly operator-triggered and badged — this fabricates agreement
 * and must never run on a real deployment.
 */
export async function simulatePeerReview(input: {
  reportId: number;
  reporter: string;
  tier: VerificationTier;
  reason?: string;
}): Promise<JuryRound> {
  let round = await roundFor(input.reportId);

  for (const juror of SIMULATED_JURORS) {
    round = await roundFor(input.reportId);
    if (round.phase !== JuryPhase.Committing && round.phase !== JuryPhase.None) break;
    if (juror.toLowerCase() === input.reporter.toLowerCase()) continue;

    try {
      round = await commitVote({
        reportId: input.reportId,
        juror,
        reporter: input.reporter,
        tier: input.tier,
        simulated: true,
      });
    } catch {
      break;
    }
  }

  // Then open every sealed peer ballot.
  round = await roundFor(input.reportId);
  for (const juror of SIMULATED_JURORS) {
    const held = pendingSimulated.get(`${input.reportId}:${round.index}:${juror}`);
    if (!held) continue;
    try {
      round = await revealVote({
        reportId: input.reportId,
        juror,
        tier: held.tier,
        salt: held.salt,
        reason: input.reason ?? "Simulated peer juror (demo).",
      });
    } catch {
      // Panel already closed, or this peer never committed.
    }
  }

  return round;
}

/** Human-readable label for a juror, without revealing an address in UI. */
export function jurorLabel(address: string): string {
  return codenameFromAddress(address);
}

/**
 * The full public decision log, newest first.
 *
 * On a real deployment this is not read from the device at all — it comes from
 * `JuryVoteRevealed` events, so the public can audit moderators using nothing
 * but an RPC endpoint. Only revealed ballots appear; a sealed one has nothing
 * to show, which is the point.
 */
export async function publicDecisionLog(): Promise<Ballot[]> {
  return (await readBallots()).filter((b) => b.tier !== undefined);
}

export async function allBallots(): Promise<Ballot[]> {
  return readBallots();
}

export async function clearModerationLog(): Promise<void> {
  pendingSimulated.clear();
  await AsyncStorage.multiRemove([
    BALLOTS_KEY,
    ROUNDS_KEY,
    RECORD_KEY,
    SALTS_KEY,
    JUROR_MODE_KEY,
  ]);
}
