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
}

export function entitlementsFor(org: Organization | null): OrgEntitlements {
  if (!org) return PLAN_ENTITLEMENTS[OrgPlan.Community];
  // An unaccredited org never gets more than Community, whatever it has paid.
  if (!org.accredited) return PLAN_ENTITLEMENTS[OrgPlan.Community];
  return PLAN_ENTITLEMENTS[org.plan];
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
