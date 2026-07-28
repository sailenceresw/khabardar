import AsyncStorage from "@react-native-async-storage/async-storage";
import { VerificationTier } from "@khabardar/shared";
import { updateMirrorRow } from "./feed/localChainMirror";
import { safeJsonParse } from "./safeJson";

/**
 * Moderation actions.
 *
 * In mock mode these write to the local chain mirror. Against a live contract
 * each becomes a sponsored `setVerificationTier(reportId, tier)` call, which
 * the contract restricts to the moderator address.
 *
 * Two deliberate design constraints, both of which matter more than the code:
 *
 *  1. A moderator can change a report's TIER but can never edit or delete the
 *     report itself. The content hash is anchored on-chain; moderation adds
 *     judgement on top of an immutable record rather than rewriting it.
 *  2. Every decision is logged with a reason. v0 keeps that log locally, which
 *     is plainly insufficient — production must publish decisions (or their
 *     hashes) so moderators are auditable by the same public that is being
 *     asked to trust their verdicts. A moderation system nobody can audit is
 *     just censorship with extra steps.
 */

const LOG_KEY = "khabardar.moderation.log.v1";
const MODERATOR_KEY = "khabardar.moderation.isModerator.v1";

export interface ModerationDecision {
  reportId: number;
  fromTier: VerificationTier;
  toTier: VerificationTier;
  reason: string;
  decidedAt: number;
}

export async function isModerator(): Promise<boolean> {
  return (await AsyncStorage.getItem(MODERATOR_KEY)) === "true";
}

/**
 * v0 lets the local user flip into moderator mode so the queue is explorable
 * without deploying a contract and holding the moderator key. This is a
 * DEV AFFORDANCE ONLY — on a real deployment the contract's onlyModerator
 * check is the actual gate, and this toggle grants nothing on-chain.
 */
export async function setModeratorMode(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(MODERATOR_KEY, enabled ? "true" : "false");
}

export async function recordDecision(decision: ModerationDecision): Promise<void> {
  const log = await getDecisionLog();
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify([decision, ...log]));
}

export async function getDecisionLog(): Promise<ModerationDecision[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  return safeJsonParse<ModerationDecision[]>(raw) ?? [];
}

export async function decisionsForReport(reportId: number): Promise<ModerationDecision[]> {
  return (await getDecisionLog()).filter((d) => d.reportId === reportId);
}

/** Apply a tier change and log why. */
export async function applyModerationDecision(
  reportId: number,
  fromTier: VerificationTier,
  toTier: VerificationTier,
  reason: string
): Promise<void> {
  await updateMirrorRow(reportId, { tier: toTier });
  await recordDecision({ reportId, fromTier, toTier, reason, decidedAt: Date.now() });
}

export async function clearModerationLog(): Promise<void> {
  await AsyncStorage.multiRemove([LOG_KEY, MODERATOR_KEY]);
}
