import * as Crypto from "expo-crypto";
import { gcm } from "@noble/ciphers/aes";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";
import { keccak256, toBytes } from "viem";

export interface EncryptedBlob {
  /** hex, 12-byte GCM nonce */
  nonce: string;
  /** hex ciphertext (includes GCM tag) */
  ciphertext: string;
}

export function randomKey(): Uint8Array {
  return Crypto.getRandomBytes(32);
}

export function encrypt(plaintext: Uint8Array, key: Uint8Array): EncryptedBlob {
  const nonce = Crypto.getRandomBytes(12);
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  return { nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
}

export function decrypt(blob: EncryptedBlob, key: Uint8Array): Uint8Array {
  return gcm(key, hexToBytes(blob.nonce)).decrypt(hexToBytes(blob.ciphertext));
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  // Hash the view, not its backing store: a Uint8Array produced by subarray()
  // or by a base64 decoder that over-allocates shares a larger ArrayBuffer, and
  // passing `.buffer` straight through would fingerprint the neighbouring bytes
  // too. Evidence hashes are compared against the on-chain anchor, so an
  // off-by-a-few-bytes digest is a silent integrity failure.
  const bytes = data.slice();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Canonical report fingerprint anchored on-chain: keccak256 over a stable
 * serialization of the encrypted body + encrypted evidence hashes. Anyone
 * holding the decrypted bundle can recompute and verify it against the chain.
 */
export function computeReportHash(input: {
  encryptedBody: EncryptedBlob;
  evidenceSha256: string[];
  category: number;
  coarseGeohash: string;
  createdAt: number;
}): `0x${string}` {
  const canonical = JSON.stringify({
    v: 1,
    body: input.encryptedBody,
    evidence: [...input.evidenceSha256].sort(),
    category: input.category,
    geo: input.coarseGeohash,
    t: input.createdAt,
  });
  return keccak256(toBytes(canonical));
}
