import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";
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
 *
 * On a device, bundles are files rather than AsyncStorage rows: Android's
 * AsyncStorage database is capped at 6 MB in total, and each evidence chunk
 * is ~2 MB of hex, so the default configuration could not hold one large
 * attachment. The web preview has no file system and keeps AsyncStorage.
 */
export class MockContentStore implements ContentStore {
  readonly name = "mock";

  async put(bundle: StoredBundle): Promise<PutResult> {
    const serialized = JSON.stringify(bundle);
    const digest = keccak256(toBytes(serialized)).slice(2);
    const cid = `bafy${digest.slice(0, 52)}`;

    if (Platform.OS === "web") {
      await AsyncStorage.setItem(PREFIX + cid, serialized);
    } else {
      await FileSystem.makeDirectoryAsync(contentDir(), { intermediates: true });
      await FileSystem.writeAsStringAsync(contentDir() + cid, serialized);
    }

    return { cid, sizeBytes: serialized.length, simulated: true };
  }

  async get(cid: string): Promise<StoredBundle | null> {
    const bundle = safeJsonParse<StoredBundle>(await readRaw(cid));
    // Shape check as well as parse check — a well-formed JSON blob that is not
    // a bundle is just as unusable as malformed bytes.
    if (!bundle || !bundle.blob || !bundle.keyring) return null;
    return bundle;
  }
}

/**
 * Wipe every locally held bundle. Panic delete must call this: these are the
 * reporter's own published reports and evidence, and on a seized phone their
 * presence alone says who wrote them. AsyncStorage rows were caught by panic's
 * prefix sweep; files are not.
 */
export async function clearMockContent(): Promise<void> {
  if (Platform.OS === "web") {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
    return;
  }
  await FileSystem.deleteAsync(contentDir(), { idempotent: true });
}

function contentDir(): string {
  return `${FileSystem.documentDirectory}content/`;
}

async function readRaw(cid: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(PREFIX + cid);
  // A CID comes from the chain or a bundle, i.e. from outside; it is a file
  // name here, so it must not be able to walk out of the directory.
  if (!/^[a-z0-9]+$/i.test(cid)) return null;
  try {
    return await FileSystem.readAsStringAsync(contentDir() + cid);
  } catch {
    return null;
  }
}
