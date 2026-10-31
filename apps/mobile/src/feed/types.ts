import type { ReportCategory, VerificationTier, Visibility } from "@khabardar/shared";

/** One report row as it exists on-chain, before content is fetched. */
export interface ChainReportRow {
  onChainReportId: number;
  reportHash: string;
  cid: string;
  category: ReportCategory;
  visibility: Visibility;
  tier: VerificationTier;
  coarseGeohash: string;
  /** Blinded entity tag; zero tag when the reporter named no entity. */
  entityTag?: string;
  timestamp: number;
  reporter: string;
  corroborations: number;
  /** Set only on clearly-labelled sample rows. */
  demo?: boolean;
  /** Sample rows carry their text inline instead of via the content layer. */
  demoBody?: string;
}

export interface FeedQuery {
  category?: ReportCategory;
  /** Coarse geohash prefix to filter by, e.g. "tsj9". */
  region?: string;
  tier?: VerificationTier;
  /** Only reports at or after this epoch-ms timestamp. */
  since?: number;
  /** Only reports at or before this epoch-ms timestamp. */
  until?: number;
  /** Cluster of reports naming the same accused entity. */
  entityTag?: string;
  /** Maximum rows to return. Indexes scan newest-first, so a low limit is cheap. */
  limit?: number;
  /** Opaque pagination cursor; only the indexer-backed source uses it. */
  cursor?: string;
}

/**
 * Read side of the network. In production this is an indexer over
 * ReportSubmitted events; reading every log directly from an RPC does not
 * scale past a few thousand reports.
 */
export interface NetworkIndex {
  readonly name: string;
  list(query?: FeedQuery): Promise<ChainReportRow[]>;
  get(onChainReportId: number): Promise<ChainReportRow | null>;
}
