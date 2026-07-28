import { safeJsonParse } from "../safeJson";
import type { ContentStore, PutResult, StoredBundle } from "./types";

/**
 * Real content layer backed by an IPFS pinning service (web3.storage, Pinata,
 * Filebase — anything exposing an HTTP pin API) with a public gateway for reads.
 *
 * Only ciphertext is ever handed to this class. The pinning service, the
 * gateway operator, and anyone watching the network see an opaque blob; the
 * content key never leaves the device except where the author deliberately
 * publishes it (Public reports) or wraps it to a named recipient
 * (JournalistsOnly).
 *
 * What a real setup needs (see README "Content layer"):
 *  - EXPO_PUBLIC_CONTENT_STORE=ipfs
 *  - EXPO_PUBLIC_IPFS_API_URL     — pinning endpoint, e.g. https://api.web3.storage/upload
 *  - EXPO_PUBLIC_IPFS_API_TOKEN   — service token for that endpoint
 *  - EXPO_PUBLIC_IPFS_GATEWAY_URL — read gateway, e.g. https://w3s.link/ipfs
 *
 * Operational caveat worth planning for: pinning services are a censorship and
 * correlation chokepoint. A production deployment should pin to more than one
 * provider, and route uploads over Tor so the upload IP is not linkable to the
 * reporter. Neither is wired here.
 */
export class IpfsContentStore implements ContentStore {
  readonly name = "ipfs";

  constructor(
    private readonly config: {
      apiUrl: string;
      apiToken: string;
      gatewayUrl: string;
    }
  ) {}

  async put(bundle: StoredBundle): Promise<PutResult> {
    const body = JSON.stringify(bundle);

    const res = await fetch(this.config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiToken}`,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`IPFS put failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { cid?: string; Hash?: string; value?: { cid?: string } };
    // Different providers name this field differently.
    const cid = json.cid ?? json.Hash ?? json.value?.cid;
    if (!cid) throw new Error("IPFS put failed: no CID in response");

    return { cid, sizeBytes: body.length, simulated: false };
  }

  async get(cid: string): Promise<StoredBundle | null> {
    const res = await fetch(`${this.config.gatewayUrl}/${cid}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;

    // A gateway is untrusted: malformed or non-bundle responses degrade to
    // "unavailable" rather than throwing, so a bad gateway cannot crash the
    // reader. Integrity of well-formed bundles is checked separately against
    // the on-chain hash in feed/resolve.ts.
    const bundle = safeJsonParse<StoredBundle>(await res.text());
    if (!bundle || !bundle.blob || !bundle.keyring) return null;
    return bundle;
  }
}
