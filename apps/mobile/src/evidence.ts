import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EvidenceItem } from "@khabardar/shared";
import { encrypt, sha256Hex, type EncryptedBlob } from "./cryptoUtils";
import { getContentStore } from "./content";
import { getEvidenceKey } from "./drafts";
import { safeJsonParse } from "./safeJson";

const EVIDENCE_PREFIX = "khabardar.evidence.";

/**
 * Largest attachment accepted, before encryption.
 *
 * The cap exists because the storage path below is `AsyncStorage` + hex, which
 * costs roughly 2× the file size in a store that is not built for blobs. Past a
 * few megabytes that is slow on a mid-range Android phone and can fail outright.
 * A real deployment should move to `expo-file-system` streaming (see
 * {@link readFileBytes}) and raise this considerably — video evidence in
 * particular is well beyond it.
 */
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

export class EvidenceTooLarge extends Error {
  constructor(readonly sizeBytes: number) {
    super(`Evidence is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; the limit is 8 MB`);
    this.name = "EvidenceTooLarge";
  }
}

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

  return storeEvidence(base64ToBytes(reencoded.base64), "photo");
}

/**
 * Attach a document (PDF, scan, spreadsheet — a tender sheet, a muster roll).
 *
 * **Metadata warning that the UI must repeat.** Unlike a photo, a document is
 * NOT re-encoded, because there is no format-agnostic way to do it without
 * destroying the document. So author names, revision history, tracked changes,
 * printer identifiers, and template paths survive inside the file. For an
 * internal document that a small number of people could have accessed, that
 * metadata can identify the leaker on its own — it is exactly how several
 * real-world sources have been caught.
 *
 * The honest mitigations, in order: print-to-PDF or photograph the page instead
 * of attaching the original; or attach it and accept that the recipient must
 * scrub it. Server-side sanitisation (what GlobaLeaks does) is the real fix and
 * is not in this scaffold.
 */
export async function pickAndSecureDocument(): Promise<EvidenceItem | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_EVIDENCE_BYTES) throw new EvidenceTooLarge(asset.size);

  const bytes = await readFileBytes(asset.uri);
  return storeEvidence(bytes, "document");
}

/**
 * Record audio evidence and store it encrypted.
 *
 * Returns a handle whose `stop()` finishes the recording and produces the
 * evidence item. Audio carries two risks a photo does not, and both belong in
 * the UI copy rather than buried here: a voice is biometric and identifies the
 * speaker, and background sound can locate the recording.
 *
 * The permission is requested here, at the moment of recording, rather than at
 * launch — an app that asks for the microphone on first open looks like
 * something to be suspicious of, and on a phone someone else may inspect, that
 * matters. Location permissions remain blocked outright in app.json.
 */
export async function startAudioEvidence(): Promise<AudioRecordingHandle> {
  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Microphone permission denied");

  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );

  return {
    async stop(): Promise<EvidenceItem | null> {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recording.getURI();
      if (!uri) return null;

      const bytes = await readFileBytes(uri);
      const item = await storeEvidence(bytes, "audio");

      // Delete the plaintext recording the OS wrote to cache. Without this the
      // unencrypted audio outlives the encrypted copy we just made.
      await FileSystem.deleteAsync(uri, { idempotent: true });
      return item;
    },
    async cancel(): Promise<void> {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // Already stopped; nothing to unwind.
      }
      const uri = recording.getURI();
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    },
  };
}

export interface AudioRecordingHandle {
  stop(): Promise<EvidenceItem | null>;
  cancel(): Promise<void>;
}

/** Encrypt, fingerprint, and persist one attachment. Shared by every kind. */
async function storeEvidence(
  bytes: Uint8Array,
  kind: EvidenceItem["kind"]
): Promise<EvidenceItem> {
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new EvidenceTooLarge(bytes.length);

  const key = await getEvidenceKey();
  const blob = encrypt(bytes, key);
  const sha = await sha256Hex(bytes);

  const id = `ev_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  // v0: encrypted blob lives in AsyncStorage (works on all platforms incl.
  // web preview). Production: expo-file-system with streaming encryption.
  await AsyncStorage.setItem(EVIDENCE_PREFIX + id, JSON.stringify(blob));

  return {
    id,
    kind,
    encryptedUri: EVIDENCE_PREFIX + id,
    sha256: sha,
    sizeBytes: bytes.length,
    addedAt: Date.now(),
  };
}

/**
 * Read a file URI into memory.
 *
 * Base64 via expo-file-system, which means the whole file is resident twice
 * during the read. That is the ceiling {@link MAX_EVIDENCE_BYTES} exists to
 * respect, and the thing to replace with chunked reads plus streaming AES-GCM
 * when large evidence matters.
 */
async function readFileBytes(uri: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(base64);
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

export async function uploadAllEvidence(items: EvidenceItem[]): Promise<EvidenceItem[]> {
  return Promise.all(items.map(uploadEvidence));
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
