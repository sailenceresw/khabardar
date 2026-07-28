import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChainReportRow } from "./types";
import { safeJsonParse } from "../safeJson";

const MIRROR_KEY = "khabardar.chainmirror.v1";

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

export async function updateMirrorRow(
  onChainReportId: number,
  patch: Partial<ChainReportRow>
): Promise<void> {
  const rows = await readMirror();
  const next = rows.map((r) => (r.onChainReportId === onChainReportId ? { ...r, ...patch } : r));
  await AsyncStorage.setItem(MIRROR_KEY, JSON.stringify(next));
}

export async function clearMirror(): Promise<void> {
  await AsyncStorage.removeItem(MIRROR_KEY);
}
