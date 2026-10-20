import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";
import type { EvidenceItem } from "@khabardar/shared";
import { bytesToUtf8, decrypt, encrypt, randomKey, utf8ToBytes, type EncryptedBlob } from "./cryptoUtils";
import { getContentStore } from "./content";
import type { ContentKeyring } from "./content/contentKeys";
import { getEvidenceKey } from "./drafts";
import {
  createSha256,
  isStreamHeader,
  newStreamHeader,
  openChunk,
  sealChunk,
  type StreamHeader,
} from "./evidenceStream";
import { safeJsonParse } from "./safeJson";

const EVIDENCE_PREFIX = "khabardar.evidence.";
/** Local stream header; also the item's `encryptedUri`. Written last, so its presence means the chunks are complete. */
const STREAM_PREFIX = EVIDENCE_PREFIX + "stream.";
/** Web preview only: chunks live in AsyncStorage because there is no file system. */
const WEB_CHUNK_PREFIX = EVIDENCE_PREFIX + "chunk.";

const MB = 1024 * 1024;

/**
 * Largest attachment accepted, before encryption.
 *
 * On a device, evidence is read, encrypted and written one chunk at a time
 * (see {@link storeEvidence}), so memory no longer bounds it. Speed does: the
 * AES-GCM here is pure JS, ~10 MB/s under V8's JIT and several times slower
 * on Hermes, which has none — behind a spinner with no progress. 64 MB is a
 * guess at "under a minute or two" that has not been timed on a phone; native
 * AES is what would let this go higher. The web preview keeps chunks in
 * localStorage, so it keeps the old ceiling.
 */
export const MAX_EVIDENCE_BYTES = Platform.OS === "web" ? 8 * MB : 64 * MB;
export const MAX_EVIDENCE_LABEL = `${MAX_EVIDENCE_BYTES / MB} MB`;

export class EvidenceTooLarge extends Error {
  constructor(readonly sizeBytes: number) {
    super(`Evidence is ${(sizeBytes / MB).toFixed(1)} MB; the limit is ${MAX_EVIDENCE_LABEL}`);
    this.name = "EvidenceTooLarge";
  }
}

// Evidence reuses the report's keyring rather than carrying its own, so the
// stored keyring is a placeholder that grants nothing on its own.
const NO_KEYRING: ContentKeyring = { mode: "wrapped", recipients: [] };

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
  try {
    if (!reencoded.base64) throw new Error("re-encode failed");
    return await storeEvidence(bytesSource(base64ToBytes(reencoded.base64)), "photo");
  } finally {
    // The manipulator also writes its JPEG to the cache. It is metadata-free
    // but still plaintext, and would outlive the encrypted copy.
    await deletePlaintext(reencoded.uri);
  }
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
  // `copyToCacheDirectory` means `asset.uri` is our own plaintext copy, not the
  // user's original, so it is ours to delete — and must be, or the unencrypted
  // document sits in the cache after the encrypted one is made.
  try {
    if (asset.size && asset.size > MAX_EVIDENCE_BYTES) throw new EvidenceTooLarge(asset.size);
    return await storeEvidence(await fileSource(asset.uri), "document");
  } finally {
    await deletePlaintext(asset.uri);
  }
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

      // Delete the plaintext recording the OS wrote to cache — in a finally,
      // because a recording that fails to store (too long, disk full) is the
      // one most likely to be left behind unencrypted otherwise.
      try {
        return await storeEvidence(await fileSource(uri), "audio");
      } finally {
        await deletePlaintext(uri);
      }
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

/** Plaintext to be encrypted, read on demand so it never has to be resident at once. */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

/**
 * A file read in ranges. expo-file-system only honours `position`/`length`
 * with Base64, so each chunk is a base64 round trip — but only one chunk's
 * worth, which is what lifts the old whole-file-in-memory ceiling.
 */
async function fileSource(uri: string): Promise<ByteSource> {
  if (Platform.OS === "web") {
    // No ranged reads on web; the preview's cap keeps this small.
    return bytesSource(new Uint8Array(await (await fetch(uri)).arrayBuffer()));
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error("evidence file vanished before it was read");
  return {
    size: info.size,
    async read(position, length) {
      // Android serves a range with a single InputStream.read, which may
      // return short. Keep asking until the range is filled or the file ends.
      const out = new Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        const part = base64ToBytes(
          await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
            position: position + filled,
            length: length - filled,
          })
        );
        if (part.length === 0) break;
        out.set(part, filled);
        filled += part.length;
      }
      return out.subarray(0, filled);
    },
  };
}

async function deletePlaintext(uri: string | null | undefined): Promise<void> {
  if (!uri || Platform.OS === "web") return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/**
 * Encrypt, fingerprint, and persist one attachment. Shared by every kind.
 *
 * Each item gets its own random key. That key is what travels inside the
 * report bundle (see {@link evidenceKey}), so readers of a report can open its
 * evidence and nothing else; the device evidence key only seals the per-item
 * keys locally and never leaves the keystore.
 *
 * One chunk is in memory at a time: read, hash, seal, write. The local header
 * goes in last, so a crash mid-write leaves chunks with no header — invisible
 * to the app and swept by {@link deleteAllEvidence} — rather than a header
 * pointing at a half-written file.
 */
export async function storeEvidence(
  source: ByteSource,
  kind: EvidenceItem["kind"],
  id = `ev_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
): Promise<EvidenceItem> {
  if (source.size > MAX_EVIDENCE_BYTES) throw new EvidenceTooLarge(source.size);

  const key = randomKey();
  const header = newStreamHeader(source.size);
  const hash = createSha256();

  try {
    for (let i = 0; i < header.chunkCount; i++) {
      const offset = i * header.chunkBytes;
      const plain = await source.read(offset, Math.min(header.chunkBytes, source.size - offset));
      hash.update(plain);
      await chunks.write(id, i, sealChunk(header, key, i, plain));
    }
    const local: LocalStreamHeader = { ...header, key: encrypt(key, await getEvidenceKey()) };
    await AsyncStorage.setItem(STREAM_PREFIX + id, JSON.stringify(local));
  } catch (e) {
    await chunks.remove(id);
    throw e;
  }

  return {
    id,
    kind,
    encryptedUri: STREAM_PREFIX + id,
    sha256: hash.hex(),
    sizeBytes: source.size,
    addedAt: Date.now(),
  };
}

/**
 * Where sealed chunks live. On a device that is one file per chunk under the
 * app's document directory, which — like AsyncStorage, which it replaces — is
 * inside the app sandbox and included in OS backups; the chunks are ciphertext
 * and the key stays in the keystore, which is not.
 */
const chunks = {
  dir(id: string): string {
    return `${FileSystem.documentDirectory}evidence/${id}/`;
  },

  async write(id: string, index: number, sealed: Uint8Array): Promise<void> {
    if (Platform.OS === "web") {
      await AsyncStorage.setItem(`${WEB_CHUNK_PREFIX}${id}.${index}`, bytesToBase64(sealed));
      return;
    }
    if (index === 0) await FileSystem.makeDirectoryAsync(this.dir(id), { intermediates: true });
    await FileSystem.writeAsStringAsync(this.dir(id) + index, bytesToBase64(sealed), {
      encoding: FileSystem.EncodingType.Base64,
    });
  },

  async read(id: string, index: number): Promise<Uint8Array | null> {
    if (Platform.OS === "web") {
      const b64 = await AsyncStorage.getItem(`${WEB_CHUNK_PREFIX}${id}.${index}`);
      return b64 === null ? null : base64ToBytes(b64);
    }
    try {
      return base64ToBytes(
        await FileSystem.readAsStringAsync(this.dir(id) + index, { encoding: FileSystem.EncodingType.Base64 })
      );
    } catch {
      return null;
    }
  },

  async remove(id: string): Promise<void> {
    if (Platform.OS === "web") {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(`${WEB_CHUNK_PREFIX}${id}.`));
      if (keys.length) await AsyncStorage.multiRemove(keys);
      return;
    }
    await FileSystem.deleteAsync(this.dir(id), { idempotent: true });
  },

  async removeAll(): Promise<void> {
    if (Platform.OS === "web") return; // covered by the AsyncStorage prefix sweep
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}evidence/`, { idempotent: true });
  },
};

/**
 * What an uploaded streamed item's CID points at: the stream header plus the
 * chunk CIDs, itself encrypted under the evidence key so the content layer
 * learns neither the file's structure nor which chunks belong together beyond
 * what upload timing already reveals.
 */
interface EvidenceManifest extends StreamHeader {
  chunks: string[];
}

/** The on-device header: the stream header plus the item key, sealed under the device evidence key. */
interface LocalStreamHeader extends StreamHeader {
  key: EncryptedBlob;
  /** Chunks already in the content store, in order, so a retry can resume. */
  uploaded?: { store: string; cids: string[] };
}

/**
 * The item's own key, for the report bundle. Whoever can decrypt the bundle
 * can decrypt this item — that is the intent: a Public report's evidence is
 * public, a JournalistsOnly report's is readable by its recipients only.
 */
export async function evidenceKey(item: EvidenceItem): Promise<Uint8Array> {
  const header = await loadStreamHeader(item);
  if (!header) throw new Error(`Evidence ${item.id} missing locally`);
  return decrypt(header.key, await getEvidenceKey());
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
 * Streamed items go up one chunk at a time, then the manifest; the item's CID
 * is the manifest's. Chunks are content-addressed, so a retry after a dropped
 * connection re-sends them without minting duplicates.
 *
 * This is what removes the assumption of a centralized backend: evidence lives
 * wherever the content store points, and the chain only ever holds a hash.
 */
export async function uploadEvidence(item: EvidenceItem): Promise<EvidenceItem> {
  if (!isStreamed(item)) return uploadLegacy(item);
  if (item.cid) return item;
  return uploadStreamed(item);
}

function isStreamed(item: EvidenceItem): boolean {
  return item.encryptedUri.startsWith(STREAM_PREFIX);
}

/**
 * Items stored before chunking are one GCM blob under the device evidence
 * key — a key that cannot go into a bundle without opening every attachment
 * this device has ever made. So they are re-sealed as a stream under their
 * own key first, and uploaded as that. A legacy CID, if any, is dropped: it
 * points at a blob no reader could ever decrypt.
 *
 * The re-sealed copy has a fixed id, because a failed publish saves the
 * report with its *old* evidence items: the retry has to find the copy made
 * last time, or the legacy blob — already gone — would be the only lead.
 */
async function uploadLegacy(item: EvidenceItem): Promise<EvidenceItem> {
  const resealedId = legacyResealId(item);
  let resealed: EvidenceItem = { ...item, id: resealedId, encryptedUri: STREAM_PREFIX + resealedId, cid: undefined };
  if (!(await loadStreamHeader(resealed))) {
    const blob = await loadEvidenceBlob(item);
    if (!blob) throw new Error(`Evidence ${item.id} missing locally`);
    const fresh = await storeEvidence(bytesSource(decrypt(blob, await getEvidenceKey())), item.kind, resealedId);
    if (fresh.sha256 !== item.sha256) {
      await deleteEvidence(fresh);
      throw new Error(`Evidence ${item.id} no longer matches its fingerprint`);
    }
    resealed = { ...fresh, addedAt: item.addedAt };
  }
  // Safe now that the re-sealed copy is durable on its own.
  await AsyncStorage.removeItem(item.encryptedUri);
  return uploadStreamed(resealed);
}

function legacyResealId(item: EvidenceItem): string {
  return `${item.id}_v2`;
}

async function uploadStreamed(item: EvidenceItem): Promise<EvidenceItem> {
  const header = await loadStreamHeader(item);
  if (!header) throw new Error(`Evidence ${item.id} missing locally`);
  const key = await evidenceKey(item);

  // Resume where a dropped upload stopped. Over Tor a large file can take long
  // enough that restarting from chunk 0 on every retry means it never lands.
  // Progress is keyed to the store it was made on: a CID from the mock store
  // means nothing to an IPFS pinning service.
  const store = getContentStore();
  const chunkCids =
    header.uploaded?.store === store.name ? header.uploaded.cids.slice(0, header.chunkCount) : [];
  for (let i = chunkCids.length; i < header.chunkCount; i++) {
    const sealed = await chunks.read(item.id, i);
    if (!sealed) throw new Error(`Evidence ${item.id} chunk ${i} missing locally`);
    // The nonce is left out on purpose: a reader recomputes it from the
    // manifest, and publishing it would label every chunk with its file and
    // position for anyone browsing the store.
    const put = await store.put({
      v: 1,
      blob: { nonce: "", ciphertext: bytesToHex(sealed) },
      keyring: NO_KEYRING,
    });
    chunkCids.push(put.cid);
    await AsyncStorage.setItem(
      item.encryptedUri,
      JSON.stringify({ ...header, uploaded: { store: store.name, cids: chunkCids } } satisfies LocalStreamHeader)
    );
  }

  const { key: _sealedKey, uploaded: _uploaded, ...streamHeader } = header;
  const manifest: EvidenceManifest = { ...streamHeader, chunks: chunkCids };
  const sealedManifest = encrypt(utf8ToBytes(JSON.stringify(manifest)), key);
  const put = await store.put({ v: 1, blob: sealedManifest, keyring: NO_KEYRING });
  return { ...item, cid: put.cid };
}

/**
 * Recipient side: fetch an uploaded streamed item and hand its plaintext to
 * `sink` one verified chunk at a time. Throws on any missing, reordered,
 * swapped or truncated chunk; a chunk is only passed on once it authenticates,
 * but a caller writing to disk must still discard the output if this throws.
 */
export async function readUploadedEvidence(
  cid: string,
  key: Uint8Array,
  sink: (plain: Uint8Array, index: number) => Promise<void> | void
): Promise<StreamHeader> {
  const store = getContentStore();
  const bundle = await store.get(cid);
  if (!bundle) throw new Error("evidence manifest unavailable");
  const manifest = safeJsonParse<EvidenceManifest>(bytesToUtf8(decrypt(bundle.blob, key)));
  if (!isStreamHeader(manifest) || !Array.isArray(manifest.chunks) || manifest.chunks.length !== manifest.chunkCount) {
    throw new Error("evidence manifest malformed");
  }
  for (let i = 0; i < manifest.chunkCount; i++) {
    const chunk = await store.get(manifest.chunks[i]);
    if (!chunk) throw new Error(`evidence chunk ${i} unavailable`);
    await sink(openChunk(manifest, key, i, hexToBytes(chunk.blob.ciphertext)), i);
  }
  return manifest;
}

export async function uploadAllEvidence(items: EvidenceItem[]): Promise<EvidenceItem[]> {
  return Promise.all(items.map(uploadEvidence));
}

export async function deleteEvidence(item: EvidenceItem): Promise<void> {
  if (!isStreamed(item)) {
    // A legacy item may have a re-sealed copy from an upload attempt.
    const resealedId = legacyResealId(item);
    await chunks.remove(resealedId);
    await AsyncStorage.removeItem(STREAM_PREFIX + resealedId);
  } else {
    await chunks.remove(item.id);
  }
  await AsyncStorage.removeItem(item.encryptedUri);
}

export async function loadEvidenceBlob(item: EvidenceItem): Promise<EncryptedBlob | null> {
  const raw = await AsyncStorage.getItem(item.encryptedUri);
  return safeJsonParse<EncryptedBlob>(raw);
}

async function loadStreamHeader(item: EvidenceItem): Promise<LocalStreamHeader | null> {
  const header = safeJsonParse<LocalStreamHeader>(await AsyncStorage.getItem(item.encryptedUri));
  return isStreamHeader(header) && typeof header.key?.ciphertext === "string" ? header : null;
}

export async function deleteAllEvidence(): Promise<void> {
  // Files first: a header without its chunks is harmless, chunks without a
  // header are exactly the orphans this sweep is for.
  await chunks.removeAll();
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

function bytesToBase64(bytes: Uint8Array): string {
  if (!globalThis.btoa) return Buffer.from(bytes).toString("base64");
  // fromCharCode in slices: spreading a 1 MiB chunk at once overflows the
  // argument limit on Hermes.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return globalThis.btoa(binary);
}
