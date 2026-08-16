import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeJsonParse } from "../safeJson";

const PREFIX = "khabardar.pendingOp.";

export interface PendingUserOp {
  userOpHash: `0x${string}`;
  reportId: string;
  submittedAt: number;
  registryAddress: `0x${string}`;
}

export async function savePendingOp(op: PendingUserOp): Promise<void> {
  await AsyncStorage.setItem(PREFIX + op.reportId, JSON.stringify(op));
}

export async function loadPendingOp(reportId: string): Promise<PendingUserOp | null> {
  const raw = await AsyncStorage.getItem(PREFIX + reportId);
  return safeJsonParse<PendingUserOp>(raw);
}

export async function clearPendingOp(reportId: string): Promise<void> {
  await AsyncStorage.removeItem(PREFIX + reportId);
}

export async function listPendingOps(): Promise<PendingUserOp[]> {
  const keys = await AsyncStorage.getAllKeys();
  const opKeys = keys.filter((k) => k.startsWith(PREFIX));
  if (opKeys.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(opKeys);
  const out: PendingUserOp[] = [];
  for (const [, raw] of pairs) {
    const parsed = safeJsonParse<PendingUserOp>(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}
