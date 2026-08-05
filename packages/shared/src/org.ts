/**
 * Organization accounts — the demand side of the platform, and the side that
 * pays.
 *
 * The central design rule: an Organization is NAMED and ACCOUNTABLE, while a
 * reporter is ANONYMOUS. These are not two roles on one account; they are two
 * separate account systems that must never be joined. An org has a legal
 * entity, a billing relationship, and a contact email. A reporter has a
 * device key and nothing else. Any code that lets one become the other, or
 * that stores them together, is a security bug — see apps/mobile/src/org.
 *
 * Why orgs pay and reporters never do: putting any payment, login, or identity
 * step in front of a citizen reporting corruption would both destroy anonymity
 * (payment rails are identity rails) and gut adoption. The corpus is a public
 * good; the tooling around it is the product.
 */

export enum OrgKind {
  /** Newsroom or individual investigative journalist collective. */
  Newsroom = "newsroom",
  /** Civil-society / anti-corruption NGO. */
  Ngo = "ngo",
  /** Statutory oversight body (Lokayukta, CVC, audit office). */
  Oversight = "oversight",
  /** Academic or research institution. */
  Research = "research",
  /** Funder underwriting gas or operations; may not consume data at all. */
  Sponsor = "sponsor",
}

export enum OrgPlan {
  /**
   * Free forever for nonprofit journalism and accredited watchdogs. This
   * mirrors OCCRP Aleph Pro's model and is a deliberate go-to-market choice:
   * the people with the least money produce the most credibility.
   */
  Community = "community",
  /** Paid tier for funded newsrooms and mid-size NGOs. */
  Pro = "pro",
  /** Paid tier for oversight bodies, large institutions, and API consumers. */
  Institutional = "institutional",
}

export interface OrgEntitlements {
  /** Advanced search: boolean/entity queries, saved searches. */
  advancedSearch: boolean;
  /** Bulk export of the verified corpus (CSV / JSON). */
  export: boolean;
  /** Programmatic API access with a key. */
  api: boolean;
  /** Cross-report analytics: entity clusters, trends, region heatmaps. */
  analytics: boolean;
  /** Case management on top of the moderation queue. */
  caseManagement: boolean;
  /** Seats included before per-seat pricing applies. */
  seats: number;
  /** API calls per day; 0 when api is false. */
  apiCallsPerDay: number;
}

export const PLAN_ENTITLEMENTS: Record<OrgPlan, OrgEntitlements> = {
  [OrgPlan.Community]: {
    advancedSearch: true,
    export: false,
    api: false,
    analytics: false,
    caseManagement: false,
    seats: 3,
    apiCallsPerDay: 0,
  },
  [OrgPlan.Pro]: {
    advancedSearch: true,
    export: true,
    api: true,
    analytics: true,
    caseManagement: true,
    seats: 10,
    apiCallsPerDay: 5_000,
  },
  [OrgPlan.Institutional]: {
    advancedSearch: true,
    export: true,
    api: true,
    analytics: true,
    caseManagement: true,
    seats: 50,
    apiCallsPerDay: 100_000,
  },
};

/** Indicative list price in USD per month. See BUSINESS.md for derivation. */
export const PLAN_PRICE_USD_MONTH: Record<OrgPlan, number> = {
  [OrgPlan.Community]: 0,
  [OrgPlan.Pro]: 400,
  [OrgPlan.Institutional]: 1500,
};

export interface Organization {
  id: string;
  /** Legal / public name. Unlike a reporter, this is deliberately identifying. */
  name: string;
  kind: OrgKind;
  plan: OrgPlan;
  /** Contact for billing and accreditation. Never linked to any report. */
  contactEmail: string;
  /** Country of registration — matters for jurisdiction and data requests. */
  country?: string;
  /**
   * Set once a human has checked the org is what it claims. Unverified orgs
   * get Community entitlements at most, so accreditation cannot be self-served
   * into paid analytics over a whistleblower corpus.
   */
  accredited: boolean;
  createdAt: number;
  /** Members with access to this org's paid surfaces. */
  seats?: OrgSeat[];
  /** Issued API credentials. Only a prefix and a hash are ever stored. */
  apiKeys?: ApiKeyRecord[];
  /** Billing state. Local-only in v0; a real backend owns this. */
  billing?: BillingState;
}

export enum SeatRole {
  /** Can manage seats, keys, and the billing relationship. */
  Admin = "admin",
  /** Can use every entitled surface but not change the account. */
  Member = "member",
  /**
   * Read-only, and deliberately excluded from corpus export.
   * For interns, fellows, and short-term collaborators — the people most
   * likely to be onboarded quickly and offboarded slowly.
   */
  Viewer = "viewer",
}

export interface OrgSeat {
  id: string;
  /** Work email. An org is a named entity; its members are too. */
  email: string;
  role: SeatRole;
  addedAt: number;
  /** Set when access was revoked; the row is kept so the audit trail survives. */
  revokedAt?: number;
}

export function activeSeats(org: Organization | null): OrgSeat[] {
  return (org?.seats ?? []).filter((s) => !s.revokedAt);
}

export function seatsRemaining(org: Organization | null): number {
  return Math.max(0, entitlementsFor(org).seats - activeSeats(org).length);
}

/**
 * A record of an issued API key — never the key itself.
 *
 * Only a display prefix and a hash are stored, so a stolen database yields no
 * working credentials. The full key is shown once, at creation, and cannot be
 * recovered afterwards. That is mildly annoying and entirely correct: an API
 * key over a whistleblower corpus is a standing grant of read access, and a
 * recoverable one is a permanent liability sitting in whatever holds it.
 */
export interface ApiKeyRecord {
  id: string;
  /** First few characters, for identifying the key in a list. */
  prefix: string;
  /** SHA-256 of the full key, hex. */
  hash: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export function activeApiKeys(org: Organization | null): ApiKeyRecord[] {
  return (org?.apiKeys ?? []).filter((k) => !k.revokedAt);
}

export enum BillingStatus {
  /** No paid relationship; Community entitlements. */
  None = "none",
  /** Invoice issued and unpaid. Access continues — see the grace note. */
  Pending = "pending",
  Active = "active",
  /**
   * Payment failed or lapsed. Entitlements drop to Community; the account and
   * its data are NOT deleted.
   */
  Lapsed = "lapsed",
}

export interface BillingState {
  status: BillingStatus;
  /** Indicative monthly amount in USD for the current plan. */
  amountUsdMonth: number;
  periodStart?: number;
  periodEnd?: number;
  /**
   * Days a lapsed account keeps working. Deliberately generous: a newsroom in
   * the middle of an investigation should not lose its case notes because a
   * card expired, and cutting access mid-story is a way to get someone hurt.
   */
  graceDays: number;
}

export const DEFAULT_GRACE_DAYS = 30;

export function billingFor(plan: OrgPlan): BillingState {
  return {
    status: plan === OrgPlan.Community ? BillingStatus.None : BillingStatus.Pending,
    amountUsdMonth: PLAN_PRICE_USD_MONTH[plan],
    graceDays: DEFAULT_GRACE_DAYS,
  };
}

export function entitlementsFor(org: Organization | null): OrgEntitlements {
  if (!org) return PLAN_ENTITLEMENTS[OrgPlan.Community];
  // An unaccredited org never gets more than Community, whatever it has paid.
  if (!org.accredited) return PLAN_ENTITLEMENTS[OrgPlan.Community];
  // A lapsed account past its grace period also falls back to Community.
  // Note what this does NOT do: it does not delete anything. Non-payment
  // removes capability, never data.
  if (org.billing && isPastGrace(org.billing)) return PLAN_ENTITLEMENTS[OrgPlan.Community];
  return PLAN_ENTITLEMENTS[org.plan];
}

export function isPastGrace(billing: BillingState, now = Date.now()): boolean {
  if (billing.status !== BillingStatus.Lapsed) return false;
  const graceEnds = (billing.periodEnd ?? now) + billing.graceDays * 24 * 60 * 60 * 1000;
  return now > graceEnds;
}

export const ORG_KIND_KEYS: Record<OrgKind, string> = {
  [OrgKind.Newsroom]: "org.kind.newsroom",
  [OrgKind.Ngo]: "org.kind.ngo",
  [OrgKind.Oversight]: "org.kind.oversight",
  [OrgKind.Research]: "org.kind.research",
  [OrgKind.Sponsor]: "org.kind.sponsor",
};

export const ORG_PLAN_KEYS: Record<OrgPlan, string> = {
  [OrgPlan.Community]: "org.plan.community",
  [OrgPlan.Pro]: "org.plan.pro",
  [OrgPlan.Institutional]: "org.plan.institutional",
};
