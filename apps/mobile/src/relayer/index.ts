import { getRuntimeConfig } from "../runtimeConfig";
import { MockRelayer } from "./mockRelayer";
import { PimlicoRelayer } from "./pimlicoRelayer";
import type { GaslessRelayer } from "./types";

export type { GaslessRelayer, RelayResult, RelayStatus, SubmitReportParams } from "./types";
export { savePendingOp, loadPendingOp, clearPendingOp, listPendingOps } from "./pendingOps";
export type { PendingUserOp } from "./pendingOps";

let instance: GaslessRelayer | null = null;

/** The relayer `KHABARDAR_MODE` selects. See `runtimeConfig.ts` for when live falls back to mock. */
export function getRelayer(): GaslessRelayer {
  if (instance) return instance;

  const { relayer } = getRuntimeConfig();
  instance =
    relayer.kind === "pimlico"
      ? new PimlicoRelayer({
          apiKey: relayer.apiKey,
          bundlerUrl: relayer.bundlerUrl,
          paymasterUrl: relayer.paymasterUrl,
          registryAddress: relayer.registryAddress,
        })
      : new MockRelayer();
  return instance;
}
