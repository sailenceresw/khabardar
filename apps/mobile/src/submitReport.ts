import type { AnonymousReport } from "@khabardar/shared";
import { computeReportHash, encrypt, utf8ToBytes } from "./cryptoUtils";
import { getDraftKey } from "./drafts";
import { getPrivateKey } from "./identity";
import { getRelayer, type RelayResult } from "./relayer";

/**
 * The end-to-end slice: take a draft, produce the canonical encrypted bundle,
 * compute its keccak256 fingerprint, and anchor that fingerprint on Linea via
 * a sponsored (gasless) transaction signed by the device-bound key.
 */
export async function submitReportOnChain(report: AnonymousReport): Promise<{
  reportHash: `0x${string}`;
  relay: RelayResult;
}> {
  const privateKey = await getPrivateKey();
  if (!privateKey) throw new Error("No identity on this device");

  const key = await getDraftKey();
  const encryptedBody = encrypt(utf8ToBytes(report.body), key);

  const reportHash = computeReportHash({
    encryptedBody,
    evidenceSha256: report.evidence.map((e) => e.sha256),
    category: report.category,
    coarseGeohash: report.coarseGeohash,
    createdAt: report.createdAt,
  });

  const relay = await getRelayer().submitReport({
    reportHash,
    category: report.category,
    coarseGeohash: report.coarseGeohash,
    privateKey,
  });

  return { reportHash, relay };
}
