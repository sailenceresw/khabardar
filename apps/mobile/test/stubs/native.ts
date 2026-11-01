/**
 * Stand-ins for the native modules, so the logic they wrap can be tested on
 * Node without a simulator.
 *
 * These are deliberately faithful rather than convenient. `getRandomBytes`
 * enforces expo-crypto's real 1024-byte ceiling, because a stub that quietly
 * accepts any size would have hidden the bug where every tip over roughly 508
 * bytes failed to send. A stub that is more permissive than the thing it
 * replaces tests nothing.
 */
import nodeCrypto from "node:crypto";

/** expo-crypto refuses a single request larger than this. So does this stub. */
export const EXPO_RANDOM_LIMIT = 1024;

export const cryptoStub = {
  getRandomBytes(n: number): Uint8Array {
    if (n > EXPO_RANDOM_LIMIT) {
      throw new TypeError(
        `expo-crypto: getRandomBytes is limited to ${EXPO_RANDOM_LIMIT} bytes, asked for ${n}`
      );
    }
    return new Uint8Array(nodeCrypto.randomBytes(n));
  },
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  async digest(_algo: string, buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const h = nodeCrypto.createHash("sha256").update(Buffer.from(buffer)).digest();
    return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
  },
};

/** In-memory AsyncStorage. `reset()` keeps tests independent of each other. */
const mem = new Map<string, string>();

export const asyncStorageStub = {
  async getItem(k: string) {
    return mem.has(k) ? mem.get(k)! : null;
  },
  async setItem(k: string, v: string) {
    mem.set(k, v);
  },
  async removeItem(k: string) {
    mem.delete(k);
  },
  async getAllKeys() {
    return [...mem.keys()];
  },
  async multiRemove(keys: string[]) {
    keys.forEach((k) => mem.delete(k));
  },
  reset() {
    mem.clear();
  },
};

/** SecureStore has the same shape of guarantees here: none. It is a Map. */
export const secureStoreStub = {
  getItemAsync: (k: string) => asyncStorageStub.getItem(k),
  setItemAsync: (k: string, v: string) => asyncStorageStub.setItem(k, v),
  deleteItemAsync: (k: string) => asyncStorageStub.removeItem(k),
};

export const reactNativeStub = {
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
};

/** Only the disguise hook is reachable from the modules under test. */
export const expoTorStub = {
  setLauncherDisguise: async () => true,
  startTor: async () => undefined,
  stopTor: async () => undefined,
  isTorAvailable: () => false,
  getStatus: () => ({ state: "stopped" }),
};

export function resetStubs() {
  asyncStorageStub.reset();
}
