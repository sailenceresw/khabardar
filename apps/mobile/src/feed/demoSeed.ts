import { ReportCategory, VerificationTier, Visibility } from "@khabardar/shared";
import type { ChainReportRow } from "./types";

/**
 * Clearly-labelled sample rows so the feed is not empty on a fresh install.
 *
 * These are FICTIONAL and deliberately generic: no real person, office,
 * scheme, or place is named. They exist to show the shape of the feed, and
 * every one is flagged `demo` so the UI can badge it as a sample rather than
 * pass it off as a real allegation. Delete this module before any real
 * deployment — fabricated corruption reports presented as genuine would be
 * both defamatory and corrosive to the platform's whole purpose.
 */
export const DEMO_ROWS: ChainReportRow[] = [
  {
    onChainReportId: 9001,
    reportHash: "0x" + "11".repeat(32),
    cid: "bafydemo0000000000000000000000000000000000000000000001",
    category: ReportCategory.Bribery,
    visibility: Visibility.Public,
    tier: VerificationTier.CommunityCorroborated,
    coarseGeohash: "tsj9",
    timestamp: Date.now() - 1000 * 60 * 60 * 30,
    reporter: "0x1111111111111111111111111111111111111111",
    corroborations: 4,
    demo: true,
    demoBody:
      "A clerk at a sub-registrar office asked for an additional cash payment on top of the official fee before releasing a routine land record. No receipt was offered for the extra amount.",
  },
  {
    onChainReportId: 9002,
    reportHash: "0x" + "22".repeat(32),
    cid: "bafydemo0000000000000000000000000000000000000000000002",
    category: ReportCategory.ProcurementFraud,
    visibility: Visibility.Public,
    tier: VerificationTier.Verified,
    coarseGeohash: "tsj9",
    timestamp: Date.now() - 1000 * 60 * 60 * 52,
    reporter: "0x2222222222222222222222222222222222222222",
    corroborations: 7,
    demo: true,
    demoBody:
      "A tender for school supplies was awarded to a vendor whose quoted rates were well above two other bidders. The evaluation sheet was not published as required.",
  },
  {
    onChainReportId: 9003,
    reportHash: "0x" + "33".repeat(32),
    cid: "bafydemo0000000000000000000000000000000000000000000003",
    category: ReportCategory.AbuseOfPower,
    visibility: Visibility.Public,
    tier: VerificationTier.Unverified,
    coarseGeohash: "ttnf",
    timestamp: Date.now() - 1000 * 60 * 60 * 8,
    reporter: "0x3333333333333333333333333333333333333333",
    corroborations: 1,
    demo: true,
    demoBody:
      "A local official threatened to withhold a residency certificate unless the applicant withdrew an unrelated complaint filed earlier that month.",
  },
  {
    onChainReportId: 9004,
    reportHash: "0x" + "44".repeat(32),
    cid: "bafydemo0000000000000000000000000000000000000000000004",
    category: ReportCategory.Embezzlement,
    visibility: Visibility.JournalistsOnly,
    tier: VerificationTier.Unverified,
    coarseGeohash: "ttnf",
    timestamp: Date.now() - 1000 * 60 * 60 * 3,
    reporter: "0x4444444444444444444444444444444444444444",
    corroborations: 0,
    demo: true,
    // No demoBody: restricted reports stay locked in the feed by design.
  },
];
