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
  /** keccak256 of the canonical encrypted bundle, set at submission time. */
  reportHash?: string;
  /** On-chain anchor details, set once the gasless tx lands. */
  txHash?: string;
  onChainReportId?: number;
  anchoredAt?: number;
}

export interface ReporterIdentity {
  /** Pseudonymous EVM address derived from the device-bound keypair. */
  address: string;
  /** Human-friendly codename shown in the UI instead of the address. */
  codename: string;
  createdAt: number;
}
