export enum ReportCategory {
  Bribery = 0,
  Embezzlement = 1,
  Nepotism = 2,
  ProcurementFraud = 3,
  AbuseOfPower = 4,
  Other = 5,
}

export const REPORT_CATEGORY_KEYS: Record<ReportCategory, string> = {
  [ReportCategory.Bribery]: "category.bribery",
  [ReportCategory.Embezzlement]: "category.embezzlement",
  [ReportCategory.Nepotism]: "category.nepotism",
  [ReportCategory.ProcurementFraud]: "category.procurementFraud",
  [ReportCategory.AbuseOfPower]: "category.abuseOfPower",
  [ReportCategory.Other]: "category.other",
};

/** Who can decrypt the published bundle. Mirrors ReportRegistry.Visibility. */
export enum Visibility {
  /** Content key is published openly — anyone can read the report. */
  Public = 0,
  /** Content key is wrapped to specific journalist/NGO pubkeys only. */
  JournalistsOnly = 1,
}

export const VISIBILITY_KEYS: Record<Visibility, string> = {
  [Visibility.Public]: "visibility.public",
  [Visibility.JournalistsOnly]: "visibility.journalists",
};

/**
 * How much scrutiny a report has survived. Mirrors
 * ReportRegistry.VerificationTier. Nothing is presented as credible until it
 * has moved past Unverified.
 */
export enum VerificationTier {
  Unverified = 0,
  /** A moderator has picked this up and is actively checking it. */
  UnderReview = 1,
  CommunityCorroborated = 2,
  Verified = 3,
  Disputed = 4,
}

export const TIER_KEYS: Record<VerificationTier, string> = {
  [VerificationTier.Unverified]: "tier.unverified",
  [VerificationTier.UnderReview]: "tier.underReview",
  [VerificationTier.CommunityCorroborated]: "tier.corroborated",
  [VerificationTier.Verified]: "tier.verified",
  [VerificationTier.Disputed]: "tier.disputed",
};

/** Slug used for i18n keys and filter chips. */
export const TIER_SLUGS: Record<VerificationTier, string> = {
  [VerificationTier.Unverified]: "unverified",
  [VerificationTier.UnderReview]: "underReview",
  [VerificationTier.CommunityCorroborated]: "corroborated",
  [VerificationTier.Verified]: "verified",
  [VerificationTier.Disputed]: "disputed",
};

/** Independent corroborations before auto-promotion. Mirrors the contract. */
export const CORROBORATION_THRESHOLD = 3;

export type ReportStatus = "draft" | "submitting" | "anchored" | "failed";

export interface EvidenceItem {
  id: string;
  kind: "photo" | "document" | "audio";
  /** Local URI of the metadata-stripped, encrypted copy. Originals are never kept. */
  encryptedUri: string;
  /** SHA-256 of the encrypted blob, hex-encoded. */
  sha256: string;
  sizeBytes: number;
  addedAt: number;
  /** Content-layer pointer, set once the encrypted blob is uploaded. */
  cid?: string;
}

export interface AnonymousReport {
  id: string;
  status: ReportStatus;
  category: ReportCategory;
  /** Free-text description. Stored locally encrypted; only its hash goes on-chain. */
  body: string;
  /**
   * Coarse geohash prefix (max 4 chars ≈ city/district level).
   * Precision is capped at capture time — full coordinates are never stored.
   */
  coarseGeohash: string;
  evidence: EvidenceItem[];
  createdAt: number;
  /** Who the author chose to let read this. Defaults to Public. */
  visibility: Visibility;
  /**
   * Free-text name of the accused office/official, kept LOCAL ONLY. It is
   * hashed into `entityTag` before anything leaves the device.
   */
  entityName?: string;
  /** Blinded entity tag actually published on-chain. */
  entityTag?: string;
  /** keccak256 of the canonical encrypted bundle, set at submission time. */
  reportHash?: string;
  /** Content pointer to the uploaded encrypted bundle, set at publish time. */
  cid?: string;
  /** On-chain anchor details, set once the gasless tx lands. */
  txHash?: string;
  onChainReportId?: number;
  anchoredAt?: number;
}

/**
 * The canonical structure that gets serialized, encrypted, and uploaded to the
 * content layer. This — not the raw report — is what `reportHash` covers, so
 * anyone who can decrypt the bundle can recompute the hash and confirm the
 * on-chain anchor matches.
 */
export interface ReportBundle {
  v: 1;
  body: string;
  category: ReportCategory;
  coarseGeohash: string;
  createdAt: number;
  evidence: Array<{
    sha256: string;
    kind: EvidenceItem["kind"];
    sizeBytes: number;
    /** Where the encrypted evidence blob can be fetched. */
    cid?: string;
  }>;
}

/** A report as seen in the public feed, assembled from chain + content layer. */
export interface FeedReport {
  onChainReportId: number;
  reportHash: string;
  cid: string;
  category: ReportCategory;
  visibility: Visibility;
  tier: VerificationTier;
  coarseGeohash: string;
  /** Blinded tag; reports sharing one concern the same accused entity. */
  entityTag?: string;
  /** How many reports in total share this entity tag. */
  entityReportCount?: number;
  timestamp: number;
  /** Pseudonymous account address — never a real-world identity. */
  reporter: string;
  reporterCodename: string;
  corroborations: number;
  /** Resolved from the content layer; absent while loading or if locked. */
  body?: string;
  evidenceCount?: number;
  /** True when the bundle is JournalistsOnly and we hold no unwrapping key. */
  locked?: boolean;
  /** True for clearly-labelled sample rows shipped so the feed is not empty. */
  demo?: boolean;
  /** True once the fetched bundle's hash matched the on-chain anchor. */
  integrityVerified?: boolean;
}

export interface ReporterIdentity {
  /** Pseudonymous EVM address derived from the device-bound keypair. */
  address: string;
  /** Human-friendly codename shown in the UI instead of the address. */
  codename: string;
  createdAt: number;
  /** True when derived from a BIP-39 phrase the user can use to restore. */
  recoverable?: boolean;
}
