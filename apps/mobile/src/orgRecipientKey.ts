import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";
import { availableRecipients, fingerprintOf, type Recipient } from "./content/recipients";

/**
 * The recipient private key an organisation uses to open restricted reports.
 *
 * A restricted report's content key is wrapped to each recipient pinned in the
 * app (see content/recipients.ts). An organisation that holds the private half
 * of one of those keys can open those reports, and nobody else can.
 *
 * Three rules keep this from becoming a way around the pinning:
 *
 *  1. A key is only accepted if its public half matches a recipient this build
 *     offers. A key for anyone else could not open anything anyway, and
 *     storing it would only invite confusion about who can read what.
 *  2. The key stays on this device. It is never sent anywhere, so decryption
 *     happens here and the screen says so.
 *  3. It goes when the organisation signs out, and panic delete signs out.
 */

const STORE_NAME = "khabardar.org.recipientkey.v1";

/**
 * The demo newsroom's private key. Its public key is pinned in
 * `DEMO_RECIPIENTS`, which are only offered when EXPO_PUBLIC_DEMO_RECIPIENTS
 * is on. The key is the number 2 on purpose: it is public knowledge, so
 * anything sealed to the demo newsroom is readable by anyone, and that is
 * exactly what the demo recipients are documented to be.
 */
export const DEMO_NEWSROOM_PRIVATE_KEY = "0000000000000000000000000000000000000000000000000000000000000002";

export interface OrgRecipientKey {
  privKeyHex: string;
  recipient: Recipient;
  /** Short fingerprint of the public key, for the organisation to compare out of band. */
  fingerprint: string;
}

/** Normalise and validate a hex private key: 64 hex characters, optional 0x, a valid secp256k1 scalar. */
function normalise(input: string): string | null {
  const hex = input.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return secp256k1.utils.isValidPrivateKey(hexToBytes(hex)) ? hex : null;
}

/**
 * Which recipient a private key belongs to, among those this build offers.
 * Null for a malformed key or one that matches no pinned recipient.
 */
export function matchRecipientKey(
  input: string,
  recipients: readonly Recipient[] = availableRecipients()
): OrgRecipientKey | null {
  const privKeyHex = normalise(input);
  if (!privKeyHex) return null;
  const pubKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(privKeyHex), true));
  const recipient = recipients.find((r) => r.pubKey.toLowerCase() === pubKey);
  return recipient ? { privKeyHex, recipient, fingerprint: fingerprintOf(recipient.pubKey) } : null;
}

export class RecipientKeyNotRecognised extends Error {
  constructor() {
    super("This key does not match any recipient pinned in this version of the app.");
    this.name = "RecipientKeyNotRecognised";
  }
}

const isWeb = () => Platform.OS === "web";

export async function saveOrgRecipientKey(input: string): Promise<OrgRecipientKey> {
  const match = matchRecipientKey(input);
  if (!match) throw new RecipientKeyNotRecognised();
  if (isWeb()) await AsyncStorage.setItem(STORE_NAME, match.privKeyHex);
  else await SecureStore.setItemAsync(STORE_NAME, match.privKeyHex);
  return match;
}

/**
 * The stored key, re-checked against the current pins. A key whose recipient
 * is no longer offered (demo recipients switched off, or a pin rotated) is
 * treated as absent rather than used.
 */
export async function loadOrgRecipientKey(): Promise<OrgRecipientKey | null> {
  const stored = isWeb() ? await AsyncStorage.getItem(STORE_NAME) : await SecureStore.getItemAsync(STORE_NAME);
  return stored ? matchRecipientKey(stored) : null;
}

export async function clearOrgRecipientKey(): Promise<void> {
  if (isWeb()) await AsyncStorage.removeItem(STORE_NAME);
  else await SecureStore.deleteItemAsync(STORE_NAME);
}
