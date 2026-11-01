/**
 * Circuit inputs, every value a decimal string.
 *
 * Never JS numbers. Field elements run to 254 bits and a JS number carries 53,
 * so passing them as numbers silently rounds the identity secret into a
 * different one — producing a valid proof for a member who does not exist,
 * which fails verification with no clue as to why.
 */
export interface SemaphoreCircuitInputs {
  secret: string;
  merkleProofLength: string;
  merkleProofIndices: string[];
  merkleProofSiblings: string[];
  /** Already hashed into the field by the caller. */
  message: string;
  /** Already hashed into the field by the caller. */
  scope: string;
}

export interface GeneratedProof {
  /** The 8 field elements the on-chain verifier reads, as decimal strings. */
  points: [string, string, string, string, string, string, string, string];
  /** Circuit outputs — for Semaphore, the Merkle root and the nullifier. */
  publicSignals: string[];
}

export interface ArtifactPair {
  wasmUrl: string;
  zkeyUrl: string;
}

/** Where artifacts live on disk. Injected so the module owns no filesystem. */
export interface ArtifactStore {
  pathIfPresent(name: string): Promise<string | null>;
  write(name: string, bytes: Uint8Array): Promise<string>;
  remove(name: string): Promise<void>;
  /** Whether the native prover can parse this proving key. */
  isUsable(path: string): Promise<boolean>;
  digest(bytes: Uint8Array): Promise<string>;
}

/**
 * How artifacts are downloaded.
 *
 * Injected rather than using global `fetch` so the app's transport seam is the
 * only way out — an anonymising transport covers this fetch, and the
 * fail-closed switch can refuse it. Fetching a proving key from a CDN announces
 * that this IP is about to produce a proof, which is a stronger signal than
 * ordinary traffic and must not bypass the transport.
 */
export type ArtifactFetcher = (url: string) => Promise<Uint8Array>;

export interface ExpoZkProveNativeModule {
  /** Whether the native prover loaded. False in Expo Go and on web. */
  isSupported(): boolean;
  /**
   * Generate a Groth16 proof. Slow — seconds, longer on cheap hardware — and
   * must never be called on the UI thread.
   */
  prove(
    wasmPath: string,
    zkeyPath: string,
    inputsJson: string
  ): Promise<{ points?: string[]; publicSignals?: string[]; error?: string }>;
  /** Whether a proving key parses, so a truncated download fails early. */
  validateZkey(zkeyPath: string): Promise<boolean>;
}
