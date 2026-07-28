import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { privateKeyToAccount } from "viem/accounts";
import type { ReporterIdentity } from "@khabardar/shared";

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

function codenameFromAddress(address: string): string {
  const a = parseInt(address.slice(2, 6), 16) % ADJECTIVES.length;
  const b = parseInt(address.slice(6, 10), 16) % ANIMALS.length;
  const num = parseInt(address.slice(10, 13), 16) % 100;
  return `${ADJECTIVES[a]}-${ANIMALS[b]}-${num}`;
}

export async function getIdentity(): Promise<ReporterIdentity | null> {
  const meta = await secureGet(META_NAME);
  return meta ? (JSON.parse(meta) as ReporterIdentity) : null;
}

export async function createIdentity(): Promise<ReporterIdentity> {
  const existing = await getIdentity();
  if (existing) return existing;

  const entropy = Crypto.getRandomBytes(32);
  const privateKey = `0x${Array.from(entropy)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;

  const account = privateKeyToAccount(privateKey);
  const identity: ReporterIdentity = {
    address: account.address,
    codename: codenameFromAddress(account.address),
    createdAt: Date.now(),
  };

  await secureSet(KEY_NAME, privateKey);
  await secureSet(META_NAME, JSON.stringify(identity));
  return identity;
}

export async function getPrivateKey(): Promise<`0x${string}` | null> {
  const pk = await secureGet(KEY_NAME);
  return pk as `0x${string}` | null;
}

export async function destroyIdentity(): Promise<void> {
  await secureDelete(KEY_NAME);
  await secureDelete(META_NAME);
}
