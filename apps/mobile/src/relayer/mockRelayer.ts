import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIVE_CHAIN } from "@khabardar/shared";
import { encodeSubmitReportCall } from "./encoding";
import type { GaslessRelayer, RelayResult, SubmitReportParams } from "./types";

let mockReportCounter = 0;

/**
 * Simulates the full gasless path locally with no network access. It performs
 * the same encoding and signing steps as the real relayer — builds calldata,
 * signs a digest with the device key — then fabricates a plausible tx hash
 * instead of broadcasting. Active whenever EXPO_PUBLIC_GASLESS_PROVIDER is
 * unset or "mock".
 */
export class MockRelayer implements GaslessRelayer {
  readonly name = "mock";

  async submitReport(params: SubmitReportParams): Promise<RelayResult> {
    const account = privateKeyToAccount(params.privateKey);

    const calldata = encodeSubmitReportCall(
      params.reportHash,
      params.category,
      params.coarseGeohash
    );

    // Sign the calldata digest exactly as a real flow would sign a userOpHash,
    // proving the device key is present and working end to end.
    const signature = await account.signMessage({
      message: { raw: keccak256(calldata) },
    });

    await new Promise((r) => setTimeout(r, 1500)); // simulate bundler latency

    const txHash = keccak256(toBytes(`${signature}:${Date.now()}`));
    const onChainReportId = mockReportCounter++;

    return {
      txHash,
      onChainReportId,
      explorerUrl: `${ACTIVE_CHAIN.explorerUrl}/tx/${txHash}`,
      simulated: true,
    };
  }
}
