import { requireOptionalNativeModule } from "expo-modules-core";

import type {
  ExpoZkProveNativeModule,
  GeneratedProof,
  SemaphoreCircuitInputs,
} from "./ExpoZkProve.types";

export * from "./ExpoZkProve.types";
export {
  ArtifactError,
  artifactUrls,
  clearArtifacts,
  DEFAULT_ARTIFACT_BASE,
  ensureArtifacts,
  isCached,
  warmCache,
  type CachedArtifacts,
  type EnsureOptions,
} from "./artifacts";

/**
 * On-device Groth16 proving.
 *
 * Optional, like the Tor module and for the same reason: it cannot exist in
 * Expo Go or on web, and throwing at import time would take the whole app down
 * on those targets. Absence is a supported state the UI reports honestly.
 */
const native = requireOptionalNativeModule<ExpoZkProveNativeModule>("ExpoZkProve");

export class ProverUnavailableError extends Error {
  constructor() {
    super(
      "On-device proving is not available in this build. It requires a development build or a release binary — Expo Go and the web preview cannot load native code."
    );
    this.name = "ProverUnavailableError";
  }
}

export class ProvingFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvingFailedError";
  }
}

/**
 * Whether this build can prove at all.
 *
 * The distinction that matters to a user is "this build cannot do this" versus
 * "this build can and something went wrong". Conflating them is how someone
 * concludes the feature is broken when it was never present.
 */
export function isProverAvailable(): boolean {
  if (!native) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
}

/**
 * Generate a Semaphore proof.
 *
 * Slow — seconds on a modern phone, longer on the cheap hardware much of the
 * intended audience carries. The caller must show progress; a spinner with no
 * explanation reads as a hang, and a user who force-quits mid-proof has simply
 * wasted the time.
 *
 * Artifacts are NOT fetched here. A multi-megabyte download must be something
 * the user initiated — see `ensureArtifacts` — not a side effect of tapping a
 * button, and fetching it at the moment of use is a timing signal worth
 * avoiding.
 */
export async function proveSemaphore(input: {
  wasmPath: string;
  zkeyPath: string;
  inputs: SemaphoreCircuitInputs;
}): Promise<GeneratedProof> {
  if (!native) throw new ProverUnavailableError();

  const result = await native.prove(
    input.wasmPath,
    input.zkeyPath,
    JSON.stringify(input.inputs)
  );

  if (result.error) throw new ProvingFailedError(result.error);
  if (!result.points || result.points.length !== 8) {
    throw new ProvingFailedError("The prover returned a malformed proof.");
  }

  return {
    points: result.points as GeneratedProof["points"],
    publicSignals: result.publicSignals ?? [],
  };
}

/** Whether a proving key parses, so a truncated download fails early. */
export async function validateZkey(zkeyPath: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.validateZkey(zkeyPath);
  } catch {
    return false;
  }
}
