import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AnonymousReport } from "@khabardar/shared";
import {
  decrypt,
  encrypt,
  randomKey,
  utf8ToBytes,
  bytesToUtf8,
  type EncryptedBlob,
} from "./cryptoUtils";

// Report bodies are encrypted at rest with a device-local key held in the
// secure keystore; AsyncStorage only ever sees ciphertext.
const DRAFTS_INDEX = "khabardar.drafts.index.v1";
const DRAFT_PREFIX = "khabardar.draft.";
const DRAFT_KEY_NAME = "khabardar.draftkey.v1";
const EVIDENCE_KEY_NAME = "khabardar.evidencekey.v1";

async function getOrCreateKey(name: string): Promise<Uint8Array> {
  const isWeb = Platform.OS === "web";
  const existing = isWeb ? await AsyncStorage.getItem(name) : await SecureStore.getItemAsync(name);
  if (existing) return Uint8Array.from(existing.split(",").map(Number));

  const key = randomKey();
  const serialized = Array.from(key).join(",");
  if (isWeb) await AsyncStorage.setItem(name, serialized);
  else await SecureStore.setItemAsync(name, serialized);
  return key;
}

export const getDraftKey = () => getOrCreateKey(DRAFT_KEY_NAME);
export const getEvidenceKey = () => getOrCreateKey(EVIDENCE_KEY_NAME);

interface StoredReport extends Omit<AnonymousReport, "body"> {
  encryptedBody: EncryptedBlob;
}

export async function saveReport(report: AnonymousReport): Promise<void> {
  const key = await getDraftKey();
  const { body, ...rest } = report;
  const stored: StoredReport = { ...rest, encryptedBody: encrypt(utf8ToBytes(body), key) };

  await AsyncStorage.setItem(DRAFT_PREFIX + report.id, JSON.stringify(stored));

  const index = await getReportIds();
  if (!index.includes(report.id)) {
    await AsyncStorage.setItem(DRAFTS_INDEX, JSON.stringify([report.id, ...index]));
  }
}

export async function loadReport(id: string): Promise<AnonymousReport | null> {
  const raw = await AsyncStorage.getItem(DRAFT_PREFIX + id);
  if (!raw) return null;
  const stored = JSON.parse(raw) as StoredReport;
  const key = await getDraftKey();
  const { encryptedBody, ...rest } = stored;
  return { ...rest, body: bytesToUtf8(decrypt(encryptedBody, key)) };
}

export async function loadAllReports(): Promise<AnonymousReport[]> {
  const ids = await getReportIds();
  const reports = await Promise.all(ids.map(loadReport));
  return reports.filter((r): r is AnonymousReport => r !== null);
}

export async function deleteReport(id: string): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_PREFIX + id);
  const index = await getReportIds();
  await AsyncStorage.setItem(DRAFTS_INDEX, JSON.stringify(index.filter((x) => x !== id)));
}

async function getReportIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DRAFTS_INDEX);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function deleteAllReports(): Promise<void> {
  const ids = await getReportIds();
  await AsyncStorage.multiRemove(ids.map((id) => DRAFT_PREFIX + id));
  await AsyncStorage.removeItem(DRAFTS_INDEX);
}
