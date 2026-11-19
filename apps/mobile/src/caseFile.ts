import { REPORT_CATEGORY_KEYS, TIER_SLUGS, VerificationTier, type ChainConfig, type FeedReport } from "@khabardar/shared";
import { exportableReports } from "./export";

/*
 * A case file: the reports an investigator selected, each with what someone
 * else needs to check the report has not changed since it was anchored.
 *
 * Two outputs from the same rows:
 *  - CSV, for spreadsheets.
 *  - A self-contained HTML document that prints to PDF from any browser. HTML
 *    rather than a generated PDF so Nepali and other scripts render with the
 *    system's fonts instead of needing an embedded one.
 *
 * Rules carried over from the corpus export (src/export.ts): only reports this
 * device can read are included, sample rows are left out, and the reporter
 * address never appears.
 */

export interface CaseFileInput {
  orgName: string;
  reports: FeedReport[];
  generatedAt: Date;
  chain: ChainConfig;
  /** In mock mode the file says so, so nobody reads it as on-chain evidence. */
  mode: "mock" | "live";
  /** Translator, passed in so this module stays free of the i18n runtime. */
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface CaseFileRow {
  reportId: number;
  category: string;
  tier: string;
  area: string;
  submittedAt: string;
  corroborations: number;
  /** keccak256 of the encrypted bundle, as anchored on chain. */
  fingerprint: string;
  cid: string;
  txHash: string;
  /** Explorer link, only for a real transaction. */
  explorerUrl: string;
  /** "simulated" when the transaction came from the mock relayer. */
  txStatus: "on-chain" | "simulated" | "unknown";
  integrityVerified: boolean;
  decryptedOnThisDevice: boolean;
  body: string;
}

export function caseFileRows(input: CaseFileInput): CaseFileRow[] {
  return exportableReports(input.reports).map((r) => {
    const txStatus: CaseFileRow["txStatus"] = !r.txHash ? "unknown" : r.txSimulated ? "simulated" : "on-chain";
    return {
      reportId: r.onChainReportId,
      category: input.t(REPORT_CATEGORY_KEYS[r.category]),
      tier: TIER_SLUGS[r.tier as VerificationTier] ?? "unknown",
      area: r.coarseGeohash,
      submittedAt: new Date(r.timestamp).toISOString(),
      corroborations: r.corroborations,
      fingerprint: r.reportHash,
      cid: r.cid,
      txHash: r.txHash ?? "",
      explorerUrl: txStatus === "on-chain" ? `${input.chain.explorerUrl}/tx/${r.txHash}` : "",
      txStatus,
      integrityVerified: !!r.integrityVerified,
      decryptedOnThisDevice: !!r.decryptedLocally,
      body: r.body ?? "",
    };
  });
}

export const CASE_FILE_COLUMNS: Array<keyof CaseFileRow> = [
  "reportId",
  "category",
  "tier",
  "area",
  "submittedAt",
  "corroborations",
  "fingerprint",
  "cid",
  "txHash",
  "txStatus",
  "explorerUrl",
  "integrityVerified",
  "decryptedOnThisDevice",
  "body",
];

function csvCell(value: unknown): string {
  const s = String(value);
  // A leading =, +, - or @ makes spreadsheet software run the cell as a
  // formula. Report text is written by strangers, so it is neutralised.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function caseFileCsv(input: CaseFileInput): string {
  const rows = caseFileRows(input);
  return [CASE_FILE_COLUMNS.join(","), ...rows.map((r) => CASE_FILE_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function caseFileHtml(input: CaseFileInput): string {
  const { t } = input;
  const rows = caseFileRows(input);
  const esc = escapeHtml;

  const tx = (r: CaseFileRow) =>
    r.txStatus === "on-chain"
      ? `<a href="${esc(r.explorerUrl)}">${esc(r.txHash)}</a>`
      : r.txStatus === "simulated"
        ? `${esc(r.txHash)} <em>(${esc(t("caseFile.simulated"))})</em>`
        : `<em>${esc(t("caseFile.txUnknown"))}</em>`;

  const reports = rows
    .map(
      (r) => `
<section class="report">
  <h2>${esc(t("caseFile.reportHeading", { id: r.reportId }))}: ${esc(r.category)}</h2>
  <p class="body">${esc(r.body).replace(/\n/g, "<br>")}</p>
  <table>
    <tr><th>${esc(t("caseFile.submitted"))}</th><td>${esc(r.submittedAt)}</td></tr>
    <tr><th>${esc(t("caseFile.area"))}</th><td>${esc(r.area || "n/a")}</td></tr>
    <tr><th>${esc(t("caseFile.tier"))}</th><td>${esc(r.tier)}</td></tr>
    <tr><th>${esc(t("caseFile.corroborations"))}</th><td>${r.corroborations}</td></tr>
    <tr><th>${esc(t("caseFile.fingerprint"))}</th><td><code>${esc(r.fingerprint)}</code></td></tr>
    <tr><th>${esc(t("caseFile.cid"))}</th><td><code>${esc(r.cid)}</code></td></tr>
    <tr><th>${esc(t("caseFile.transaction"))}</th><td><code>${tx(r)}</code></td></tr>
    <tr><th>${esc(t("caseFile.integrity"))}</th><td>${esc(t(r.integrityVerified ? "caseFile.integrityOk" : "caseFile.integrityNo"))}</td></tr>
    ${r.decryptedOnThisDevice ? `<tr><th>${esc(t("caseFile.restricted"))}</th><td>${esc(t("caseFile.decryptedHere"))}</td></tr>` : ""}
  </table>
</section>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t("caseFile.title"))}: ${esc(input.orgName)}</title>
<style>
  body { font-family: system-ui, "Noto Sans", "Noto Sans Devanagari", sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; color: #111; line-height: 1.45; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin: 0 0 0.5rem; }
  .meta { color: #555; font-size: 0.9rem; }
  .mock { border: 2px solid #b45309; color: #92400e; padding: 0.5rem 0.75rem; border-radius: 6px; }
  .report { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin: 1rem 0; page-break-inside: avoid; }
  .body { white-space: normal; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th { text-align: left; color: #444; padding: 3px 8px 3px 0; width: 30%; vertical-align: top; }
  td { padding: 3px 0; word-break: break-all; }
  code { font-family: ui-monospace, Consolas, monospace; }
  .verify { background: #f6f6f6; padding: 1rem; border-radius: 6px; font-size: 0.9rem; }
  button { font-size: 1rem; padding: 0.5rem 1rem; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<button onclick="window.print()">${esc(t("caseFile.print"))}</button>
<h1>${esc(t("caseFile.title"))}</h1>
<p class="meta">${esc(input.orgName)} · ${esc(t("caseFile.generated"))} ${esc(input.generatedAt.toISOString())} · ${esc(input.chain.name)} (${input.chain.chainId}) · ${esc(t("caseFile.count", { count: rows.length }))}</p>
${input.mode === "mock" ? `<p class="mock"><strong>${esc(t("caseFile.mockMode"))}</strong></p>` : ""}
<div class="verify">
  <strong>${esc(t("caseFile.verifyTitle"))}</strong>
  <ol>
    <li>${esc(t("caseFile.verifyStep1"))}</li>
    <li>${esc(t("caseFile.verifyStep2"))}</li>
    <li>${esc(t("caseFile.verifyStep3"))}</li>
  </ol>
</div>
${reports}
<p class="meta">${esc(t("caseFile.footer"))}</p>
</body>
</html>
`;
}
