import type { ArtifactFetcher, ArtifactPair, ArtifactStore } from "./ExpoZkProve.types";

/**
 * Fetching and caching the circom proving artifacts.
 *
 * ## Why they are downloaded rather than bundled
 *
 * A witness calculator plus a proving key is roughly 3 MB for the smallest
 * Semaphore tree and grows with depth. Bundling every depth would add tens of
 * megabytes to an app whose users are frequently on metered connections and
 * cheap devices. So they are fetched once and cached.
 *
 * ## The leak that creates, which is the important part
 *
 * Downloading a Semaphore proving key from a public CDN tells whoever runs that
 * CDN — and anyone watching the connection — that this IP address is about to
 * produce a zero-knowledge proof. In an app whose whole purpose is anonymity,
 * that is a strong signal: it narrows "someone, somewhere" to "this device, in
 * the next few minutes". It is worse than an ordinary content fetch, because
 * ordinary content is fetched by readers too, while a proving key is only
 * fetched by someone who is about to act.
 *
 * Two consequences are baked in here rather than left to the caller:
 *
 *  1. **The fetch goes through the app's transport seam**, so an anonymising
 *     transport covers it and the fail-closed switch can refuse it. The caller
 *     supplies the fetcher; this module never touches global `fetch`.
 *  2. **Artifacts are fetched eagerly and cached**, ideally long before the
 *     user decides to act. A download that happens at the moment of use is a
 *     timing correlation; one that happened last week is not. See
 *     {@link warmCache}.
 *
 * ## Integrity
 *
 * A proving key is not secret, but a *substituted* one is dangerous in a
 * subtle way: a malicious key produces proofs that fail verification, which
 * reads to the user as "the app is broken" rather than "you are being attacked".
 * Digests are checked when the caller supplies them.
 */

/** Where the Semaphore project publishes artifacts. */
export const DEFAULT_ARTIFACT_BASE = "https://snark-artifacts.pse.dev/semaphore/4.0.0";

export function artifactUrls(treeDepth: number, base = DEFAULT_ARTIFACT_BASE): ArtifactPair {
  return {
    wasmUrl: `${base}/semaphore-${treeDepth}.wasm`,
    zkeyUrl: `${base}/semaphore-${treeDepth}.zkey`,
  };
}

export interface EnsureOptions {
  treeDepth: number;
  store: ArtifactStore;
  fetcher: ArtifactFetcher;
  base?: string;
  /** Optional SHA-256 digests, hex, to verify what was downloaded. */
  expected?: { wasm?: string; zkey?: string };
  onProgress?: (stage: "wasm" | "zkey", receivedBytes: number) => void;
}

export interface CachedArtifacts {
  wasmPath: string;
  zkeyPath: string;
  /** True when nothing had to be downloaded. */
  fromCache: boolean;
}

export class ArtifactError extends Error {
  constructor(
    readonly reason: "download-failed" | "digest-mismatch" | "unusable",
    message: string
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

/**
 * Ensure the artifacts for `treeDepth` are on disk, downloading if needed.
 *
 * Returns local paths for the native prover. Never called implicitly by a
 * proving call — a several-megabyte download must be something the user
 * initiated, not a side effect of tapping a button.
 */
export async function ensureArtifacts(options: EnsureOptions): Promise<CachedArtifacts> {
  const { treeDepth, store, fetcher, base, expected, onProgress } = options;
  const { wasmUrl, zkeyUrl } = artifactUrls(treeDepth, base);

  const wasmName = `semaphore-${treeDepth}.wasm`;
  const zkeyName = `semaphore-${treeDepth}.zkey`;

  const cachedWasm = await store.pathIfPresent(wasmName);
  const cachedZkey = await store.pathIfPresent(zkeyName);

  if (cachedWasm && cachedZkey && (await store.isUsable(cachedZkey))) {
    return { wasmPath: cachedWasm, zkeyPath: cachedZkey, fromCache: true };
  }

  const wasmPath =
    cachedWasm ??
    (await download(wasmUrl, wasmName, store, fetcher, expected?.wasm, (n) =>
      onProgress?.("wasm", n)
    ));

  const zkeyPath = await download(zkeyUrl, zkeyName, store, fetcher, expected?.zkey, (n) =>
    onProgress?.("zkey", n)
  );

  // A truncated proving key fails deep inside proving with an opaque error, so
  // it is rejected here where the cause is still obvious.
  if (!(await store.isUsable(zkeyPath))) {
    await store.remove(zkeyName);
    throw new ArtifactError(
      "unusable",
      "The downloaded proving key did not parse. It was discarded; try again."
    );
  }

  return { wasmPath, zkeyPath, fromCache: false };
}

async function download(
  url: string,
  name: string,
  store: ArtifactStore,
  fetcher: ArtifactFetcher,
  expectedDigest: string | undefined,
  onProgress: (bytes: number) => void
): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await fetcher(url);
  } catch (e) {
    throw new ArtifactError(
      "download-failed",
      `Could not download ${name}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  onProgress(bytes.byteLength);

  if (expectedDigest) {
    const actual = await store.digest(bytes);
    if (actual.toLowerCase() !== expectedDigest.toLowerCase()) {
      throw new ArtifactError(
        "digest-mismatch",
        `${name} did not match its expected digest. A substituted proving key produces proofs that fail verification, which looks like a broken app rather than an attack — so this is refused.`
      );
    }
  }

  return store.write(name, bytes);
}

/**
 * Download artifacts ahead of time.
 *
 * Worth doing on a screen the user opened deliberately, well before they decide
 * to act. The download is a timing signal — "this device fetched a proving key
 * four minutes before that nullifier appeared on-chain" is a correlation an
 * observer does not need to be given. Warming the cache early makes that
 * inference useless.
 */
export async function warmCache(options: EnsureOptions): Promise<CachedArtifacts> {
  return ensureArtifacts(options);
}

export async function isCached(treeDepth: number, store: ArtifactStore): Promise<boolean> {
  const wasm = await store.pathIfPresent(`semaphore-${treeDepth}.wasm`);
  const zkey = await store.pathIfPresent(`semaphore-${treeDepth}.zkey`);
  return !!wasm && !!zkey;
}

/** Drop cached artifacts. Called by panic delete. */
export async function clearArtifacts(store: ArtifactStore, maxDepth = 32): Promise<void> {
  for (let depth = 1; depth <= maxDepth; depth++) {
    await store.remove(`semaphore-${depth}.wasm`);
    await store.remove(`semaphore-${depth}.zkey`);
  }
}
