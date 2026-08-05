import type { FeedReport, ReportBundle } from "@khabardar/shared";
import { Visibility } from "@khabardar/shared";
import { bytesToUtf8, computeReportHash, decrypt } from "../cryptoUtils";
import { getContentStore } from "../content";
import { resolveContentKey } from "../content/contentKeys";
import { codenameFromAddress } from "../identity";
import type { ChainReportRow } from "./types";

/**
 * Turn an on-chain row into a displayable report by fetching its encrypted
 * bundle and decrypting it — then checking that what came back actually
 * matches what was anchored.
 *
 * That last step is the point of the whole design: the content layer is
 * untrusted, so a gateway that swaps or edits a bundle must be detectable.
 * `integrityVerified` is false whenever the recomputed hash differs, and the
 * UI must not present such a report as authentic.
 */
export async function resolveFeedReport(
  row: ChainReportRow,
  recipientPrivKeyHex?: string
): Promise<FeedReport> {
  const base: FeedReport = {
    onChainReportId: row.onChainReportId,
    reportHash: row.reportHash,
    cid: row.cid,
    category: row.category,
    visibility: row.visibility,
    tier: row.tier,
    coarseGeohash: row.coarseGeohash,
    // Carried through so callers can cluster reports naming the same entity.
    // It is a blinded tag, not a name, and says nothing about who reported.
    entityTag: row.entityTag,
    timestamp: row.timestamp,
    reporter: row.reporter,
    reporterCodename: codenameFromAddress(row.reporter),
    corroborations: row.corroborations,
    demo: row.demo,
  };

  // Sample rows carry their text inline and never touch the content layer.
  if (row.demo) {
    return row.demoBody
      ? { ...base, body: row.demoBody, evidenceCount: 0, integrityVerified: false }
      : { ...base, locked: true };
  }

  const stored = await getContentStore().get(row.cid);
  if (!stored) return { ...base, locked: true };

  const contentKey = resolveContentKey(stored.keyring, recipientPrivKeyHex);
  if (!contentKey) {
    // JournalistsOnly and this device holds no matching key — expected, not an error.
    return { ...base, locked: true };
  }

  let bundle: ReportBundle;
  try {
    bundle = JSON.parse(bytesToUtf8(decrypt(stored.blob, contentKey))) as ReportBundle;
  } catch {
    return { ...base, locked: true, integrityVerified: false };
  }

  // Recompute the anchor over what we actually received.
  const recomputed = computeReportHash({
    encryptedBody: stored.blob,
    evidenceSha256: bundle.evidence.map((e) => e.sha256),
    category: bundle.category,
    coarseGeohash: bundle.coarseGeohash,
    createdAt: bundle.createdAt,
  });

  return {
    ...base,
    body: bundle.body,
    evidenceCount: bundle.evidence.length,
    integrityVerified: recomputed.toLowerCase() === row.reportHash.toLowerCase(),
  };
}

export async function resolveFeedReports(
  rows: ChainReportRow[],
  recipientPrivKeyHex?: string
): Promise<FeedReport[]> {
  return Promise.all(rows.map((r) => resolveFeedReport(r, recipientPrivKeyHex)));
}

/** True when a report should be presented as readable in the feed. */
export function isReadable(report: FeedReport): boolean {
  return !report.locked && report.body !== undefined;
}

export function isRestricted(report: FeedReport): boolean {
  return report.visibility === Visibility.JournalistsOnly;
}
