import type { ReportSigner } from "../signer";

export interface SubmitReportParams {
  reportHash: `0x${string}`;
  /** Content pointer to the uploaded encrypted bundle. */
  cid: string;
  category: number;
  /** 0 = Public, 1 = JournalistsOnly (see shared Visibility enum). */
  visibility: number;
  /** ascii geohash prefix, will be right-padded to bytes32 */
  coarseGeohash: string;
  /** Blinded tag for the accused entity, or the zero tag when none named. */
  entityTag: `0x${string}`;
  /**
   * Which funded pool should reimburse the paymaster. Passed to the sponsorship
   * request for accounting only — it is deliberately NOT part of the on-chain
   * calldata, so no report carries a sponsor marker.
   */
  sponsorPoolId?: string;
  /**
   * Whoever is authorised to sign — the device key by default, or a connected
   * external wallet if the user opted into one.
   */
  signer: ReportSigner;
}

export type RelayStatus = "pending" | "anchored" | "failed";

export interface RelayResult {
  /** Bundle/tx hash once included; may be the userOpHash while still pending. */
  txHash: string;
  /** ERC-4337 userOpHash — useful for receipt polling and resume. */
  userOpHash?: string;
  onChainReportId: number;
  explorerUrl: string;
  simulated: boolean;
  /** pending = submitted but not yet included; anchored = receipt seen; failed = timed out / reverted. */
  status?: RelayStatus;
}

export interface GaslessRelayer {
  readonly name: string;
  submitReport(params: SubmitReportParams): Promise<RelayResult>;
}
