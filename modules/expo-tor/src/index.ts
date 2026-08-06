import { requireOptionalNativeModule } from "expo-modules-core";

import type { ExpoTorNativeModule, TorResponse, TorState, TorStatus } from "./ExpoTor.types";

export type { ExpoTorNativeModule, TorResponse, TorState, TorStatus };

/**
 * Embedded Tor, or nothing.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module
 * cannot exist in Expo Go or on web, and throwing at import time would take the
 * whole app down on those targets. Absence is a supported state that the UI
 * reports honestly — see {@link isTorAvailable}.
 */
const native = requireOptionalNativeModule<ExpoTorNativeModule>("ExpoTor");

/**
 * Whether this build can run Tor at all.
 *
 * False in Expo Go and on web. The distinction that matters to a user is
 * "this build cannot protect you" versus "this build can and is not right
 * now", and conflating them is how someone ends up trusting a preview build.
 */
export function isTorAvailable(): boolean {
  if (!native) return false;
  try {
    // The module can be present while the native library behind it is not —
    // an Android build assembled without the Rust step is exactly that. Asking
    // is what keeps such a build from reporting protection it cannot deliver.
    return native.isSupported();
  } catch {
    return false;
  }
}

export class TorUnavailableError extends Error {
  constructor() {
    super(
      "Embedded Tor is not available in this build. It requires a development build or a release binary — Expo Go and the web preview cannot load native modules."
    );
    this.name = "TorUnavailableError";
  }
}

export function getStatus(): TorStatus {
  if (!native) return { state: "stopped", socksPort: 0, lastError: null };
  return native.getStatus();
}

/**
 * Bootstrap Tor. Resolves with the SOCKS port once circuits are usable.
 *
 * Slow — 10 to 60 seconds on a mobile network is ordinary, and longer where
 * Tor is censored and bridges are needed. Callers must show progress rather
 * than a spinner that looks like a hang.
 */
export async function startTor(): Promise<number> {
  if (!native) throw new TorUnavailableError();
  return native.start();
}

export async function stopTor(): Promise<void> {
  if (!native) return;
  return native.stop();
}

/**
 * Move subsequent requests onto fresh circuits.
 *
 * Call between actions that must not be linkable. Two streams sharing a circuit
 * share an exit relay and a timing pattern, which is enough for that relay to
 * infer they came from one person — even though each is individually anonymous.
 *
 * Returns false when Tor is not running, rather than throwing, so a caller can
 * decide whether the absence of isolation is disqualifying.
 */
export async function newCircuit(): Promise<boolean> {
  if (!native) return false;
  return native.newCircuit();
}

/**
 * Perform an HTTP request through Tor.
 *
 * Throws when Tor is not running. It deliberately does not fall back to a
 * direct connection: a transport that silently degrades is worse than one that
 * does not exist, because the user has been told they are protected.
 */
export async function torRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | null } = {}
): Promise<TorResponse> {
  if (!native) throw new TorUnavailableError();
  return native.request(url, init.method ?? "GET", init.headers ?? {}, init.body ?? null);
}
