import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { sha256 } from "@noble/hashes/sha256";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { bytesToHex } from "@noble/ciphers/utils";
import * as Crypto from "expo-crypto";
import { utf8ToBytes } from "./cryptoUtils";
import { safeJsonParse } from "./safeJson";

/**
 * Stealth mode: making the app survive someone else holding the phone.
 *
 * Every other protection in this project assumes the adversary is on the
 * network. This one assumes they are in the room. That is not a hypothetical
 * for an anti-corruption reporter — phone seizure at a checkpoint, a police
 * station, or a workplace is the ordinary case, and against it, encryption at
 * rest is worth exactly as much as the user's ability to refuse to unlock.
 *
 * Which they usually cannot. So the design goal is not "resist a search" but
 * "survive a compelled unlock":
 *
 *  - **A recognisable anti-corruption app is itself evidence against its user.**
 *    Before anything is decrypted, the icon and the first screen are already
 *    incriminating. Hence {@link DisguiseMode}.
 *  - **A duress PIN gives a compliant-looking answer.** Someone forced to
 *    unlock can enter a PIN that opens a working, empty app while irreversibly
 *    wiping the real data. Compliance is the only safe-looking behaviour when
 *    refusal is dangerous, so the tool has to make compliance safe.
 *  - **Screenshots and the app switcher leak.** Both OSes snapshot the current
 *    screen; a snapshot of a report is as good as the report.
 *
 * ## What this cannot do, stated plainly
 *
 * A duress wipe is not deniable against a forensic image taken *before* the
 * wipe, and it cannot recover data the adversary already copied. It defends
 * against a phone taken and unlocked, not against a phone already imaged. It
 * also cannot help if the user is watched while entering the PIN. Nothing here
 * makes it safe to carry this app into a search — it makes it survivable.
 */

const CONFIG_KEY = "khabardar.stealth.config.v1";
const REAL_PIN_KEY = "khabardar.stealth.pin.v1";
const DURESS_PIN_KEY = "khabardar.stealth.duress.v1";

/** What the app looks like before it is unlocked. */
export enum DisguiseMode {
  /** No disguise: the lock screen says Khabardar. Honest, and identifying. */
  None = "none",
  /** A working calculator. Entering a PIN and pressing = unlocks. */
  Calculator = "calculator",
  /** A generic notes app. */
  Notes = "notes",
}

export interface StealthConfig {
  /** PIN lock on launch. Off by default — it is a real usability cost. */
  lockEnabled: boolean;
  disguise: DisguiseMode;
  /** Block screenshots and hide the app-switcher preview. */
  blockScreenCapture: boolean;
  /** Whether a duress PIN has been set. Never stores the PIN itself. */
  duressConfigured: boolean;
}

export const DEFAULT_STEALTH: StealthConfig = {
  lockEnabled: false,
  disguise: DisguiseMode.None,
  blockScreenCapture: true,
  duressConfigured: false,
};

export async function getStealthConfig(): Promise<StealthConfig> {
  const stored = safeJsonParse<Partial<StealthConfig>>(await AsyncStorage.getItem(CONFIG_KEY));
  return { ...DEFAULT_STEALTH, ...(stored ?? {}) };
}

export async function saveStealthConfig(patch: Partial<StealthConfig>): Promise<StealthConfig> {
  const next = { ...(await getStealthConfig()), ...patch };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

// ---------------------------------------------------------------------------
// PIN storage
// ---------------------------------------------------------------------------

/**
 * PBKDF2 rounds for PIN hashing.
 *
 * A PIN has almost no entropy — a 6-digit PIN is a million guesses, which is
 * nothing against an offline attack on a forensic image. Stretching cannot fix
 * that; it can only make each guess cost something. 200k rounds puts a full
 * 6-digit sweep in the hours rather than the seconds, which is the difference
 * between "trivially recovered" and "needs a deliberate effort".
 *
 * The honest framing: the PIN protects against someone picking up an unlocked
 * phone, not against a lab. The data's real protection is the OS keystore.
 */
const PIN_ROUNDS = 200_000;
const SALT_KEY = "khabardar.stealth.salt.v1";

async function pinSalt(): Promise<Uint8Array> {
  const existing = await secureGet(SALT_KEY);
  if (existing) return Uint8Array.from(existing.split(",").map(Number));

  const salt = Crypto.getRandomBytes(16);
  await secureSet(SALT_KEY, Array.from(salt).join(","));
  return salt;
}

async function hashPin(pin: string): Promise<string> {
  const salt = await pinSalt();
  return bytesToHex(pbkdf2(sha256, utf8ToBytes(pin), salt, { c: PIN_ROUNDS, dkLen: 32 }));
}

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

export async function setUnlockPin(pin: string): Promise<void> {
  requireUsablePin(pin);
  await secureSet(REAL_PIN_KEY, await hashPin(pin));
  await saveStealthConfig({ lockEnabled: true });
}

/**
 * Set the PIN that wipes everything.
 *
 * Rejected if it matches the real PIN, for the obvious reason, and if it is a
 * near-miss of it — a duress PIN one digit away from the real one will be
 * entered by accident under stress, and the cost of that mistake is every
 * draft the user had.
 */
export async function setDuressPin(pin: string): Promise<void> {
  requireUsablePin(pin);

  const real = await secureGet(REAL_PIN_KEY);
  if (real && (await hashPin(pin)) === real) {
    throw new StealthPinRejected("duress-matches-real");
  }
  await secureSet(DURESS_PIN_KEY, await hashPin(pin));
  await saveStealthConfig({ duressConfigured: true });
}

export class StealthPinRejected extends Error {
  constructor(readonly code: "too-short" | "too-simple" | "duress-matches-real") {
    super(code);
    this.name = "StealthPinRejected";
  }
}

export const MIN_PIN_LENGTH = 6;

function requireUsablePin(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) throw new StealthPinRejected("too-short");
  // A repeated digit or a straight run is the first thing anyone tries.
  if (/^(\d)\1+$/.test(pin)) throw new StealthPinRejected("too-simple");
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) {
    throw new StealthPinRejected("too-simple");
  }
}

export type UnlockOutcome = "unlocked" | "duress" | "rejected";

/**
 * Classify an entered PIN. Performs no wipe itself — the caller runs
 * `panicDelete()` on "duress", which keeps the wipe in one place and avoids an
 * import cycle with `panic.ts`.
 *
 * On "duress" the UI must then show the ordinary empty app: no error, no
 * confirmation, no "data erased" message. The entire value of the feature is
 * that what an observer sees is indistinguishable from a genuine first launch.
 * A success toast would defeat it completely.
 */
export async function attemptUnlock(pin: string): Promise<UnlockOutcome> {
  const entered = await hashPin(pin);

  const duress = await secureGet(DURESS_PIN_KEY);
  if (duress && entered === duress) return "duress";

  const real = await secureGet(REAL_PIN_KEY);
  if (real && entered === real) return "unlocked";

  return "rejected";
}

export async function isLockConfigured(): Promise<boolean> {
  return !!(await secureGet(REAL_PIN_KEY));
}

/** Remove every stealth secret. Called by the duress wipe and by panic delete. */
export async function clearStealth(): Promise<void> {
  await Promise.all([
    secureDelete(REAL_PIN_KEY),
    secureDelete(DURESS_PIN_KEY),
    secureDelete(SALT_KEY),
  ]);
  await AsyncStorage.removeItem(CONFIG_KEY);
}
