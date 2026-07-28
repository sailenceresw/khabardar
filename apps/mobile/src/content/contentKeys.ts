import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";
import * as Crypto from "expo-crypto";

/**
 * How the content key for a published bundle is made available to readers.
 *
 * The keyring lives OUTSIDE the encrypted blob (it has to — you need it to
 * decrypt). It is the only part of a published report that is not ciphertext,
 * and it deliberately contains no reporter identifier.
 */
export type ContentKeyring =
  | {
      /** Anyone can read: the content key is published openly. */
      mode: "public";
      key: string; // hex
    }
  | {
      /** Only holders of a listed private key can unwrap the content key. */
      mode: "wrapped";
      recipients: WrappedKey[];
    };

export interface WrappedKey {
  /** Human-readable label for the newsroom/NGO — never the reporter. */
  recipientId: string;
  /** Recipient's secp256k1 public key, hex (33-byte compressed). */
  recipientPubKey: string;
  /** Ephemeral public key used for this wrap, hex. */
  ephemeralPubKey: string;
  nonce: string; // hex
  ciphertext: string; // hex, the wrapped content key
}

const WRAP_INFO = new TextEncoder().encode("khabardar/content-key-wrap/v1");

/**
 * ECIES over secp256k1: ephemeral ECDH -> HKDF-SHA256 -> AES-256-GCM.
 * A fresh ephemeral keypair per wrap means the same content key sent to the
 * same recipient twice produces unlinkable ciphertexts.
 */
export function wrapContentKey(
  contentKey: Uint8Array,
  recipientId: string,
  recipientPubKeyHex: string
): WrappedKey {
  const ephemeralPriv = secp256k1.utils.randomPrivateKey();
  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, true);

  const shared = secp256k1.getSharedSecret(ephemeralPriv, hexToBytes(recipientPubKeyHex), true);
  // Drop the leading format byte before deriving.
  const wrappingKey = hkdf(sha256, shared.slice(1), undefined, WRAP_INFO, 32);

  const nonce = Crypto.getRandomBytes(12);
  const ciphertext = gcm(wrappingKey, nonce).encrypt(contentKey);

  return {
    recipientId,
    recipientPubKey: recipientPubKeyHex,
    ephemeralPubKey: bytesToHex(ephemeralPub),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
}

export function unwrapContentKey(wrapped: WrappedKey, recipientPrivKeyHex: string): Uint8Array {
  const priv = hexToBytes(recipientPrivKeyHex.replace(/^0x/, ""));
  const shared = secp256k1.getSharedSecret(priv, hexToBytes(wrapped.ephemeralPubKey), true);
  const wrappingKey = hkdf(sha256, shared.slice(1), undefined, WRAP_INFO, 32);

  return gcm(wrappingKey, hexToBytes(wrapped.nonce)).decrypt(hexToBytes(wrapped.ciphertext));
}

/** Build the keyring for a report the author chose to publish openly. */
export function publicKeyring(contentKey: Uint8Array): ContentKeyring {
  return { mode: "public", key: bytesToHex(contentKey) };
}

/** Build the keyring for a report restricted to named journalists/NGOs. */
export function wrappedKeyring(
  contentKey: Uint8Array,
  recipients: Array<{ id: string; pubKey: string }>
): ContentKeyring {
  return {
    mode: "wrapped",
    recipients: recipients.map((r) => wrapContentKey(contentKey, r.id, r.pubKey)),
  };
}

/**
 * Recover the content key from a keyring, if this device can. Returns null for
 * a wrapped keyring we hold no matching key for — the caller shows the report
 * as locked rather than failing.
 */
export function resolveContentKey(
  keyring: ContentKeyring,
  recipientPrivKeyHex?: string
): Uint8Array | null {
  if (keyring.mode === "public") return hexToBytes(keyring.key);
  if (!recipientPrivKeyHex) return null;

  const priv = hexToBytes(recipientPrivKeyHex.replace(/^0x/, ""));
  const myPub = bytesToHex(secp256k1.getPublicKey(priv, true));
  const mine = keyring.recipients.find((r) => r.recipientPubKey === myPub);
  if (!mine) return null;

  try {
    return unwrapContentKey(mine, recipientPrivKeyHex);
  } catch {
    return null;
  }
}
