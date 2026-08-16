import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EvidenceItem } from "@khabardar/shared";
import { encrypt, sha256Hex, type EncryptedBlob } from "./cryptoUtils";
import { getContentStore } from "./content";
import { getEvidenceKey } from "./drafts";
import { safeJsonParse } from "./safeJson";

const EVIDENCE_PREFIX = "khabardar.evidence.";

/**
 * Pick a photo, strip all metadata, encrypt it, and store only the encrypted
 * copy. Returns null if the user cancels.
 *
 * Metadata stripping: the image is re-encoded through expo-image-manipulator,
 * which decodes pixels and writes a fresh JPEG — EXIF (GPS, device model,
 * timestamps), IPTC and XMP from the original are not carried over. `exif:
 * false` in the picker additionally avoids handing EXIF to JS at all.
 */
export async function pickAndSecurePhoto(): Promise<EvidenceItem | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
    exif: false,
    base64: false,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];

  const reencoded = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: Math.min(asset.width ?? 1600, 1600) } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  if (!reencoded.base64) throw new Error("re-encode failed");

  const cleanBytes = base64ToBytes(reencoded.base64);
  const key = await getEvidenceKey();
  const blob = encrypt(cleanBytes, key);
  const sha = await sha256Hex(cleanBytes);

  const id = `ev_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  // v0: encrypted blob lives in AsyncStorage (works on all platforms incl.
  // web preview). Production: expo-file-system with streaming encryption.
  await AsyncStorage.setItem(EVIDENCE_PREFIX + id, JSON.stringify(blob));

  return {
    id,
    kind: "photo",
    encryptedUri: EVIDENCE_PREFIX + id,
    sha256: sha,
    sizeBytes: cleanBytes.length,
    addedAt: Date.now(),
  };
}

/**
 * Push an encrypted evidence blob to the decentralized content layer and
 * return its CID.
 *
 * The blob is already ciphertext before it gets here, and it is encrypted
 * under the device evidence key — which is deliberately NOT shipped to the
 * content layer. So an evidence CID is useless to anyone who fetches it unless
 * the reporter also shares the key (a public report publishes it; a restricted
 * one wraps it to named recipients).
 *
 * This is what removes the assumption of a centralized backend: evidence lives
 * wherever the content store points, and the chain only ever holds a hash.
 */
export async function uploadEvidence(item: EvidenceItem): Promise<EvidenceItem> {
  if (item.cid) return item;

  const blob = await loadEvidenceBlob(item);
  if (!blob) throw new Error(`Evidence ${item.id} missing locally`);

  // Evidence reuses the report's keyring rather than carrying its own, so the
  // stored keyring here is a placeholder that grants nothing on its own.
  const put = await getContentStore().put({
    v: 1,
    blob,
    keyring: { mode: "wrapped", recipients: [] },
  });

  return { ...item, cid: put.cid };
}

export type UploadProgress = {
  current: number;
  total: number;
  itemId: string;
};

/**
 * Upload every evidence item to the content layer.
 *
 * Sequential (not Promise.all) so progress is meaningful on slow connections
 * and so one failed blob does not leave the others half-uploaded with no
 * record of which ones succeeded.
 *
 * If any item fails, the whole call throws after attempting the rest. Callers
 * must not submit a report whose evidence array is missing CIDs — a partial
 * set would silently drop photos from every other reader's view.
 */
export async function uploadAllEvidence(
  items: EvidenceItem[],
  onProgress?: (p: UploadProgress) => void
): Promise<EvidenceItem[]> {
  if (items.length === 0) return [];

  const results: EvidenceItem[] = [];
  const failures: { id: string; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.({ current: i + 1, total: items.length, itemId: item.id });
    try {
      results.push(await uploadEvidence(item));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ id: item.id, error: msg });
    }
  }

  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.id}: ${f.error}`).join("; ");
    throw new Error(
      `Failed to upload ${failures.length} of ${items.length} evidence items. ${detail}`
    );
  }

  return results;
}

export async function deleteEvidence(item: EvidenceItem): Promise<void> {
  await AsyncStorage.removeItem(item.encryptedUri);
}

export async function loadEvidenceBlob(item: EvidenceItem): Promise<EncryptedBlob | null> {
  const raw = await AsyncStorage.getItem(item.encryptedUri);
  return safeJsonParse<EncryptedBlob>(raw);
}

export async function deleteAllEvidence(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const evidenceKeys = keys.filter((k) => k.startsWith(EVIDENCE_PREFIX));
  if (evidenceKeys.length) await AsyncStorage.multiRemove(evidenceKeys);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
