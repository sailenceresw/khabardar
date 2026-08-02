import type { AnonymousReport, EvidenceItem, ReportBundle } from "@khabardar/shared";
import { VerificationTier, Visibility } from "@khabardar/shared";
import { computeReportHash, encrypt, randomKey, utf8ToBytes } from "./cryptoUtils";
import { getContentStore } from "./content";
import { publicKeyring, wrappedKeyring } from "./content/contentKeys";
import { DEMO_RECIPIENTS } from "./content/recipients";
import type { StoredBundle } from "./content/types";
import { entityTagFor } from "./entityTag";
import { uploadAllEvidence } from "./evidence";
import { appendMirrorRow } from "./feed/localChainMirror";
import { getRelayer, type RelayResult } from "./relayer";
import { getActiveSigner } from "./signer";
import { recordSponsoredSubmission, resolveSponsor } from "./sponsorPools";

export interface PublishResult {
  reportHash: `0x${string}`;
  cid: string;
  entityTag: `0x${string}`;
  /**
   * Evidence items with their content-layer CIDs filled in. The caller must
   * persist these back onto the stored report — otherwise the uploads happen
   * but the device forgets where they went.
   */
  evidence: EvidenceItem[];
  relay: RelayResult;
  /** True when the bundle went to the local mock store, not a real network. */
  contentSimulated: boolean;
  /** Which key actually signed — "device" for the anonymous default. */
  signerKind: "device" | "wallet";
  /**
   * Sponsor to credit in the UI, or null when gas came from an unnamed or
   * too-small pool. Never tied to this report anywhere but this return value.
   */
  sponsorName: string | null;
}

/**
 * The end-to-end publish path:
 *   1. Build the canonical bundle (body + evidence fingerprints).
 *   2. Encrypt it under a fresh, per-report content key.
 *   3. Build the keyring — published openly for Public reports, wrapped to
 *      named journalists for JournalistsOnly ones.
 *   4. Upload the encrypted bundle to the content layer, yielding a CID.
 *   5. Anchor keccak256(bundle) + CID on Linea via a sponsored (gasless) tx.
 *
 * Note the hash covers the ENCRYPTED bundle, so any reader who can decrypt it
 * can recompute the hash and confirm it matches the on-chain anchor — that is
 * what makes tampering detectable after the fact.
 */
export async function publishReport(report: AnonymousReport): Promise<PublishResult> {
  const signer = await getActiveSigner();

  // 1. Push encrypted evidence blobs to the content layer first, so the bundle
  // can point at them. Their bytes were already ciphertext before this call.
  const evidence = await uploadAllEvidence(report.evidence);

  // 2. Canonical bundle. Evidence contributes its hash and pointer — never its bytes.
  const bundle: ReportBundle = {
    v: 1,
    body: report.body,
    category: report.category,
    coarseGeohash: report.coarseGeohash,
    createdAt: report.createdAt,
    evidence: evidence.map((e) => ({
      sha256: e.sha256,
      kind: e.kind,
      sizeBytes: e.sizeBytes,
      cid: e.cid,
    })),
  };

  // 3. Fresh content key per report — compromise of one never exposes another.
  const contentKey = randomKey();
  const encryptedBundle = encrypt(utf8ToBytes(JSON.stringify(bundle)), contentKey);

  // 4. Keyring decides who can ever read this.
  const keyring =
    report.visibility === Visibility.JournalistsOnly
      ? wrappedKeyring(
          contentKey,
          DEMO_RECIPIENTS.map((r) => ({ id: r.id, pubKey: r.pubKey }))
        )
      : publicKeyring(contentKey);

  const stored: StoredBundle = { v: 1, blob: encryptedBundle, keyring };

  // 5. Hash covers the encrypted bundle + its metadata.
  const reportHash = computeReportHash({
    encryptedBody: encryptedBundle,
    evidenceSha256: evidence.map((e) => e.sha256),
    category: report.category,
    coarseGeohash: report.coarseGeohash,
    createdAt: report.createdAt,
  });

  const put = await getContentStore().put(stored);

  // 6. Anchor on-chain, gas sponsored.
  // The entity name itself never leaves the device — only its blinded tag.
  const entityTag = entityTagFor(report.entityName);

  // Which funded pool covers this submission. The reporter is never asked and
  // never pays either way — this only decides who reimburses the paymaster.
  const sponsor = await resolveSponsor(report.coarseGeohash, report.category);

  const relay = await getRelayer().submitReport({
    reportHash,
    cid: put.cid,
    category: report.category,
    visibility: report.visibility,
    coarseGeohash: report.coarseGeohash,
    entityTag,
    sponsorPoolId: sponsor?.poolId,
    signer,
  });

  if (sponsor) await recordSponsoredSubmission(sponsor.poolId);

  // While the mock relayer is active there is no chain to read back from, so
  // mirror the row locally to keep the feed behaving identically.
  if (relay.simulated) {
    await appendMirrorRow({
      onChainReportId: relay.onChainReportId,
      reportHash,
      cid: put.cid,
      category: report.category,
      visibility: report.visibility,
      tier: VerificationTier.Unverified,
      coarseGeohash: report.coarseGeohash,
      entityTag,
      timestamp: Date.now(),
      reporter: signer.address,
      corroborations: 0,
    });
  }

  return {
    reportHash,
    cid: put.cid,
    entityTag,
    evidence,
    relay,
    contentSimulated: put.simulated,
    signerKind: signer.kind,
    sponsorName: sponsor?.displayName ?? null,
  };
}

/** @deprecated Use {@link publishReport}; kept so older callers keep compiling. */
export const submitReportOnChain = publishReport;
