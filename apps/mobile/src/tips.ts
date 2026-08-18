import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToHex } from "@noble/ciphers/utils";
import { gcm } from "@noble/ciphers/aes";
import * as Crypto from "expo-crypto";
import { keccak256, toBytes } from "viem";
import { bytesToUtf8, randomKey, utf8ToBytes } from "./cryptoUtils";
import { wrapContentKey, type WrappedKey } from "./content/contentKeys";
import { DEMO_RECIPIENTS, type Recipient } from "./content/recipients";
import { getContentStore } from "./content";
import { isolateNextRequests } from "./net/transport";
import { safeJsonParse } from "./safeJson";

/**
 * End-to-end encrypted tips to a specific journalist or NGO.
 *
 * Differs from a report in one important way: a report is anchored on-chain so
 * it cannot be suppressed, whereas a tip is a private message that must leave
 * as little trace as possible. Nothing about a tip is written to the chain.
 *
 * Sealing is the same ECIES construction used for restricted report bundles
 * (ephemeral ECDH -> HKDF -> AES-256-GCM), so only the named recipient's
 * private key can open it.
 *
 * Length is padded to fixed buckets before sealing — see {@link padToBucket}.
 *
 * Delivery goes through the same content-store + transport seam as reports.
 * `isolateNextRequests()` runs first, so two tips do not share a circuit.
 * On the default mock store the "upload" never leaves the device — the UI
 * must say so. Forward secrecy is still missing: a recipient key compromise
 * retroactively opens every past tip to them.
 */

/**
 * Ciphertext length buckets, in bytes of padded plaintext.
 *
 * AES-GCM is a stream cipher construction: ciphertext length equals plaintext
 * length. Without padding, an observer who never breaks the encryption still
 * learns roughly how much someone wrote — and "a 4KB tip to this newsroom on
 * the morning the story broke" is a strong enough signal on its own. Bucketing
 * collapses that into a handful of indistinguishable sizes.
 *
 * The buckets are coarse and few on purpose: more buckets mean finer leakage,
 * and the cost of over-padding is bytes, which are cheap compared to the
 * anonymity they buy.
 */
export const TIP_LENGTH_BUCKETS = [512, 2048, 8192, 32768, 131072] as const;

/**
 * Pad `message` up to the next bucket using a length-prefixed encoding.
 *
 * Layout: `[4-byte big-endian length][utf-8 message][random filler]`. Filler is
 * random rather than zeroes so a compromised-but-not-broken ciphertext leaks
 * nothing about where the real content stops.
 */
export function padToBucket(message: string): Uint8Array {
  const body = utf8ToBytes(message);
  const needed = body.length + 4;

  const bucket = TIP_LENGTH_BUCKETS.find((b) => b >= needed);
  // Beyond the largest bucket, round up to a whole multiple of it rather than
  // sending an exact length — a long tip should not be self-identifying either.
  const size = bucket ?? Math.ceil(needed / TIP_LENGTH_BUCKETS[TIP_LENGTH_BUCKETS.length - 1]) *
    TIP_LENGTH_BUCKETS[TIP_LENGTH_BUCKETS.length - 1];

  const padded = new Uint8Array(size);
  padded.set(Crypto.getRandomBytes(size), 0);

  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  view.setUint32(0, body.length, false);
  padded.set(body, 4);
  return padded;
}

/** Inverse of {@link padToBucket}. Used by the recipient's tooling. */
export function unpadFromBucket(padded: Uint8Array): string {
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const length = view.getUint32(0, false);
  if (length > padded.byteLength - 4) throw new Error("Padded tip declares an impossible length");
  return bytesToUtf8(padded.subarray(4, 4 + length));
}

const TIPS_INDEX = "khabardar.tips.index.v1";

export interface SealedTip {
  id: string;
  recipientId: string;
  recipientName: string;
  /** Wrapped symmetric key — only the recipient can unwrap it. */
  wrappedKey: WrappedKey;
  nonce: string;
  ciphertext: string;
  /** keccak256 of the ciphertext, so the sender can prove what they sent. */
  digest: string;
  createdAt: number;
  /** Content-store pointer once uploaded; absent while undelivered. */
  cid?: string;
  status: "sealed" | "stored" | "failed";
}

/** Metadata kept locally so the sender can see what they sent, minus content. */
export interface TipRecord extends Omit<SealedTip, "ciphertext" | "wrappedKey" | "nonce"> {
  preview: string;
  /** True when the "upload" was the local mock store and never left the device. */
  simulated?: boolean;
}

export function listRecipients(): Recipient[] {
  return DEMO_RECIPIENTS;
}

export function getRecipient(id: string): Recipient | undefined {
  return DEMO_RECIPIENTS.find((r) => r.id === id);
}

/**
 * Seal a tip to a recipient. The plaintext never leaves this function
 * unencrypted, and the symmetric key exists only long enough to wrap it.
 */
export function sealTip(message: string, recipient: Recipient): SealedTip {
  const key = randomKey();
  const nonce = Crypto.getRandomBytes(12);
  // Padded before encryption, so the ciphertext length reveals only which
  // bucket the tip fell into and not how much was written.
  const ciphertext = gcm(key, nonce).encrypt(padToBucket(message));

  const wrappedKey = wrapContentKey(key, recipient.id, recipient.pubKey);
  const ciphertextHex = bytesToHex(ciphertext);

  return {
    // Timestamp alone collides for two tips sealed in the same millisecond,
    // which silently overwrites one in the local list.
    id: `tip_${Date.now()}_${bytesToHex(Crypto.getRandomBytes(4))}`,
    recipientId: recipient.id,
    recipientName: recipient.name,
    wrappedKey,
    nonce: bytesToHex(nonce),
    ciphertext: ciphertextHex,
    digest: keccak256(toBytes(ciphertextHex)),
    createdAt: Date.now(),
    status: "sealed",
  };
}

/**
 * Hand the sealed tip to the content layer, through the same transport
 * seam as a report. Isolation runs first so two tips do not share a circuit.
 *
 * Errors propagate. Swallowing them as `status: "failed"` hid the reason
 * — "Tor refused", "anonymity required", "pin failed" all looked the same.
 */
export async function storeTip(
  tip: SealedTip
): Promise<SealedTip & { simulated: boolean }> {
  await isolateNextRequests();
  const put = await getContentStore().put({
    v: 1,
    blob: { nonce: tip.nonce, ciphertext: tip.ciphertext },
    keyring: { mode: "wrapped", recipients: [tip.wrappedKey] },
  });
  return { ...tip, cid: put.cid, status: "stored", simulated: put.simulated };
}

export async function sendTip(
  message: string,
  recipient: Recipient
): Promise<SealedTip & { simulated: boolean }> {
  const sealed = sealTip(message, recipient);
  try {
    const stored = await storeTip(sealed);
    await recordTip(stored, message, stored.simulated);
    return stored;
  } catch (e) {
    await recordTip({ ...sealed, status: "failed" }, message, false);
    throw e;
  }
}

/**
 * Record only what the sender needs to recognise the tip later. The preview is
 * kept short on purpose — a full local copy of every tip is exactly the kind of
 * evidence a device seizure would surface.
 */
async function recordTip(tip: SealedTip, plaintext: string, simulated: boolean): Promise<void> {
  const record: TipRecord = {
    id: tip.id,
    recipientId: tip.recipientId,
    recipientName: tip.recipientName,
    digest: tip.digest,
    createdAt: tip.createdAt,
    cid: tip.cid,
    status: tip.status,
    preview: plaintext.slice(0, 40),
    simulated,
  };

  const existing = await listTips();
  await AsyncStorage.setItem(TIPS_INDEX, JSON.stringify([record, ...existing]));
}

export async function listTips(): Promise<TipRecord[]> {
  const raw = await AsyncStorage.getItem(TIPS_INDEX);
  return safeJsonParse<TipRecord[]>(raw) ?? [];
}

export async function deleteAllTips(): Promise<void> {
  await AsyncStorage.removeItem(TIPS_INDEX);
}
