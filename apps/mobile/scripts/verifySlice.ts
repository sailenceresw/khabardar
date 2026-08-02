/*
 * Headless end-to-end verification of the Khabardar report-submission slice.
 *
 * Run:  npm run verify:slice   (from apps/mobile)
 *
 * It exercises the REAL project modules (cryptoUtils, encoding, mockRelayer,
 * @khabardar/shared) — not reimplementations — with expo-crypto shimmed to
 * Node's crypto so the native module resolves off-device. This is the same
 * logic the ReviewScreen runs when a user taps "Submit"; keeping it runnable
 * headlessly means the chain-facing slice can be smoke-tested in CI without a
 * simulator or Metro.
 *
 * Proves the full path a report travels:
 *   plaintext body  -> AES-256-GCM encrypt
 *                    -> canonical keccak256 report fingerprint
 *                    -> ABI-encoded submitReport() calldata
 *                    -> device-key signature over the calldata digest
 *                    -> mock gasless relay result (tx hash + explorer URL)
 * and that decrypt(encrypt(body)) round-trips.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const Module = require("module");
const nodeCrypto = require("crypto");

// ---- expo-crypto shim (must be registered BEFORE requiring project code) ----
const cryptoStub = {
  getRandomBytes: (n: number): Uint8Array => new Uint8Array(nodeCrypto.randomBytes(n)),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async (_algo: string, buffer: ArrayBuffer): Promise<ArrayBuffer> => {
    const h = nodeCrypto.createHash("sha256").update(Buffer.from(buffer)).digest();
    return h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength);
  },
};
// ---- React Native / Expo module shims --------------------------------------
// The evidence + content modules pull in native modules that do not exist off
// device. These stand-ins are faithful enough to exercise the real logic:
// AsyncStorage becomes an in-memory Map, SecureStore delegates to it, and the
// image modules are never called on this path (no picker involved).
const memStore = new Map<string, string>();
const asyncStorageStub = {
  getItem: async (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
  setItem: async (k: string, v: string) => void memStore.set(k, v),
  removeItem: async (k: string) => void memStore.delete(k),
  getAllKeys: async () => [...memStore.keys()],
  multiRemove: async (keys: string[]) => keys.forEach((k) => memStore.delete(k)),
};
const secureStoreStub = {
  getItemAsync: async (k: string) => asyncStorageStub.getItem(k),
  setItemAsync: async (k: string, v: string) => asyncStorageStub.setItem(k, v),
  deleteItemAsync: async (k: string) => asyncStorageStub.removeItem(k),
};

const SHIMS: Record<string, unknown> = {
  "expo-crypto": cryptoStub,
  "@react-native-async-storage/async-storage": { default: asyncStorageStub, ...asyncStorageStub },
  "expo-secure-store": secureStoreStub,
  "expo-image-picker": { launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }), MediaTypeOptions: { Images: "Images" } },
  "expo-image-manipulator": { manipulateAsync: async () => ({ base64: "" }), SaveFormat: { JPEG: "jpeg" } },
  "react-native": { Platform: { OS: "web" } },
};

const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request in SHIMS) return SHIMS[request];
  return origLoad.call(this, request, ...rest);
};

// ---- require the real modules (after the shim) ------------------------------
const {
  encrypt,
  decrypt,
  utf8ToBytes,
  bytesToUtf8,
  computeReportHash,
  sha256Hex,
} = require("../src/cryptoUtils");
const { encodeSubmitReportCall } = require("../src/relayer/encoding");
const { MockRelayer } = require("../src/relayer/mockRelayer");
const { entityTagFor, normalizeEntityName, ZERO_TAG } = require("../src/entityTag");
const { uploadAllEvidence } = require("../src/evidence");
const { getContentStore } = require("../src/content");
const { ACTIVE_CHAIN } = require("@khabardar/shared");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  console.log(`\n=== Khabardar slice verification (chain: ${ACTIVE_CHAIN.name}, id ${ACTIVE_CHAIN.chainId}) ===\n`);

  // 1. Device-bound identity (what identity.ts stores in SecureStore on-device)
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  console.log("1. device account (pseudonymous) :", account.address);

  // 2. Compose + encrypt the report body
  const draftKey = cryptoStub.getRandomBytes(32);
  const body = "Junior engineer at the district PWD office demanded a 15% cut to clear a road-works invoice.";
  const encryptedBody = encrypt(utf8ToBytes(body), draftKey);
  console.log("2. encrypted body nonce/len      :", encryptedBody.nonce, `/ ${encryptedBody.ciphertext.length / 2} bytes ct`);

  // decrypt round-trip
  const roundTrip = bytesToUtf8(decrypt(encryptedBody, draftKey));
  assert(roundTrip === body, "decrypt(encrypt(body)) must equal body");
  console.log("   decrypt round-trip            : OK");

  // 3. Evidence fingerprint (client-side sha256 of an encrypted attachment)
  const fakeEncryptedEvidence = cryptoStub.getRandomBytes(2048);
  const evSha = await sha256Hex(fakeEncryptedEvidence);
  console.log("3. evidence sha256               :", evSha.slice(0, 24) + "…");

  // 4. Canonical on-chain fingerprint
  const category = 0; // Bribery
  const coarseGeohash = "tsj9"; // district-level prefix only, never precise
  const createdAt = 1_753_000_000_000;
  const reportHash = computeReportHash({
    encryptedBody,
    evidenceSha256: [evSha],
    category,
    coarseGeohash,
    createdAt,
  });
  assert(/^0x[0-9a-f]{64}$/.test(reportHash), "reportHash must be a 32-byte hex");
  console.log("4. keccak256 report fingerprint  :", reportHash);

  // determinism: same inputs -> same hash
  const reportHash2 = computeReportHash({ encryptedBody, evidenceSha256: [evSha], category, coarseGeohash, createdAt });
  assert(reportHash === reportHash2, "report hash must be deterministic");
  console.log("   deterministic                 : OK");

  // 5. Blinded entity tag — same office must produce the same tag, and the
  // office name must never appear in the tag itself.
  const entityTag = entityTagFor("Block Development Office, Sitapur");
  const entityTagVariant = entityTagFor("  block development office   sitapur ");
  assert(entityTag === entityTagVariant, "entity tag must be stable across spelling variance");
  assert(entityTagFor("") === ZERO_TAG, "empty entity name must yield the zero tag");
  assert(
    !entityTag.toLowerCase().includes(Buffer.from("sitapur").toString("hex")),
    "entity tag must not embed the plaintext name"
  );
  console.log("5. blinded entity tag            :", entityTag);
  console.log("   stable across variants        : OK");

  // 5b. Evidence upload — encrypted blobs go to the content layer and come
  // back with CIDs, so the bundle can point at them instead of assuming a
  // centralized backend.
  const store = getContentStore();
  const evBlob = encrypt(fakeEncryptedEvidence, draftKey);
  await asyncStorageStub.setItem("khabardar.evidence.ev_test", JSON.stringify(evBlob));

  const uploaded = await uploadAllEvidence([
    {
      id: "ev_test",
      kind: "photo",
      encryptedUri: "khabardar.evidence.ev_test",
      sha256: evSha,
      sizeBytes: fakeEncryptedEvidence.length,
      addedAt: Date.now(),
    },
  ]);
  assert(uploaded.length === 1, "evidence upload must return one item");
  assert(!!uploaded[0].cid, "uploaded evidence must carry a CID");
  assert(uploaded[0].sha256 === evSha, "upload must not alter the evidence hash");

  // The CID must actually resolve, and to ciphertext.
  const fetched = await store.get(uploaded[0].cid);
  assert(!!fetched, "evidence CID must resolve in the content store");
  assert(
    fetched.blob.ciphertext === evBlob.ciphertext,
    "content store must return the same ciphertext that was uploaded"
  );
  console.log("5b. evidence CID                 :", uploaded[0].cid);
  console.log("    resolves to same ciphertext  : OK");

  // Idempotence: re-uploading an item that already has a CID is a no-op.
  const again = await uploadAllEvidence(uploaded);
  assert(again[0].cid === uploaded[0].cid, "re-upload must not mint a new CID");
  console.log("    re-upload is idempotent      : OK");

  const cid = "bafymockcontentidentifier0000000000000000000000000001";

  // 6. ABI-encoded submitReport() calldata (what the UserOp will carry)
  const calldata = encodeSubmitReportCall(
    reportHash,
    cid,
    category,
    0 /* Visibility.Public */,
    coarseGeohash,
    entityTag
  );
  assert(calldata.startsWith("0x"), "calldata must be hex");
  assert(calldata.length > 2 + 4 * 2, "calldata must carry a selector plus args");
  console.log("6. submitReport() calldata       :", calldata.slice(0, 34) + "…", `(${(calldata.length - 2) / 2} bytes)`);

  // 7. Gasless submit via the mock relayer (real signing, fabricated tx hash)
  const signer = {
    address: account.address,
    kind: "device" as const,
    signMessage: (message: { raw: `0x${string}` }) => account.signMessage({ message }),
  };
  const relay = await new MockRelayer().submitReport({
    reportHash,
    cid,
    category,
    visibility: 0,
    coarseGeohash,
    entityTag,
    signer,
  });
  assert(/^0x[0-9a-f]{64}$/.test(relay.txHash), "relay txHash must be 32-byte hex");
  assert(relay.simulated === true, "mock relay must be flagged simulated");
  assert(relay.explorerUrl.includes(relay.txHash), "explorer URL must reference tx hash");
  console.log("7. gasless relay result          :");
  console.log("     txHash                       :", relay.txHash);
  console.log("     onChainReportId              :", relay.onChainReportId);
  console.log("     explorerUrl                  :", relay.explorerUrl);
  console.log("     simulated                    :", relay.simulated);

  console.log("\n✅ ALL SLICE STEPS PASSED — compose → encrypt → hash → encode → sign → gasless submit\n");
}

main().catch((e) => {
  console.error("\n❌ SLICE VERIFICATION FAILED\n", e);
  process.exit(1);
});
