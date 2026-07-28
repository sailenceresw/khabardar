import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { privateKeyToAccount } from "viem/accounts";
import type { ReporterIdentity } from "@khabardar/shared";
import {
  isValidRecoveryPhrase,
  newRecoveryPhrase,
  normalizePhrase,
  privateKeyFromPhrase,
} from "./recovery";
import { safeJsonParse } from "./safeJson";

// The private key never leaves the device: hardware-backed keystore on
// iOS (Keychain) / Android (Keystore). Web falls back to localStorage for
// dev preview only — the web target is not a supported production surface.
const KEY_NAME = "khabardar.identity.privkey.v1";
const META_NAME = "khabardar.identity.meta.v1";

const ADJECTIVES = [
  "silent", "swift", "steady", "hidden", "honest", "fearless",
  "vigilant", "quiet", "bright", "resolute", "watchful", "calm",
];
const ANIMALS = [
  "heron", "tiger", "sparrow", "tortoise", "mongoose", "falcon",
  "elephant", "panther", "koel", "sambar", "markhor", "ibex",
];

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") return AsyncStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}

/** Deterministic, reversible-to-nobody label for any pseudonymous address. */
export function codenameFromAddress(address: string): string {
  const a = parseInt(address.slice(2, 6), 16) % ADJECTIVES.length;
  const b = parseInt(address.slice(6, 10), 16) % ANIMALS.length;
  const num = parseInt(address.slice(10, 13), 16) % 100;
  return `${ADJECTIVES[a]}-${ANIMALS[b]}-${num}`;
}

export async function getIdentity(): Promise<ReporterIdentity | null> {
  const meta = await secureGet(META_NAME);
  return safeJsonParse<ReporterIdentity>(meta);
}

const PHRASE_NAME = "khabardar.identity.phrase.v1";

/**
 * Create a recoverable identity. The key is derived from a BIP-39 phrase so
 * the reporter can restore it on another device — see recovery.ts for why this
 * replaces a login rather than complementing one.
 */
export async function createIdentity(): Promise<ReporterIdentity> {
  const existing = await getIdentity();
  if (existing) return existing;

  const phrase = newRecoveryPhrase();
  return adoptPhrase(phrase);
}

/** Restore an identity from a phrase, replacing whatever is on this device. */
export async function restoreIdentity(phrase: string): Promise<ReporterIdentity> {
  if (!isValidRecoveryPhrase(phrase)) throw new Error("Invalid recovery phrase");
  return adoptPhrase(normalizePhrase(phrase));
}

async function adoptPhrase(phrase: string): Promise<ReporterIdentity> {
  const privateKey = privateKeyFromPhrase(phrase);
  const account = privateKeyToAccount(privateKey);

  const identity: ReporterIdentity = {
    address: account.address,
    codename: codenameFromAddress(account.address),
    createdAt: Date.now(),
    recoverable: true,
  };

  await secureSet(KEY_NAME, privateKey);
  await secureSet(PHRASE_NAME, phrase);
  await secureSet(META_NAME, JSON.stringify(identity));
  return identity;
}

/**
 * Read back the recovery phrase so the user can write it down. Kept in the
 * hardware-backed keystore alongside the key; wiped by panic delete.
 */
export async function getRecoveryPhrase(): Promise<string | null> {
  return secureGet(PHRASE_NAME);
}

export async function getPrivateKey(): Promise<`0x${string}` | null> {
  const pk = await secureGet(KEY_NAME);
  return pk as `0x${string}` | null;
}

export async function destroyIdentity(): Promise<void> {
  await secureDelete(KEY_NAME);
  await secureDelete(PHRASE_NAME);
  await secureDelete(META_NAME);
}
