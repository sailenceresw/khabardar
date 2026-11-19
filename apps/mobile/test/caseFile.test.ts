import { describe, expect, it } from "vitest";
import { LINEA_SEPOLIA, ReportCategory, Visibility, VerificationTier, type FeedReport } from "@khabardar/shared";
import { caseFileCsv, caseFileHtml, caseFileRows, CASE_FILE_COLUMNS, type CaseFileInput } from "../src/caseFile";
import { resolveFeedReport } from "../src/feed/resolve";
import en from "../src/i18n/en.json";

/** A translator over the real English pack, so a missing key shows up as a raw key in the output. */
const t = (key: string, options: Record<string, unknown> = {}) => {
  let value: unknown = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  if (value && typeof value === "object") value = (value as Record<string, string>)[options.count === 1 ? "one" : "other"];
  if (typeof value !== "string") return key;
  return value.replace(/%\{(\w+)\}/g, (_m, name) => String(options[name] ?? ""));
};

const TX = "0x" + "ab".repeat(32);

function report(over: Partial<FeedReport> = {}): FeedReport {
  return {
    onChainReportId: 7,
    reportHash: "0x" + "11".repeat(32),
    cid: "bafyexample",
    category: ReportCategory.Bribery,
    visibility: Visibility.Public,
    tier: VerificationTier.Verified,
    coarseGeohash: "tsj9",
    timestamp: Date.UTC(2026, 10, 18, 9, 30),
    reporter: "0x00000000000000000000000000000000000000aa",
    reporterCodename: "Quiet Heron",
    corroborations: 4,
    body: "Fictional test report about a land office.",
    integrityVerified: true,
    txHash: TX,
    ...over,
  };
}

const input = (reports: FeedReport[], mode: "mock" | "live" = "live"): CaseFileInput => ({
  orgName: "Demo Newsroom (fictional)",
  reports,
  generatedAt: new Date(Date.UTC(2026, 10, 19, 12, 0)),
  chain: LINEA_SEPOLIA,
  mode,
  t,
});

describe("caseFileRows", () => {
  it("links a real transaction to the explorer", () => {
    const [row] = caseFileRows(input([report()]));
    expect(row.txStatus).toBe("on-chain");
    expect(row.explorerUrl).toBe(`https://sepolia.lineascan.build/tx/${TX}`);
    expect(row.fingerprint).toBe("0x" + "11".repeat(32));
  });

  it("labels a mock transaction as simulated and gives no link", () => {
    const [row] = caseFileRows(input([report({ txSimulated: true })]));
    expect(row.txStatus).toBe("simulated");
    expect(row.explorerUrl).toBe("");
  });

  it("says the transaction is unknown when the source did not give one", () => {
    const [row] = caseFileRows(input([report({ txHash: undefined })]));
    expect(row.txStatus).toBe("unknown");
  });

  it("leaves out locked and sample reports, like the corpus export", () => {
    const rows = caseFileRows(input([report(), report({ onChainReportId: 8, locked: true, body: undefined }), report({ onChainReportId: 9, demo: true })]));
    expect(rows.map((r) => r.reportId)).toEqual([7]);
  });

  it("marks a restricted report that was decrypted on this device", () => {
    expect(caseFileRows(input([report({ decryptedLocally: true })]))[0].decryptedOnThisDevice).toBe(true);
  });
});

describe("caseFileCsv", () => {
  it("has a header and one row per exportable report", () => {
    const lines = caseFileCsv(input([report(), report({ onChainReportId: 8 })])).split("\n");
    expect(lines[0]).toBe(CASE_FILE_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
  });

  it("never includes the reporter address or codename", () => {
    const csv = caseFileCsv(input([report()]));
    expect(csv).not.toContain("00000000000000000000000000000000000000aa");
    expect(csv).not.toContain("Quiet Heron");
  });

  it("quotes commas and quotes, and neutralises spreadsheet formulas", () => {
    const csv = caseFileCsv(input([report({ body: '=HYPERLINK("http://evil"), said "pay"' })]));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil""), said ""pay"""`);
  });
});

describe("caseFileHtml", () => {
  it("escapes report text so a report cannot inject markup", () => {
    const html = caseFileHtml(input([report({ body: '<script>alert("x")</script>' })]));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the fingerprint, content address, explorer link and verification steps", () => {
    const html = caseFileHtml(input([report()]));
    expect(html).toContain("0x" + "11".repeat(32));
    expect(html).toContain("bafyexample");
    expect(html).toContain(`href="https://sepolia.lineascan.build/tx/${TX}"`);
    expect(html).toContain(t("caseFile.verifyStep3"));
    expect(html).toContain("Linea Sepolia (59141)");
  });

  it("uses only translated strings, so no raw caseFile key reaches the page", () => {
    const html = caseFileHtml(input([report({ decryptedLocally: true }), report({ onChainReportId: 8, txSimulated: true }), report({ onChainReportId: 9, txHash: undefined })]));
    expect(html).not.toMatch(/caseFile\.\w+/);
  });

  it("says plainly in mock mode that the file is not evidence, and only then", () => {
    expect(caseFileHtml(input([report()], "mock"))).toContain(t("caseFile.mockMode"));
    expect(caseFileHtml(input([report()], "live"))).not.toContain(t("caseFile.mockMode"));
  });

  it("keeps Devanagari text intact", () => {
    const html = caseFileHtml(input([report({ body: "कार्यालयमा घूस माग्ने गरिएको छ।" })]));
    expect(html).toContain("कार्यालयमा घूस माग्ने गरिएको छ।");
    expect(html).toContain('<meta charset="utf-8">');
  });
});

describe("transaction hash through resolve", () => {
  it("carries the hash and the simulated flag from the chain row", async () => {
    const r = await resolveFeedReport({
      onChainReportId: 1,
      reportHash: "0x",
      cid: "",
      category: 0,
      visibility: 0,
      tier: 0,
      coarseGeohash: "",
      timestamp: 0,
      reporter: "0x01",
      corroborations: 0,
      demo: true,
      demoBody: "sample",
      txHash: TX,
      txSimulated: true,
    });
    expect(r.txHash).toBe(TX);
    expect(r.txSimulated).toBe(true);
  });
});
