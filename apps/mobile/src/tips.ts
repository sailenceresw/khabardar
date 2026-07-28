import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToHex } from "@noble/ciphers/utils";
import { gcm } from "@noble/ciphers/aes";
import * as Crypto from "expo-crypto";
import { keccak256, toBytes } from "viem";
import { randomKey, utf8ToBytes } from "./cryptoUtils";
import { wrapContentKey, type WrappedKey } from "./content/contentKeys";
import { DEMO_RECIPIENTS, type Recipient } from "./content/recipients";
import { getContentStore } from "./content";
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
 * What v0 does NOT yet do, and must before this is safe to rely on:
 *  - Transport. The sealed payload is stored locally; there is no delivery.
 *    Real delivery has to run over an anonymising transport (Tor, a mixnet, or
 *    at minimum a relay that never sees the sender IP), because the network
 *    metadata is what deanonymises people, not the ciphertext.
 *  - Padding. Message length currently leaks. Tips should be padded to fixed
 *    buckets so a 20-word tip is indistinguishable from a 2000-word one.
 *  - Forward secrecy. A recipient key compromise retroactively opens every
 *    past tip to them. A ratchet (or per-tip recipient subkeys) fixes this.
 */

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
  const ciphertext = gcm(key, nonce).encrypt(utf8ToBytes(message));

  const wrappedKey = wrapContentKey(key, recipient.id, recipient.pubKey);
  const ciphertextHex = bytesToHex(ciphertext);

  return {
    id: `tip_${Date.now()}`,
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
 * Hand the sealed tip to the content layer. This is the closest v0 gets to
 * "sending" — see the transport caveat above; a real deployment replaces this
 * with an anonymising relay.
 */
export async function storeTip(tip: SealedTip): Promise<SealedTip> {
  try {
    const put = await getContentStore().put({
      v: 1,
      blob: { nonce: tip.nonce, ciphertext: tip.ciphertext },
      keyring: { mode: "wrapped", recipients: [tip.wrappedKey] },
    });
    return { ...tip, cid: put.cid, status: "stored" };
  } catch {
    return { ...tip, status: "failed" };
  }
}

export async function sendTip(message: string, recipient: Recipient): Promise<SealedTip> {
  const stored = await storeTip(sealTip(message, recipient));
  await recordTip(stored, message);
  return stored;
}

/**
 * Record only what the sender needs to recognise the tip later. The preview is
 * kept short on purpose — a full local copy of every tip is exactly the kind of
 * evidence a device seizure would surface.
 */
async function recordTip(tip: SealedTip, plaintext: string): Promise<void> {
  const record: TipRecord = {
    id: tip.id,
    recipientId: tip.recipientId,
    recipientName: tip.recipientName,
    digest: tip.digest,
    createdAt: tip.createdAt,
    cid: tip.cid,
    status: tip.status,
    preview: plaintext.slice(0, 40),
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
