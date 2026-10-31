import AsyncStorage from "@react-native-async-storage/async-storage";
import { bytesToHex } from "@noble/ciphers/utils";
import { sha256 } from "@noble/hashes/sha256";
import * as Crypto from "expo-crypto";
import {
  activeApiKeys,
  activeSeats,
  billingFor,
  entitlementsFor,
  OrgKind,
  OrgPlan,
  SeatRole,
  seatsRemaining,
  type ApiKeyRecord,
  type OrgEntitlements,
  type Organization,
  type OrgSeat,
} from "@khabardar/shared";
import { utf8ToBytes } from "./cryptoUtils";
import { safeJsonParse } from "./safeJson";

/**
 * Organization account storage.
 *
 * SEPARATION RULE: nothing in this module may read or write reporter identity
 * state, and nothing in identity.ts may read org state. They use different
 * storage keys, different lifecycles, and are never returned from the same
 * function. The whole security argument of the product rests on an org account
 * (named, billed, contactable) being unjoinable to a reporter account
 * (anonymous device key).
 *
 * Practical consequence worth keeping: an org member who also wants to report
 * something should do it from a different install — and the UI says so. We
 * deliberately do NOT offer a convenient "report as yourself" shortcut, because
 * that convenience is exactly the trap that gets someone identified.
 */

const ORG_KEY = "khabardar.org.account.v1";

export async function getOrg(): Promise<Organization | null> {
  return safeJsonParse<Organization>(await AsyncStorage.getItem(ORG_KEY));
}

export async function saveOrg(org: Organization): Promise<void> {
  await AsyncStorage.setItem(ORG_KEY, JSON.stringify(org));
}

/**
 * Register an org locally. Accreditation is deliberately NOT self-served —
 * a new org starts unaccredited and therefore gets Community entitlements no
 * matter which plan it selects. Granting analytics over a whistleblower corpus
 * has to involve a human checking the org is who it says it is.
 */
export async function registerOrg(input: {
  name: string;
  kind: OrgKind;
  plan: OrgPlan;
  contactEmail: string;
  country?: string;
}): Promise<Organization> {
  const org: Organization = {
    id: `org_${Date.now()}`,
    name: input.name.trim(),
    kind: input.kind,
    plan: input.plan,
    contactEmail: input.contactEmail.trim(),
    country: input.country?.trim() || undefined,
    accredited: false,
    createdAt: Date.now(),
    // The registering contact becomes the first admin seat. An org with no
    // admin is an org nobody can offboard anyone from.
    seats: [
      {
        id: `seat_${Date.now()}`,
        email: input.contactEmail.trim(),
        role: SeatRole.Admin,
        addedAt: Date.now(),
      },
    ],
    apiKeys: [],
    billing: billingFor(input.plan),
  };
  await saveOrg(org);
  return org;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

export class SeatLimitReached extends Error {
  constructor(readonly limit: number) {
    super(`This plan includes ${limit} seats`);
    this.name = "SeatLimitReached";
  }
}

export async function addSeat(email: string, role: SeatRole): Promise<Organization | null> {
  const org = await getOrg();
  if (!org) return null;

  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return org;

  // Re-adding a revoked member reactivates their row rather than creating a
  // second one, so the seat history stays a single readable line per person.
  const seats = [...(org.seats ?? [])];
  const existing = seats.find((s) => s.email.toLowerCase() === trimmed);

  if (existing?.revokedAt === undefined && existing) return org;
  if (seatsRemaining(org) <= 0) throw new SeatLimitReached(entitlementsFor(org).seats);

  if (existing) {
    existing.revokedAt = undefined;
    existing.role = role;
  } else {
    seats.push({
      id: `seat_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      email: trimmed,
      role,
      addedAt: Date.now(),
    });
  }

  const next = { ...org, seats };
  await saveOrg(next);
  return next;
}

/**
 * Revoke a seat. The row is kept with a `revokedAt` rather than deleted:
 * "who had access to this corpus, and when" is a question an org will
 * eventually have to answer, and a deleted row cannot answer it.
 */
export async function revokeSeat(seatId: string): Promise<Organization | null> {
  const org = await getOrg();
  if (!org) return null;

  const seats = (org.seats ?? []).map((s) =>
    s.id === seatId ? { ...s, revokedAt: s.revokedAt ?? Date.now() } : s
  );

  const next = { ...org, seats };
  await saveOrg(next);
  return next;
}

export async function listSeats(): Promise<OrgSeat[]> {
  return activeSeats(await getOrg());
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

const KEY_PREFIX = "khb_";

export interface IssuedApiKey {
  record: ApiKeyRecord;
  /** The full key. Shown once and never recoverable. */
  secret: string;
}

/**
 * Issue an API key.
 *
 * The secret is returned exactly once and only its hash is stored, so a stolen
 * database yields no working credentials. That means a lost key cannot be
 * recovered, only replaced — mildly annoying, and correct: an API key over a
 * whistleblower corpus is a standing grant of read access, and a recoverable
 * one is a permanent liability sitting in whatever holds it.
 */
export async function issueApiKey(label: string): Promise<IssuedApiKey | null> {
  const org = await getOrg();
  if (!org) return null;
  if (!entitlementsFor(org).api) throw new Error("This plan does not include API access");

  const secret = `${KEY_PREFIX}${bytesToHex(Crypto.getRandomBytes(24))}`;
  const record: ApiKeyRecord = {
    id: `key_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    prefix: secret.slice(0, KEY_PREFIX.length + 6),
    hash: bytesToHex(sha256(utf8ToBytes(secret))),
    label: label.trim() || "API key",
    createdAt: Date.now(),
  };

  await saveOrg({ ...org, apiKeys: [record, ...(org.apiKeys ?? [])] });
  return { record, secret };
}

export async function revokeApiKey(keyId: string): Promise<Organization | null> {
  const org = await getOrg();
  if (!org) return null;

  const apiKeys = (org.apiKeys ?? []).map((k) =>
    k.id === keyId ? { ...k, revokedAt: k.revokedAt ?? Date.now() } : k
  );

  const next = { ...org, apiKeys };
  await saveOrg(next);
  return next;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  return activeApiKeys(await getOrg());
}

/**
 * Verify a presented key against the stored hashes.
 *
 * Lives here so the check is written once, but note that on a real deployment
 * this belongs on the server that serves the API — a client-side check protects
 * nothing, because the client is the thing being authenticated.
 */
export async function verifyApiKey(secret: string): Promise<ApiKeyRecord | null> {
  const hash = bytesToHex(sha256(utf8ToBytes(secret)));
  return activeApiKeys(await getOrg()).find((k) => k.hash === hash) ?? null;
}

export async function getEntitlements(): Promise<OrgEntitlements> {
  return entitlementsFor(await getOrg());
}

export async function signOutOrg(): Promise<void> {
  await AsyncStorage.removeItem(ORG_KEY);
}

/**
 * Dev affordance mirroring moderation's moderator toggle: flips the local
 * accreditation flag so paid surfaces are explorable without a billing
 * backend. Grants nothing on a real deployment, where accreditation lives
 * server-side alongside the billing relationship.
 */
export async function devSetAccredited(accredited: boolean): Promise<void> {
  const org = await getOrg();
  if (!org) return;
  await saveOrg({ ...org, accredited });
}
