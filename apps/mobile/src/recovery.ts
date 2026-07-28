import { bytesToHex } from "viem";
import { HDKey, english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

/**
 * Identity recovery without accounts.
 *
 * Khabardar deliberately has no email/phone login: an auth provider is a
 * single subpoena away from deanonymising every reporter on the platform.
 * A BIP-39 phrase gives the same practical benefit — restore on a new device,
 * survive a lost phone — with nothing held by anyone but the user.
 *
 * Trade-off the UI must communicate honestly: anyone who reads the phrase
 * becomes the reporter. It should never be screenshotted, synced to a cloud
 * notes app, or typed into anything but this screen.
 */

export const RECOVERY_WORD_COUNT = 12;

export function newRecoveryPhrase(): string {
  return generateMnemonic(english, 128); // 128 bits => 12 words
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalizePhrase(phrase), wordlist);
}

/**
 * Derive the reporter's private key from a phrase. Uses the standard Ethereum
 * path so the same phrase always restores the same pseudonymous address — and
 * so the key stays portable to any standard wallet if this project ever dies.
 */
export function privateKeyFromPhrase(phrase: string): `0x${string}` {
  const normalized = normalizePhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("Invalid recovery phrase");
  }

  const seed = mnemonicToSeedSync(normalized);
  const hd = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!hd.privateKey) throw new Error("Could not derive key from phrase");

  return bytesToHex(hd.privateKey);
}

export function addressFromPhrase(phrase: string): string {
  return mnemonicToAccount(normalizePhrase(phrase)).address;
}
