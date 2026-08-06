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
  // Picker/recorder modules are never exercised on this path — no picker is
  // involved — but importing them off-device fails without a stand-in.
  "expo-document-picker": { getDocumentAsync: async () => ({ canceled: true, assets: [] }) },
  "expo-file-system": {
    readAsStringAsync: async () => "",
    deleteAsync: async () => undefined,
    EncodingType: { Base64: "base64" },
  },
  "expo-av": {
    Audio: {
      requestPermissionsAsync: async () => ({ granted: false }),
      setAudioModeAsync: async () => undefined,
      Recording: { createAsync: async () => ({ recording: null }) },
      RecordingOptionsPresets: { HIGH_QUALITY: {} },
    },
  },
  "react-native": { Platform: { OS: "web" } },
};

/**
 * Stand-in for the embedded Tor native module.
 *
 * `available` starts false, which is what web and Expo Go really see — the
 * transport wiring has to behave correctly in that state before anything else
 * is worth checking. Steps 11–13 flip it to exercise the running path.
 */
const torStub = {
  available: false,
  state: "stopped" as "stopped" | "starting" | "running" | "failed",
  socksPort: 0,
  requests: [] as Array<{ url: string; method: string }>,
  circuitRotations: 0,
  nextBody: "",
};

SHIMS["expo-tor"] = {
  isTorAvailable: () => torStub.available,
  getStatus: () => ({
    state: torStub.state,
    socksPort: torStub.socksPort,
    lastError: null,
  }),
  startTor: async () => {
    torStub.state = "running";
    torStub.socksPort = 9150;
    return torStub.socksPort;
  },
  stopTor: async () => {
    torStub.state = "stopped";
    torStub.socksPort = 0;
  },
  newCircuit: async () => {
    if (torStub.state !== "running") return false;
    torStub.circuitRotations++;
    return true;
  },
  torRequest: async (url: string, init: { method?: string }) => {
    torStub.requests.push({ url, method: init?.method ?? "GET" });
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from(torStub.nextBody).toString("base64"),
    };
  },
  TorUnavailableError: class TorUnavailableError extends Error {},
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
const { appendMirrorRow, readMirror } = require("../src/feed/localChainMirror");
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

  // 8. Report ids must stay unique. The mock relayer stands in for the
  // contract's monotonic `reportCount`; when it kept the counter in memory it
  // restarted at 0 on every app reload, so a second session minted ids that
  // already existed in the local mirror — the feed then opened the wrong
  // report and a moderation verdict landed on two of them at once.
  await appendMirrorRow({
    onChainReportId: relay.onChainReportId,
    reportHash,
    cid,
    category,
    visibility: 0,
    tier: 0,
    coarseGeohash,
    entityTag,
    timestamp: Date.now(),
    reporter: account.address,
    corroborations: 0,
  });

  const second = await new MockRelayer().submitReport({
    reportHash,
    cid,
    category,
    visibility: 0,
    coarseGeohash,
    entityTag,
    signer,
  });
  assert(
    second.onChainReportId !== relay.onChainReportId,
    "a second submission must not reuse an id already in the mirror"
  );
  assert((await readMirror()).length === 1, "mirror must hold exactly what was appended");
  console.log("8. report id after mirrored submit:", second.onChainReportId, "(distinct — OK)");

  // 9. Tip padding. AES-GCM ciphertext length equals plaintext length, so
  // without padding an observer who never breaks the encryption still learns
  // roughly how much someone wrote. Bucketing has to actually collapse
  // different lengths onto the same size, and has to round-trip.
  const { padToBucket, unpadFromBucket, TIP_LENGTH_BUCKETS } = require("../src/tips");

  const shortTip = "Bribe demanded.";
  const longerTip = "Bribe demanded at the counter, no receipt offered, third time this month.";

  const paddedShort = padToBucket(shortTip);
  const paddedLonger = padToBucket(longerTip);

  assert(
    paddedShort.length === paddedLonger.length,
    "two tips in the same bucket must produce identical lengths"
  );
  assert(
    paddedShort.length === TIP_LENGTH_BUCKETS[0],
    "a short tip must land in the smallest bucket"
  );
  assert(unpadFromBucket(paddedShort) === shortTip, "padding must round-trip a short tip");
  assert(unpadFromBucket(paddedLonger) === longerTip, "padding must round-trip a longer tip");

  const big = padToBucket("x".repeat(TIP_LENGTH_BUCKETS[0] + 10));
  assert(big.length === TIP_LENGTH_BUCKETS[1], "an oversized tip must move to the next bucket");
  console.log(
    "9. tip padding buckets           :",
    `${shortTip.length}B and ${longerTip.length}B → both ${paddedShort.length}B (OK)`
  );

  // 10. The jury's fairness properties. These are the design, not tuning, so
  // they are asserted rather than left to a comment someone can drift away
  // from — the mechanism they replaced looked reasonable too.
  const { commitmentFor } = require("../src/moderation");
  const { JUROR_VOTE_WEIGHT, JURY_QUORUM, APPEAL_QUORUM } = require("@khabardar/shared");

  assert(JUROR_VOTE_WEIGHT === 1, "every juror must count exactly one");
  assert(JURY_QUORUM >= 3, "a panel smaller than three is one person plus a rubber stamp");
  assert(APPEAL_QUORUM > JURY_QUORUM, "an appeal must be heard by a larger panel");

  // A commitment must be bound to the juror, or one juror could replay
  // another's sealed ballot and open it on their behalf.
  const salt = ("0x" + "11".repeat(32)) as `0x${string}`;
  const forAlice = commitmentFor({
    reportId: 7,
    round: 1,
    tier: 3,
    salt,
    juror: "0x1111111111111111111111111111111111111111",
  });
  const forBob = commitmentFor({
    reportId: 7,
    round: 1,
    tier: 3,
    salt,
    juror: "0x2222222222222222222222222222222222222222",
  });
  const nextRound = commitmentFor({
    reportId: 7,
    round: 2,
    tier: 3,
    salt,
    juror: "0x1111111111111111111111111111111111111111",
  });
  const otherTier = commitmentFor({
    reportId: 7,
    round: 1,
    tier: 4,
    salt,
    juror: "0x1111111111111111111111111111111111111111",
  });

  assert(forAlice !== forBob, "a commitment must bind the juror who made it");
  assert(forAlice !== nextRound, "a commitment must not survive into the next round");
  assert(forAlice !== otherTier, "a commitment must bind the tier");
  assert(/^0x[0-9a-f]{64}$/.test(forAlice), "a commitment must be a 32-byte hash");

  // A juror must be able to reopen their own ballot after closing the app.
  // Storing only the salt and keeping the tier in memory meant a commit
  // followed by a restart could never be revealed — which lands the juror in
  // abandonment, the one thing this design penalises, for doing nothing wrong.
  const { commitVote: mockCommit, loadBallotSecret, roundFor } = require("../src/moderation");

  const JUROR = "0x3333333333333333333333333333333333333333";
  const REPORTER = "0x4444444444444444444444444444444444444444";
  await mockCommit({ reportId: 42, juror: JUROR, reporter: REPORTER, tier: 3 });

  const round = await roundFor(42);
  const secret = await loadBallotSecret(42, round.index);
  assert(!!secret, "a sealed ballot must be recoverable from device storage");
  assert(secret.tier === 3, "the tier must survive a restart, not only the salt");
  assert(/^0x[0-9a-f]{64}$/.test(secret.salt), "the salt must survive a restart");

  // And the sealed ballot itself must carry no readable tier.
  const { ballotsFor } = require("../src/moderation");
  const sealed = (await ballotsFor(42, round.index))[0];
  assert(sealed.tier === undefined, "a sealed ballot must not expose its tier");
  assert(
    sealed.commitment === commitmentFor({ reportId: 42, round: round.index, tier: 3, salt: secret.salt, juror: JUROR }),
    "the stored commitment must match the sealed choice"
  );

  console.log(
    "10. jury fairness                :",
    `weight ${JUROR_VOTE_WEIGHT} each, quorum ${JURY_QUORUM}, appeal ${APPEAL_QUORUM}, ballot sealed + recoverable (OK)`
  );

  // 11. Transport selection. The property that matters is that a build which
  // cannot run Tor never claims it can — web and Expo Go must report `direct`
  // and unverified, because a user who believes otherwise makes decisions on it.
  const transportMod = require("../src/net/transport");
  const { getTransport, probeAnonymity, netFetch, isolateNextRequests } = transportMod;

  torStub.available = false;
  assert(getTransport().name === "direct", "no native module must select the direct transport");
  assert(probeAnonymity().verified === false, "direct must never report as verified");
  assert(probeAnonymity().claimed === false, "direct must not claim anonymity");

  // Installed but not started: still not anonymised. Marking traffic protected
  // because Tor *could* run is the exact failure this guards.
  torStub.available = true;
  torStub.state = "stopped";
  assert(getTransport().name === "direct", "an idle Tor must not be selected");
  assert(probeAnonymity().verified === false, "Tor that is not running is not protection");

  torStub.state = "running";
  torStub.socksPort = 9150;
  assert(getTransport().name === "tor", "a running Tor must be selected");
  assert(probeAnonymity().verified === true, "embedded Tor is verifiable end to end");
  console.log("11. transport selection          : direct → idle-tor → running-tor (OK)");

  // 12. Traffic must actually leave through the native module rather than the
  // global fetch, and the response has to survive the base64 round trip.
  torStub.nextBody = JSON.stringify({ cid: "bafyviator" });
  torStub.requests.length = 0;

  const response = await netFetch(
    "https://example.invalid/pin",
    { method: "POST", body: "{}" },
    "test:tor"
  );
  const parsed = await response.json();

  assert(torStub.requests.length === 1, "the request must go through the Tor native module");
  assert(torStub.requests[0].method === "POST", "the method must survive the bridge");
  assert(parsed.cid === "bafyviator", "the response body must survive the base64 round trip");
  console.log("12. request through Tor          : POST relayed, body round-tripped (OK)");

  // 13. Circuit isolation per submission. Two reports sharing a circuit share
  // an exit relay and a timing pattern, which links them even though each is
  // individually anonymous.
  torStub.circuitRotations = 0;
  assert((await isolateNextRequests()) === true, "a running Tor must grant fresh circuits");
  assert(torStub.circuitRotations === 1, "isolation must reach the native module");

  torStub.state = "stopped";
  assert(
    (await isolateNextRequests()) === false,
    "isolation must report failure when Tor is off rather than pretending"
  );
  assert(torStub.circuitRotations === 1, "no rotation should be recorded while stopped");
  console.log("13. circuit isolation            : rotates when running, honest when not (OK)");

  // Leave the transport where the rest of the suite expects it.
  torStub.available = false;
  transportMod.setTransport(null);

  console.log("\n✅ ALL SLICE STEPS PASSED — compose → encrypt → hash → encode → sign → gasless submit\n");
}

main().catch((e) => {
  console.error("\n❌ SLICE VERIFICATION FAILED\n", e);
  process.exit(1);
});
