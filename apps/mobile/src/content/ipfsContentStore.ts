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
 * What a real setup needs (see README "Content layer" / issue #6):
 *  - EXPO_PUBLIC_CONTENT_STORE=ipfs
 *  - EXPO_PUBLIC_IPFS_API_URL     — pinning endpoint, e.g. https://api.web3.storage/upload
 *  - EXPO_PUBLIC_IPFS_API_TOKEN   — service token for that endpoint
 *  - EXPO_PUBLIC_IPFS_GATEWAY_URL — read gateway, e.g. https://w3s.link/ipfs
 *
 * Validation checklist (#6):
 *  1. put() a real encrypted bundle → receive a CID
 *  2. get() that CID through the gateway → decrypt → integrity check vs on-chain hash
 *  3. Gateway returning garbage → get() returns null ("unavailable"), never throws
 *  4. Swapped bundle → feed integrity check shows the fingerprint mismatch warning
 *
 * Operational caveat: pinning services are a censorship and correlation
 * chokepoint. Production should pin to more than one provider and route uploads
 * over Tor. Neither is wired here.
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
      const detail = await res.text().catch(() => "");
      throw new Error(`IPFS put failed: ${res.status} ${detail.slice(0, 300)}`);
    }

    let json: { cid?: string; Hash?: string; value?: { cid?: string } };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new Error("IPFS put failed: response was not JSON");
    }

    // Different providers name this field differently.
    const cid = json.cid ?? json.Hash ?? json.value?.cid;
    if (!cid || typeof cid !== "string") {
      throw new Error("IPFS put failed: no CID in response");
    }

    return { cid, sizeBytes: body.length, simulated: false };
  }

  async get(cid: string): Promise<StoredBundle | null> {
    // A gateway is untrusted. Any failure mode (network, 404, non-JSON,
    // well-formed JSON that is not a bundle) degrades to null so the feed can
    // show "unavailable" instead of crashing the reader. Integrity of a
    // well-formed bundle is checked separately against the on-chain hash in
    // feed/resolve.ts — a swapped blob trips the fingerprint warning there.
    try {
      const base = this.config.gatewayUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/${cid}`);
      if (!res.ok) return null;

      const text = await res.text();
      const bundle = safeJsonParse<StoredBundle>(text);
      if (!bundle || !bundle.blob || !bundle.keyring) return null;
      return bundle;
    } catch {
      return null;
    }
  }
}
