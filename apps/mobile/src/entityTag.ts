import { keccak256, toBytes } from "viem";

/**
 * Blinded entity tags — how two reporters who never meet can have their
 * reports about the same office or official shown together.
 *
 * Each report may name an accused entity ("Block Development Office,
 * Sitapur"). That string stays on the device. What is published is
 * keccak256(normalized(name) || DOMAIN_SALT), so identical entities yield
 * identical tags and clustering works, while the name itself never appears
 * on-chain.
 *
 * Honest limits of this construction:
 *  - It is NOT hiding the entity from a determined observer. The set of Indian
 *    public offices is enumerable, so anyone can precompute tags and reverse
 *    them by dictionary attack. That is an accepted trade-off: the accused is
 *    not the secret here, the reporter is, and the tag carries nothing about
 *    who filed it.
 *  - It does mean a passive observer cannot trivially scrape "every office
 *    ever accused" from chain data without doing that work first, and it keeps
 *    entity names out of JournalistsOnly reports entirely.
 *  - Normalization is deliberately aggressive so trivial spelling variance
 *    still collides. It will not catch genuinely different phrasings; real
 *    entity resolution belongs in the moderation layer, not on-chain.
 */

// Rotating this salt would break clustering with all prior reports, so it is
// fixed for the protocol version rather than per-deployment.
const DOMAIN_SALT = "khabardar/entity-tag/v1";

export const ZERO_TAG = `0x${"0".repeat(64)}` as const;

/**
 * Aggressively normalize so "Block Development Office, Sitapur" and
 * "block development office sitapur" produce the same tag.
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation -> space (Unicode-aware, keeps Devanagari)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive the on-chain tag. Returns the zero tag for an empty name, which the
 * contract treats as "no entity named" and excludes from clustering.
 */
export function entityTagFor(name: string | undefined): `0x${string}` {
  const normalized = normalizeEntityName(name ?? "");
  if (!normalized) return ZERO_TAG;
  return keccak256(toBytes(`${DOMAIN_SALT}|${normalized}`));
}

export function hasEntityTag(tag: string | undefined): boolean {
  return !!tag && tag !== ZERO_TAG;
}
