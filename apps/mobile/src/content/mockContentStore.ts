import AsyncStorage from "@react-native-async-storage/async-storage";
import { keccak256, toBytes } from "viem";
import { safeJsonParse } from "../safeJson";
import type { ContentStore, PutResult, StoredBundle } from "./types";

const PREFIX = "khabardar.content.";

/**
 * Local stand-in for IPFS. Content-addresses the bundle exactly the way a real
 * store does — the CID is derived from the bytes, so the same bundle always
 * yields the same CID and a tampered bundle yields a different one. Active
 * whenever EXPO_PUBLIC_CONTENT_STORE is unset or "mock".
 *
 * The CID here is a keccak-derived stand-in, not a real multihash; swapping in
 * IpfsContentStore produces genuine CIDv1 values without any caller changes.
 */
export class MockContentStore implements ContentStore {
  readonly name = "mock";

  async put(bundle: StoredBundle): Promise<PutResult> {
    const serialized = JSON.stringify(bundle);
    const digest = keccak256(toBytes(serialized)).slice(2);
    const cid = `bafy${digest.slice(0, 52)}`;

    await AsyncStorage.setItem(PREFIX + cid, serialized);

    return { cid, sizeBytes: serialized.length, simulated: true };
  }

  async get(cid: string): Promise<StoredBundle | null> {
    const bundle = safeJsonParse<StoredBundle>(await AsyncStorage.getItem(PREFIX + cid));
    // Shape check as well as parse check — a well-formed JSON blob that is not
    // a bundle is just as unusable as malformed bytes.
    if (!bundle || !bundle.blob || !bundle.keyring) return null;
    return bundle;
  }
}
