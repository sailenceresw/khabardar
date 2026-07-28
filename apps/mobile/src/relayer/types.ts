export interface SubmitReportParams {
  reportHash: `0x${string}`;
  category: number;
  /** ascii geohash prefix, will be right-padded to bytes32 */
  coarseGeohash: string;
  /** device-bound key that signs the operation */
  privateKey: `0x${string}`;
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
