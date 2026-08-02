import { TIER_SLUGS, VerificationTier, type FeedReport } from "@khabardar/shared";
import { getEntitlements } from "./org";

/**
 * Corpus export — the concrete thing a paid tier unlocks.
 *
 * Two deliberate constraints:
 *
 *  1. Only reports the exporter can already read are exported. Export is a
 *     convenience over public data, never a privileged view. Restricted
 *     (JournalistsOnly) bundles this device cannot open are excluded rather
 *     than exported as opaque rows, because a row of metadata about a
 *     restricted report is still a leak of its existence and shape.
 *
 *  2. The reporter address is NOT exported. It is a pseudonymous address, but
 *     exporting it into spreadsheets that get emailed around is how
 *     pseudonymity quietly becomes identity. The codename is enough to group
 *     a reporter's submissions within the corpus.
 */

export const EXPORT_COLUMNS = [
  "onChainReportId",
  "category",
  "tier",
  "region",
  "submittedAt",
  "corroborations",
  "reporterCodename",
  "reportHash",
  "cid",
  "integrityVerified",
  "body",
] as const;

export class ExportNotEntitledError extends Error {
  constructor() {
    super("Export requires an accredited Pro or Institutional organization plan");
    this.name = "ExportNotEntitledError";
  }
}

export function exportableReports(reports: FeedReport[]): FeedReport[] {
  return reports.filter((r) => !r.locked && !r.demo && r.body !== undefined);
}

export async function exportCsv(reports: FeedReport[]): Promise<string> {
  const entitlements = await getEntitlements();
  if (!entitlements.export) throw new ExportNotEntitledError();

  const rows = exportableReports(reports).map((r) => [
    String(r.onChainReportId),
    String(r.category),
    TIER_SLUGS[r.tier as VerificationTier] ?? "unknown",
    r.coarseGeohash,
    new Date(r.timestamp).toISOString(),
    String(r.corroborations),
    r.reporterCodename,
    r.reportHash,
    r.cid,
    String(!!r.integrityVerified),
    r.body ?? "",
  ]);

  return [EXPORT_COLUMNS.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
}

export async function exportJson(reports: FeedReport[]): Promise<string> {
  const entitlements = await getEntitlements();
  if (!entitlements.export) throw new ExportNotEntitledError();

  return JSON.stringify(
    exportableReports(reports).map((r) => ({
      onChainReportId: r.onChainReportId,
      category: r.category,
      tier: TIER_SLUGS[r.tier as VerificationTier] ?? "unknown",
      region: r.coarseGeohash,
      entityTag: r.entityTag,
      submittedAt: new Date(r.timestamp).toISOString(),
      corroborations: r.corroborations,
      reporterCodename: r.reporterCodename,
      reportHash: r.reportHash,
      cid: r.cid,
      integrityVerified: !!r.integrityVerified,
      body: r.body,
    })),
    null,
    2
  );
}

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}
