import { keccak256, toBytes } from "viem";
import { ACTIVE_CHAIN } from "@khabardar/shared";
import { nextMirrorReportId } from "../feed/localChainMirror";
import { encodeSubmitReportCall } from "./encoding";
import type { GaslessRelayer, RelayResult, SubmitReportParams } from "./types";

/**
 * Simulates the full gasless path locally with no network access. It performs
 * the same encoding and signing steps as the real relayer — builds calldata,
 * signs a digest with the active signer — then fabricates a plausible tx hash
 * instead of broadcasting. Active whenever EXPO_PUBLIC_GASLESS_PROVIDER is
 * unset or "mock".
 */
export class MockRelayer implements GaslessRelayer {
  readonly name = "mock";

  async submitReport(params: SubmitReportParams): Promise<RelayResult> {
    const calldata = encodeSubmitReportCall(
      params.reportHash,
      params.cid,
      params.category,
      params.visibility,
      params.coarseGeohash,
      params.entityTag
    );

    // Sign the calldata digest exactly as a real flow would sign a userOpHash,
    // proving the active signer (device key or connected wallet) works end to end.
    const signature = await params.signer.signMessage({ raw: keccak256(calldata) });

    await new Promise((r) => setTimeout(r, 1200)); // simulate bundler latency

    const txHash = keccak256(toBytes(`${signature}:${Date.now()}`));
    // Stands in for the contract's monotonic `reportCount`. Read from the
    // persisted mirror so ids stay unique across app restarts.
    const onChainReportId = await nextMirrorReportId();

    return {
      txHash,
      onChainReportId,
      explorerUrl: `${ACTIVE_CHAIN.explorerUrl}/tx/${txHash}`,
      simulated: true,
    };
  }
}
