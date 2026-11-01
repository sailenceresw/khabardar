import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChainReportRow } from "./types";
import { safeJsonParse } from "../safeJson";

const MIRROR_KEY = "khabardar.chainmirror.v1";
const CORROBORATED_KEY = "khabardar.chainmirror.corroborated.v1";

/**
 * Local stand-in for the chain's report list, used while the mock relayer is
 * active. Publishing with a real relayer + indexer makes this redundant — it
 * exists so the feed behaves identically end-to-end without credentials.
 *
 * Cleared by panic delete along with everything else.
 */
export async function appendMirrorRow(row: ChainReportRow): Promise<void> {
  const rows = await readMirror();
  await AsyncStorage.setItem(MIRROR_KEY, JSON.stringify([row, ...rows]));
}

export async function readMirror(): Promise<ChainReportRow[]> {
  const raw = await AsyncStorage.getItem(MIRROR_KEY);
  return safeJsonParse<ChainReportRow[]>(raw) ?? [];
}

/**
 * Id the next locally-simulated submission should claim.
 *
 * Derived from the persisted mirror rather than an in-memory counter: a counter
 * resets on every app reload, so the first report of a second session would
 * reuse an id that already exists. Two rows sharing an `onChainReportId` is not
 * cosmetic — the feed opens whichever one it finds first, and `updateMirrorRow`
 * applies a corroboration or a moderation verdict to both.
 *
 * The real chain has no such problem: `reportCount` is monotonic storage.
 */
export async function nextMirrorReportId(): Promise<number> {
  const rows = await readMirror();
  return rows.reduce((next, r) => Math.max(next, r.onChainReportId + 1), 0);
}

export async function updateMirrorRow(
  onChainReportId: number,
  patch: Partial<ChainReportRow>
): Promise<void> {
  const rows = await readMirror();
  const next = rows.map((r) => (r.onChainReportId === onChainReportId ? { ...r, ...patch } : r));
  await AsyncStorage.setItem(MIRROR_KEY, JSON.stringify(next));
}

/**
 * Which reports this device has already corroborated.
 *
 * The contract enforces one corroboration per account
 * (`hasCorroborated[reportId][msg.sender]`) and the mock path has to match it,
 * or the button can be tapped repeatedly to push any report past the
 * auto-promotion threshold — inflating the one trust signal the protocol has.
 */
export async function hasCorroboratedLocally(onChainReportId: number): Promise<boolean> {
  return (await readCorroborated()).includes(onChainReportId);
}

export async function markCorroboratedLocally(onChainReportId: number): Promise<void> {
  const ids = await readCorroborated();
  if (ids.includes(onChainReportId)) return;
  await AsyncStorage.setItem(CORROBORATED_KEY, JSON.stringify([onChainReportId, ...ids]));
}

async function readCorroborated(): Promise<number[]> {
  const raw = await AsyncStorage.getItem(CORROBORATED_KEY);
  return safeJsonParse<number[]>(raw) ?? [];
}

export async function clearMirror(): Promise<void> {
  await AsyncStorage.multiRemove([MIRROR_KEY, CORROBORATED_KEY]);
}
