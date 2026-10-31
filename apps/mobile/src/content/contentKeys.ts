import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";
import * as Crypto from "expo-crypto";
import { randomBytes } from "../cryptoUtils";

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

/**
 * One recipient's copy of a content key, as published.
 *
 * It does not say who the recipient is. A wrap that named its newsroom told
 * anyone browsing the content store "a tip to this newsroom, at this time"
 * without breaking any encryption — for a tip, that is most of what an
 * adversary wants. Recipients find their entry by trial decryption instead.
 */
export interface WrappedKey {
  /** 2 for anonymous wraps; absent on v1 wraps from older builds. */
  v?: 2;
  /** Ephemeral public key used for this wrap, hex. */
  ephemeralPubKey: string;
  nonce: string; // hex
  ciphertext: string; // hex, the wrapped content key
  /** v1 only: the newsroom label. Read for old bundles; never written. */
  recipientId?: string;
  /** v1 only: the recipient's public key. Read for old bundles; never written. */
  recipientPubKey?: string;
}

const WRAP_INFO_V1 = new TextEncoder().encode("khabardar/content-key-wrap/v1");
const WRAP_INFO_V2 = new TextEncoder().encode("khabardar/content-key-wrap/v2");

/**
 * v2 binds both public keys into the derivation. With the recipient no
 * longer named on the wrap, this is what still ties a wrap to the key it
 * was made for: the same shared secret under a different claimed pair
 * derives a different wrapping key.
 */
function wrappingKeyV2(shared: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(ephemeralPub.length + recipientPub.length);
  salt.set(ephemeralPub, 0);
  salt.set(recipientPub, ephemeralPub.length);
  // Drop the leading format byte before deriving.
  return hkdf(sha256, shared.slice(1), salt, WRAP_INFO_V2, 32);
}

/**
 * ECIES over secp256k1: ephemeral ECDH -> HKDF-SHA256 -> AES-256-GCM.
 * A fresh ephemeral keypair per wrap means the same content key sent to the
 * same recipient twice produces unlinkable ciphertexts.
 */
export function wrapContentKey(contentKey: Uint8Array, recipientPubKeyHex: string): WrappedKey {
  const recipientPub = hexToBytes(recipientPubKeyHex);
  const ephemeralPriv = secp256k1.utils.randomPrivateKey();
  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, true);

  const shared = secp256k1.getSharedSecret(ephemeralPriv, recipientPub, true);
  const wrappingKey = wrappingKeyV2(shared, ephemeralPub, recipientPub);

  const nonce = Crypto.getRandomBytes(12);
  const ciphertext = gcm(wrappingKey, nonce).encrypt(contentKey);

  return {
    v: 2,
    ephemeralPubKey: bytesToHex(ephemeralPub),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  };
}

/** Throws if this wrap was not made for this key — which is how trial decryption tells. */
export function unwrapContentKey(wrapped: WrappedKey, recipientPrivKeyHex: string): Uint8Array {
  const priv = hexToBytes(recipientPrivKeyHex.replace(/^0x/, ""));
  const ephemeralPub = hexToBytes(wrapped.ephemeralPubKey);
  const shared = secp256k1.getSharedSecret(priv, ephemeralPub, true);
  const wrappingKey =
    wrapped.v === 2
      ? wrappingKeyV2(shared, ephemeralPub, secp256k1.getPublicKey(priv, true))
      : hkdf(sha256, shared.slice(1), undefined, WRAP_INFO_V1, 32);

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
    // Shuffled so entry order does not stand in for the recipient names the
    // wraps no longer carry: with a fixed recipient list, "entry 2" would be
    // the same newsroom on every report.
    recipients: shuffle(recipients.map((r) => wrapContentKey(contentKey, r.pubKey))),
  };
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  const rand = randomBytes(4 * out.length);
  const view = new DataView(rand.buffer, rand.byteOffset, rand.byteLength);
  for (let i = out.length - 1; i > 0; i--) {
    const j = view.getUint32(4 * i, false) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

  // v2 wraps are anonymous, so try each; a v1 wrap names its recipient and is
  // skipped unless it names us. The GCM tag rejects a wrong guess.
  for (const wrap of keyring.recipients) {
    if (wrap.recipientPubKey !== undefined && wrap.recipientPubKey !== myPub) continue;
    try {
      return unwrapContentKey(wrap, recipientPrivKeyHex);
    } catch {
      // Not ours.
    }
  }
  return null;
}
