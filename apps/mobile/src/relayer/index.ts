import { MockRelayer } from "./mockRelayer";
import { PimlicoRelayer } from "./pimlicoRelayer";
import type { GaslessRelayer } from "./types";

export type { GaslessRelayer, RelayResult, RelayStatus, SubmitReportParams } from "./types";
export { savePendingOp, loadPendingOp, clearPendingOp, listPendingOps } from "./pendingOps";
export type { PendingUserOp } from "./pendingOps";

let instance: GaslessRelayer | null = null;

export function getRelayer(): GaslessRelayer {
  if (instance) return instance;

  const provider = process.env.EXPO_PUBLIC_GASLESS_PROVIDER ?? "mock";
  const apiKey = process.env.EXPO_PUBLIC_PIMLICO_API_KEY;
  const registryAddress = process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS as
    | `0x${string}`
    | undefined;

  if (provider === "pimlico" && apiKey && registryAddress) {
    instance = new PimlicoRelayer({
      apiKey,
      bundlerUrl:
        process.env.EXPO_PUBLIC_PIMLICO_BUNDLER_URL ??
        "https://api.pimlico.io/v2/linea-sepolia/rpc",
      paymasterUrl:
        process.env.EXPO_PUBLIC_PIMLICO_PAYMASTER_URL ??
        "https://api.pimlico.io/v2/linea-sepolia/rpc",
      registryAddress,
    });
  } else {
    if (provider === "pimlico") {
      console.warn(
        "[relayer] EXPO_PUBLIC_GASLESS_PROVIDER=pimlico but API key or registry address missing — falling back to mock"
      );
    }
    instance = new MockRelayer();
  }
  return instance;
}
