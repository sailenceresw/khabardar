import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  OrgKind,
  OrgPlan,
  entitlementsFor,
  type OrgEntitlements,
  type Organization,
} from "@khabardar/shared";
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
  };
  await saveOrg(org);
  return org;
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
