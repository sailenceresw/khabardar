import type { EncryptedBlob } from "../cryptoUtils";
import type { ContentKeyring } from "./contentKeys";

/**
 * A published bundle exactly as it sits in the content layer.
 *
 * `blob` is ciphertext — the store, the pinning service, and any passive
 * observer see nothing readable. `keyring` necessarily sits in the clear
 * (you need it to decrypt) and is either an openly published key for Public
 * reports or per-recipient wrapped keys for JournalistsOnly ones. It carries
 * no reporter identifier either way.
 */
export interface StoredBundle {
  v: 1;
  blob: EncryptedBlob;
  keyring: ContentKeyring;
}

export interface PutResult {
  /** Content identifier (IPFS CIDv1 in production). */
  cid: string;
  sizeBytes: number;
  /** True when written to the local mock store rather than a real network. */
  simulated: boolean;
}

/**
 * Where encrypted report bundles live. The chain stores only a hash and a CID
 * pointing here; this interface is the only thing that ever holds bytes.
 */
export interface ContentStore {
  readonly name: string;
  put(bundle: StoredBundle): Promise<PutResult>;
  get(cid: string): Promise<StoredBundle | null>;
}
