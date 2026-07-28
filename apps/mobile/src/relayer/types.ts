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
   * Whoever is authorised to sign — the device key by default, or a connected
   * external wallet if the user opted into one.
   */
  signer: ReportSigner;
}

export interface RelayResult {
  txHash: string;
  onChainReportId: number;
  explorerUrl: string;
  simulated: boolean;
}

export interface GaslessRelayer {
  readonly name: string;
  submitReport(params: SubmitReportParams): Promise<RelayResult>;
}
