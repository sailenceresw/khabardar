import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { bytesToHex } from "@noble/ciphers/utils";
import * as Crypto from "expo-crypto";
import { netFetch } from "./net/transport";
import { safeJsonParse } from "./safeJson";

/**
 * Anonymous proof-of-personhood on the client.
 *
 * The registry gates corroboration on a Semaphore group: a member proves they
 * belong without revealing which member. This module is the app's half of that
 * — holding the identity secret, fetching the proving artifacts, and driving
 * the native prover.
 *
 * ## The secret is the whole thing
 *
 * A Semaphore identity is one scalar. Whoever holds it *is* that member, and
 * losing it means losing the enrolment permanently — there is no recovery,
 * because the accrediting body only ever saw a hash of it. It therefore lives
 * in the same hardware-backed storage as the reporter's signing key, and panic
 * delete takes it.
 *
 * ## What proving does and does not hide
 *
 * The proof hides *which member* signalled. It does nothing about the address
 * that submits the resulting transaction, or the IP that submits it. Anonymity
 * needs all three: the proof, a fresh sponsored account, and the anonymising
 * transport. Any one alone leaks, and the one people forget is the second.
 */

const IDENTITY_KEY = "khabardar.personhood.identity.v1";
const ENROLMENT_KEY = "khabardar.personhood.enrolment.v1";

/** Semaphore tree depth the group is configured for. */
export const DEFAULT_TREE_DEPTH = 16;

export interface Enrolment {
  /** The public commitment given to the accrediting body. Not secret. */
  commitment: string;
  /** When this device enrolled, for showing the user. */
  enrolledAt: number;
  /** Set once a proof has been redeemed on-chain. */
  provedAt?: number;
}

export type PersonhoodState =
  /** No identity generated — this device has never asked to be accredited. */
  | "none"
  /** Identity exists and a commitment can be shown to an accrediting body. */
  | "awaiting-accreditation"
  /** Enrolled and a proof has been redeemed; corroboration is available. */
  | "verified";

export class ProvingUnavailable extends Error {
  constructor() {
    super("This build cannot generate proofs.");
    this.name = "ProvingUnavailable";
  }
}

// Same platform-aware path the reporter key uses: Keychain/Keystore on native,
// localStorage on web (dev preview only, and the web gate says so).
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

/**
 * The Semaphore identity secret, generated once and kept.
 *
 * Generated independently rather than derived from the reporter's BIP-39
 * phrase, deliberately: deriving both from one seed would mean a leaked
 * recovery phrase exposes not only the reports but the accredited identity
 * behind them, turning one compromise into two.
 */
export async function getOrCreateIdentitySecret(): Promise<string> {
  const existing = await secureGet(IDENTITY_KEY);
  if (existing) return existing;

  const secret = bytesToHex(Crypto.getRandomBytes(32));
  await secureSet(IDENTITY_KEY, secret);
  return secret;
}

/** True when this device holds an identity, without returning the secret. */
export async function hasIdentity(): Promise<boolean> {
  return !!(await secureGet(IDENTITY_KEY));
}

export async function getEnrolment(): Promise<Enrolment | null> {
  return safeJsonParse<Enrolment>(await AsyncStorage.getItem(ENROLMENT_KEY));
}

export async function saveEnrolment(enrolment: Enrolment): Promise<void> {
  await AsyncStorage.setItem(ENROLMENT_KEY, JSON.stringify(enrolment));
}

export async function personhoodState(): Promise<PersonhoodState> {
  const enrolment = await getEnrolment();
  if (!enrolment) return "none";
  return enrolment.provedAt ? "verified" : "awaiting-accreditation";
}

/**
 * Fetch a proving artifact through the app's transport.
 *
 * Never global `fetch`. Downloading a Semaphore proving key announces that this
 * IP is about to produce a proof — a stronger signal than ordinary traffic,
 * because only someone *about to act* fetches one. Routing it here means an
 * anonymising transport covers it and the fail-closed switch can refuse it.
 */
export async function fetchArtifact(url: string): Promise<Uint8Array> {
  const response = await netFetch(url, undefined, "personhood:artifact");
  if (!response.ok) {
    throw new Error(`Artifact download failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Wiped by panic delete.
 *
 * Note this is irreversible in a way the reporter key is not: the accrediting
 * body only ever saw a hash of this secret, so there is no recovery path and
 * re-enrolment means going back to a human. That is the correct trade — an
 * accredited credential on a seized device is worse than a lost one.
 */
export async function clearPersonhood(): Promise<void> {
  await secureDelete(IDENTITY_KEY);
  await AsyncStorage.removeItem(ENROLMENT_KEY);
}
