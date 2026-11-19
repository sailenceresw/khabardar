import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrgKind, OrgPlan, ReportCategory, Visibility, VerificationTier } from "@khabardar/shared";
import { DEMO_RECIPIENTS } from "../src/content/recipients";
import { publicKeyring, wrappedKeyring } from "../src/content/contentKeys";
import { getContentStore } from "../src/content";
import { computeReportHash, encrypt, randomKey, utf8ToBytes } from "../src/cryptoUtils";
import { resolveFeedReport } from "../src/feed/resolve";
import type { ChainReportRow } from "../src/feed/types";
import { registerOrg, signOutOrg } from "../src/org";
import {
  clearOrgRecipientKey,
  DEMO_NEWSROOM_PRIVATE_KEY,
  loadOrgRecipientKey,
  matchRecipientKey,
  RecipientKeyNotRecognised,
  saveOrgRecipientKey,
} from "../src/orgRecipientKey";
import { reactNativeStub, resetStubs } from "./stubs/native";

const DEMO_NGO_PRIVATE_KEY = "0x" + "0".repeat(63) + "3";
const UNRELATED_KEY = "1".repeat(64);

describe("matchRecipientKey", () => {
  it("recognises the demo newsroom and NGO keys among the demo recipients", () => {
    expect(matchRecipientKey(DEMO_NEWSROOM_PRIVATE_KEY, DEMO_RECIPIENTS)?.recipient.id).toBe("demo-newsroom");
    expect(matchRecipientKey(DEMO_NGO_PRIVATE_KEY, DEMO_RECIPIENTS)?.recipient.id).toBe("demo-ngo");
  });

  it("accepts a 0x prefix, upper case and surrounding spaces", () => {
    const messy = `  0X${DEMO_NEWSROOM_PRIVATE_KEY.toUpperCase()} `;
    expect(matchRecipientKey(messy, DEMO_RECIPIENTS)?.privKeyHex).toBe(DEMO_NEWSROOM_PRIVATE_KEY);
  });

  it("gives a five-block fingerprint to compare out of band", () => {
    expect(matchRecipientKey(DEMO_NEWSROOM_PRIVATE_KEY, DEMO_RECIPIENTS)?.fingerprint).toMatch(/^([0-9A-F]{4}-){4}[0-9A-F]{4}$/);
  });

  it("rejects a valid key that belongs to no pinned recipient", () => {
    expect(matchRecipientKey(UNRELATED_KEY, DEMO_RECIPIENTS)).toBeNull();
  });

  it.each([
    ["too short", "abc123"],
    ["not hex", "z".repeat(64)],
    ["zero, which is not a valid key", "0".repeat(64)],
    ["one character too long", "1".repeat(65)],
    ["empty", ""],
  ])("rejects a key that is %s", (_label, key) => {
    expect(matchRecipientKey(key, DEMO_RECIPIENTS)).toBeNull();
  });

  it("matches nothing when no recipients are offered, which is a release build without demo mode", () => {
    expect(matchRecipientKey(DEMO_NEWSROOM_PRIVATE_KEY, [])).toBeNull();
  });
});

describe("storing the key", () => {
  const saved = process.env.EXPO_PUBLIC_DEMO_RECIPIENTS;
  beforeEach(() => {
    resetStubs();
    process.env.EXPO_PUBLIC_DEMO_RECIPIENTS = "1";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_DEMO_RECIPIENTS;
    else process.env.EXPO_PUBLIC_DEMO_RECIPIENTS = saved;
  });

  it("saves, loads and clears a recognised key", async () => {
    const saved = await saveOrgRecipientKey(DEMO_NEWSROOM_PRIVATE_KEY);
    expect(saved.recipient.id).toBe("demo-newsroom");
    expect((await loadOrgRecipientKey())?.recipient.id).toBe("demo-newsroom");
    await clearOrgRecipientKey();
    expect(await loadOrgRecipientKey()).toBeNull();
  });

  it("refuses to store a key no pinned recipient matches", async () => {
    await expect(saveOrgRecipientKey(UNRELATED_KEY)).rejects.toBeInstanceOf(RecipientKeyNotRecognised);
    expect(await loadOrgRecipientKey()).toBeNull();
  });

  it("stops using a stored demo key once demo recipients are switched off", async () => {
    await saveOrgRecipientKey(DEMO_NEWSROOM_PRIVATE_KEY);
    process.env.EXPO_PUBLIC_DEMO_RECIPIENTS = "0";
    expect(await loadOrgRecipientKey()).toBeNull();
  });

  it("is removed when the organisation signs out, which panic delete does", async () => {
    await registerOrg({ name: "Demo Desk", contactEmail: "desk@example.org", kind: OrgKind.Newsroom, plan: OrgPlan.Community });
    await saveOrgRecipientKey(DEMO_NEWSROOM_PRIVATE_KEY);
    await signOutOrg();
    process.env.EXPO_PUBLIC_DEMO_RECIPIENTS = "1";
    expect(await loadOrgRecipientKey()).toBeNull();
  });
});

describe("opening a restricted report", () => {
  // The mock content store keeps bundles in files on a device, and the file
  // system stub stores nothing. On web it uses AsyncStorage, whose stub does.
  beforeEach(() => {
    resetStubs();
    reactNativeStub.Platform.OS = "web";
  });
  afterEach(() => {
    reactNativeStub.Platform.OS = "ios";
  });

  /** Seal a bundle the way submitReport does, store it, and return its chain row. */
  async function seal(keyring: "restricted" | "public") {
    const bundle = {
      v: 1 as const,
      body: "Fictional test report: the store keeper sells relief rice.",
      category: ReportCategory.Embezzlement,
      coarseGeohash: "tsj9",
      createdAt: 1_700_000_000_000,
      evidence: [],
    };
    const contentKey = randomKey();
    const blob = encrypt(utf8ToBytes(JSON.stringify(bundle)), contentKey);
    const ring =
      keyring === "restricted"
        ? wrappedKeyring(contentKey, DEMO_RECIPIENTS.map((r) => ({ id: r.id, pubKey: r.pubKey })))
        : publicKeyring(contentKey);
    const { cid } = await getContentStore().put({ v: 1, blob, keyring: ring });
    const reportHash = computeReportHash({
      encryptedBody: blob,
      evidenceSha256: [],
      category: bundle.category,
      coarseGeohash: bundle.coarseGeohash,
      createdAt: bundle.createdAt,
    });
    const row: ChainReportRow = {
      onChainReportId: 1,
      reportHash,
      cid,
      category: bundle.category,
      visibility: keyring === "restricted" ? Visibility.JournalistsOnly : Visibility.Public,
      tier: VerificationTier.Unverified,
      coarseGeohash: "tsj9",
      timestamp: bundle.createdAt,
      reporter: "0x0000000000000000000000000000000000000001",
      corroborations: 0,
    };
    return { row, body: bundle.body };
  }

  it("stays locked without a key", async () => {
    const { row } = await seal("restricted");
    const report = await resolveFeedReport(row);
    expect(report.locked).toBe(true);
    expect(report.body).toBeUndefined();
  });

  it("opens with the recipient key, marked as decrypted here, with integrity checked", async () => {
    const { row, body } = await seal("restricted");
    const report = await resolveFeedReport(row, DEMO_NEWSROOM_PRIVATE_KEY);
    expect(report.body).toBe(body);
    expect(report.decryptedLocally).toBe(true);
    expect(report.integrityVerified).toBe(true);
  });

  it("stays locked with a key it was not sealed to", async () => {
    const { row } = await seal("restricted");
    expect((await resolveFeedReport(row, UNRELATED_KEY)).locked).toBe(true);
  });

  it("does not mark a public report as decrypted here", async () => {
    const { row } = await seal("public");
    const report = await resolveFeedReport(row, DEMO_NEWSROOM_PRIVATE_KEY);
    expect(report.body).toBeDefined();
    expect(report.decryptedLocally).toBe(false);
  });
});
