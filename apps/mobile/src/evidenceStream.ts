import * as Crypto from "expo-crypto";
import { gcm } from "@noble/ciphers/aes";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";

/**
 * Chunked AES-256-GCM for evidence too large to hold in memory twice.
 *
 * One GCM message over a whole video would need the whole video resident, and
 * GCM gives no way to stream the authentication. So the plaintext is cut into
 * fixed-size chunks and each one is sealed on its own, following the STREAM
 * construction (Hoang, Reyhanitabar, Rogaway, Vizár 2015):
 *
 *   nonce_i = prefix (7 random bytes) ‖ i (u32 big-endian) ‖ last (0x00 | 0x01)
 *
 * Folding the index into the nonce means chunks cannot be reordered or
 * swapped between files without failing authentication; the final-chunk flag
 * means a store that drops the tail cannot pass a truncated file off as
 * complete. Both matter here because the content layer is untrusted.
 *
 * The nonce is never read from storage when decrypting — it is recomputed
 * from the prefix and the position. A stored nonce would let whoever controls
 * the blob choose it.
 */

export const STREAM_CHUNK_BYTES = 1024 * 1024;
const PREFIX_BYTES = 7;

export interface StreamHeader {
  v: "stream1";
  /** hex, 7 bytes */
  noncePrefix: string;
  chunkBytes: number;
  chunkCount: number;
  /** plaintext length */
  sizeBytes: number;
}

export function newStreamHeader(sizeBytes: number, chunkBytes = STREAM_CHUNK_BYTES): StreamHeader {
  return {
    v: "stream1",
    noncePrefix: bytesToHex(Crypto.getRandomBytes(PREFIX_BYTES)),
    chunkBytes,
    // A zero-byte file is still one (empty) final chunk, so truncation to
    // nothing is detectable rather than indistinguishable from "empty".
    chunkCount: Math.max(1, Math.ceil(sizeBytes / chunkBytes)),
    sizeBytes,
  };
}

export function chunkNonce(header: StreamHeader, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= header.chunkCount) {
    throw new Error(`chunk ${index} out of range`);
  }
  const prefix = hexToBytes(header.noncePrefix);
  if (prefix.length !== PREFIX_BYTES) throw new Error("bad nonce prefix");
  const nonce = new Uint8Array(12);
  nonce.set(prefix, 0);
  new DataView(nonce.buffer).setUint32(PREFIX_BYTES, index, false);
  nonce[11] = index === header.chunkCount - 1 ? 1 : 0;
  return nonce;
}

export function sealChunk(header: StreamHeader, key: Uint8Array, index: number, plain: Uint8Array): Uint8Array {
  const expected = expectedChunkLength(header, index);
  if (plain.length !== expected) {
    throw new Error(`chunk ${index} is ${plain.length} bytes, expected ${expected}`);
  }
  return gcm(key, chunkNonce(header, index)).encrypt(plain);
}

export function openChunk(header: StreamHeader, key: Uint8Array, index: number, sealed: Uint8Array): Uint8Array {
  const plain = gcm(key, chunkNonce(header, index)).decrypt(sealed);
  if (plain.length !== expectedChunkLength(header, index)) throw new Error(`chunk ${index} has the wrong length`);
  return plain;
}

function expectedChunkLength(header: StreamHeader, index: number): number {
  if (index < header.chunkCount - 1) return header.chunkBytes;
  return header.sizeBytes - header.chunkBytes * (header.chunkCount - 1);
}

/** Incremental SHA-256 so the fingerprint does not need the whole file either. */
export function createSha256() {
  const h = sha256.create();
  return {
    update(bytes: Uint8Array) {
      h.update(bytes);
    },
    hex(): string {
      return bytesToHex(h.digest());
    },
  };
}

export function isStreamHeader(x: unknown): x is StreamHeader {
  const h = x as StreamHeader;
  return (
    !!h &&
    h.v === "stream1" &&
    typeof h.noncePrefix === "string" &&
    /^[0-9a-f]{14}$/i.test(h.noncePrefix) &&
    Number.isInteger(h.chunkBytes) &&
    h.chunkBytes > 0 &&
    Number.isInteger(h.chunkCount) &&
    h.chunkCount > 0 &&
    Number.isInteger(h.sizeBytes) &&
    h.sizeBytes >= 0 &&
    h.chunkCount === Math.max(1, Math.ceil(h.sizeBytes / h.chunkBytes))
  );
}
