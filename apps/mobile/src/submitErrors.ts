/**
 * Turning a failed submission or feed load into something a reporter can act on.
 *
 * Errors arrive from many layers (fetch, the IPFS pinning API, the bundler,
 * viem) with messages written for developers. `publishReport` marks which
 * stage failed with `SubmitError`; `classifySubmitError` then decides which of
 * a few plain explanations fits. Being offline is checked before the stage,
 * because "the storage service is down" is the wrong thing to tell someone
 * whose phone has no signal.
 */

export type SubmitStage = "evidence" | "content" | "relay";

export type SubmitErrorKind =
  /** No connection, or the request never reached the server. */
  | "offline"
  /** The fail-closed switch refused to send without an anonymising transport. */
  | "anonymity"
  /** The content store (IPFS pinning) rejected or failed the upload. */
  | "content"
  /** The relayer or bundler rejected or failed the submission. */
  | "relayer"
  /** The RPC, wallet or bundler is on a different chain from the app. */
  | "network"
  | "unknown";

export class SubmitError extends Error {
  constructor(
    readonly stage: SubmitStage,
    readonly cause: unknown
  ) {
    // Keep the original text: the offline queue stores this message as the
    // reason a submission is waiting.
    super(`${stage}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SubmitError";
  }
}

/** Run one stage of a submission, tagging any failure with the stage it came from. */
export async function atStage<T>(stage: SubmitStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof SubmitError ? e : new SubmitError(stage, e);
  }
}

/** Messages fetch and the platforms produce when the request never got an answer. */
const OFFLINE_RE =
  /network request failed|failed to fetch|networkerror|load failed|internet connection appears to be offline|not connected to the internet|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT/i;

/** Messages viem, wallets and bundlers produce when chain ids disagree. */
const WRONG_NETWORK_RE =
  /chain ?mismatch|does not match the target chain|wrong (chain|network)|unsupported chain|invalid chain ?id|chain ?id .*(mismatch|does not match|expected)/i;

/**
 * Pick the plain explanation for an error.
 *
 * `deviceOffline` is the platform's own answer where it has one (the browser's
 * `navigator.onLine`); when it says offline, that wins over everything except
 * the anonymity refusal, which is a deliberate stop rather than a fault.
 */
export function classifySubmitError(error: unknown, deviceOffline = false): SubmitErrorKind {
  const cause = error instanceof SubmitError ? error.cause : error;
  const name = (cause as { name?: string } | null)?.name ?? "";
  const message = cause instanceof Error ? cause.message : String(cause ?? "");

  if (name === "AnonymityRequiredError") return "anonymity";
  if (deviceOffline) return "offline";
  if (name === "ChainMismatchError" || WRONG_NETWORK_RE.test(message)) return "network";
  if (name === "AbortError" || OFFLINE_RE.test(message)) return "offline";
  if (error instanceof SubmitError) return error.stage === "relay" ? "relayer" : "content";
  return "unknown";
}

/** The browser's offline flag in the web build; false where the platform does not say. */
export function deviceSaysOffline(): boolean {
  return typeof navigator !== "undefined" && (navigator as { onLine?: boolean }).onLine === false;
}
