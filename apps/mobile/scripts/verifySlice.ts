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
  setLauncherDisguise: async () => false,
  startTor: async (_bridges?: string) => {
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
  // centralized backend. This item is in the pre-chunking format (one blob
  // under the device key), which must be re-sealed under its own key on the
  // way out: the device key can never go into a bundle.
  const { storeEvidence, bytesSource, readUploadedEvidence, deleteEvidence, evidenceKey } = require("../src/evidence");
  const { getEvidenceKey } = require("../src/drafts");
  const deviceKey = await getEvidenceKey();
  const fails = async (f: () => unknown) => {
    try {
      await f();
      return false;
    } catch {
      return true;
    }
  };
  const evBlob = encrypt(fakeEncryptedEvidence, deviceKey);
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

  assert(!memStore.has("khabardar.evidence.ev_test"), "the legacy blob must be gone once re-sealed");

  // The CID must resolve, and to the original bytes — with the item key a
  // bundle carries, and not with the device key, which never leaves.
  const legacyParts: Uint8Array[] = [];
  await readUploadedEvidence(uploaded[0], await evidenceKey(uploaded[0]), (p: Uint8Array) => void legacyParts.push(p));
  assert(
    Buffer.concat(legacyParts).equals(Buffer.from(fakeEncryptedEvidence)),
    "re-sealed legacy evidence must decrypt to the original bytes"
  );
  assert(
    await fails(() => readUploadedEvidence(uploaded[0], deviceKey, () => undefined)),
    "the device key must not open uploaded evidence"
  );
  console.log("5b. evidence CID                 :", uploaded[0].cid);
  console.log("    legacy re-sealed, round-trips: OK");

  // Idempotence: re-uploading an item that already has a CID is a no-op.
  const again = await uploadAllEvidence(uploaded);
  assert(again[0].cid === uploaded[0].cid, "re-upload must not mint a new CID");
  console.log("    re-upload is idempotent      : OK");

  // 5c. Streamed evidence — what every new attachment now uses. A file several
  // chunks long must round-trip, hash the plaintext the same as a one-shot
  // digest, and refuse to decrypt if the store reorders or drops chunks.
  const stream = require("../src/evidenceStream");
  const bigEv = new Uint8Array(nodeCrypto.randomBytes(2 * stream.STREAM_CHUNK_BYTES + 12345));
  const streamed = await storeEvidence(bytesSource(bigEv), "document");
  assert(streamed.sha256 === (await sha256Hex(bigEv)), "streamed hash must equal a one-shot sha256");
  const [streamedUp] = await uploadAllEvidence([streamed]);
  const evKey = await evidenceKey(streamed);
  assert(Buffer.from(evKey).compare(Buffer.from(deviceKey)) !== 0, "each item must have its own key");
  const parts: Uint8Array[] = [];
  const hdr = await readUploadedEvidence(streamedUp, evKey, (p: Uint8Array) => void parts.push(p));
  assert(hdr.chunkCount === 3, "2 chunks + a tail must be three chunks");
  assert(Buffer.concat(parts).equals(Buffer.from(bigEv)), "streamed evidence must decrypt to the original bytes");
  for (const b of await Promise.all([...memStore.values()])) {
    assert(!b.includes(Buffer.from(bigEv.subarray(0, 64)).toString("hex")), "no plaintext may reach storage");
  }

  const sh = stream.newStreamHeader(3 * 16, 16);
  const c = [0, 1, 2].map((i) => stream.sealChunk(sh, evKey, i, bigEv.subarray(i * 16, i * 16 + 16)));
  assert(await fails(() => stream.openChunk(sh, evKey, 0, c[1])), "a reordered chunk must not authenticate");
  const truncated = { ...sh, chunkCount: 2, sizeBytes: 32 };
  assert(await fails(() => stream.openChunk(truncated, evKey, 1, c[1])), "dropping the tail must be detected");
  const otherFile = stream.newStreamHeader(3 * 16, 16);
  assert(await fails(() => stream.openChunk(otherFile, evKey, 0, c[0])), "a chunk from another file must not authenticate");

  // A connection that drops partway must resume, not restart: after one
  // chunk lands and the second put fails, the retry sends only the rest.
  const resumable = await storeEvidence(bytesSource(bigEv), "document");
  const liveStore = getContentStore();
  const realPut = liveStore.put.bind(liveStore);
  let puts = 0;
  liveStore.put = async (b: unknown) => {
    if (++puts === 2) throw new Error("circuit dropped");
    return realPut(b);
  };
  assert(await fails(() => uploadAllEvidence([resumable])), "the injected drop must surface");
  puts = 0;
  liveStore.put = async (b: unknown) => {
    puts++;
    return realPut(b);
  };
  const [resumed] = await uploadAllEvidence([resumable]);
  liveStore.put = realPut;
  assert(puts === 3, `a resumed upload must send 2 remaining chunks + manifest, sent ${puts}`);
  const resumedParts: Uint8Array[] = [];
  await readUploadedEvidence(resumed, await evidenceKey(resumed), (p: Uint8Array) => void resumedParts.push(p));
  assert(Buffer.concat(resumedParts).equals(Buffer.from(bigEv)), "a resumed upload must still round-trip");
  await deleteEvidence(resumable);

  // A legacy item whose upload fails after re-sealing must still be
  // uploadable on retry from the *old* item — that is what a failed publish
  // leaves saved on the report.
  const legacyBytes = bigEv.subarray(0, 3000);
  const legacyItem = {
    id: "ev_legacy2",
    kind: "photo",
    encryptedUri: "khabardar.evidence.ev_legacy2",
    sha256: await sha256Hex(legacyBytes),
    sizeBytes: legacyBytes.length,
    addedAt: 1,
  };
  await asyncStorageStub.setItem(legacyItem.encryptedUri, JSON.stringify(encrypt(legacyBytes, deviceKey)));
  liveStore.put = async () => {
    throw new Error("circuit dropped");
  };
  assert(await fails(() => uploadAllEvidence([legacyItem])), "the injected drop must surface");
  liveStore.put = realPut;
  const [legacyRetry] = await uploadAllEvidence([legacyItem]);
  assert(!!legacyRetry.cid && legacyRetry.addedAt === 1, "a legacy retry must find the copy re-sealed last time");
  await deleteEvidence(legacyItem);
  assert(![...memStore.keys()].some((k) => k.includes("ev_legacy2")), "deleting a legacy item must take its re-sealed copy");

  await deleteEvidence(streamed);
  assert(
    ![...memStore.keys()].some((k) => k.includes(streamed.id)),
    "deleting a streamed item must remove its header and every chunk"
  );
  console.log("5c. streamed evidence           : 3 chunks round-trip; reorder/truncate/swap refused (OK)");
  console.log("    dropped upload               : resumed, legacy retry survives (OK)");

  // 5d. A reader holding only what a Public report publishes — its CID and
  // keyring — must be able to open the evidence. Before per-item keys this
  // failed: evidence was sealed under a key that never left the device.
  const { publishReport } = require("../src/submitReport");
  const { resolveContentKey } = require("../src/content/contentKeys");
  await require("../src/identity").createIdentity();
  const pubItem = await storeEvidence(bytesSource(bigEv.subarray(0, 5000)), "photo");
  const published = await publishReport({
    id: "rep_verify",
    status: "draft",
    category: 0,
    visibility: 0,
    body: "evidence must be readable by whoever can read the report",
    coarseGeohash: "tsj9",
    entityName: "",
    evidence: [pubItem],
    createdAt: Date.now(),
  });
  const storedReport = await getContentStore().get(published.cid);
  const reportKey = resolveContentKey(storedReport.keyring);
  const readerBundle = JSON.parse(bytesToUtf8(decrypt(storedReport.blob, reportKey)));
  const ev0 = readerBundle.evidence[0];
  assert(typeof ev0.key === "string" && ev0.key.length === 64, "the bundle must carry the item key");
  const readerParts: Uint8Array[] = [];
  await readUploadedEvidence(ev0, Buffer.from(ev0.key, "hex"), (p: Uint8Array) => void readerParts.push(p));
  assert(
    Buffer.concat(readerParts).equals(Buffer.from(bigEv.subarray(0, 5000))),
    "a reader must recover the evidence from the published report alone"
  );
  // The key above is public, so a hostile gateway can seal substitute
  // evidence that GCM accepts. The bundle's fingerprint must catch it, and a
  // forged size must be refused before anything is downloaded.
  const forged = await storeEvidence(bytesSource(new Uint8Array(5000).fill(7)), "photo");
  const [forgedUp] = await uploadAllEvidence([forged]);
  const forgedKey = await evidenceKey(forged);
  const forgedEntry = { ...ev0, cid: forgedUp.cid };
  assert(
    await fails(() => readUploadedEvidence(forgedEntry, forgedKey, () => undefined)),
    "substitute evidence under a valid key must fail the report's fingerprint"
  );
  let fetchedChunks = 0;
  assert(
    await fails(() =>
      readUploadedEvidence({ ...ev0, sizeBytes: ev0.sizeBytes + 1 }, Buffer.from(ev0.key, "hex"), () => {
        fetchedChunks++;
      })
    ) && fetchedChunks === 0,
    "a size mismatch must be refused before any chunk is fetched"
  );
  await deleteEvidence(forged);

  // publishReport mirrors its row into the local feed; later steps start from an empty one.
  await require("../src/feed/localChainMirror").clearMirror();
  console.log("5d. evidence via public report  : opened with the bundle's key only (OK)");

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

  // 10b. The social layer must not leak into the evidentiary one. This is the
  // property most likely to erode by accident: someone adds a "score" that
  // quietly folds reactions into credibility, and a report accusing a popular
  // figure starts reading as less true because fewer people liked it.
  const social = require("../src/social");

  const SOCIAL_REPORT = 77;
  const ACTOR = "0x5555555555555555555555555555555555555555";

  await social.react(SOCIAL_REPORT, ACTOR, social.ReactionKind.Important);
  const counts = await social.reactionsFor(SOCIAL_REPORT);
  assert(counts[social.ReactionKind.Important] === 1, "a reaction must be recorded");

  // Reactions live in their own store and touch nothing the chain mirror holds.
  const mirrored = (await readMirror()).find(
    (r: { onChainReportId: number }) => r.onChainReportId === SOCIAL_REPORT
  );
  assert(!mirrored, "reactions must not create or alter a chain-mirror row");
  assert(
    typeof (social as Record<string, unknown>).corroborate === "undefined",
    "the social module must expose no path to corroboration"
  );

  // One reaction per actor, replaceable — not an accumulating score.
  await social.react(SOCIAL_REPORT, ACTOR, social.ReactionKind.Support);
  const swapped = await social.reactionsFor(SOCIAL_REPORT);
  assert(
    swapped[social.ReactionKind.Important] === 0 && swapped[social.ReactionKind.Support] === 1,
    "an actor's reaction must replace, not stack"
  );

  // A comment reported as identity speculation disappears immediately rather
  // than waiting for review; the damage is done the moment it is read.
  const comment = await social.addComment({
    reportId: SOCIAL_REPORT,
    author: ACTOR,
    body: "pretty sure this is someone from the accounts department",
  });
  assert((await social.commentsFor(SOCIAL_REPORT)).length === 1, "comment posted");

  await social.reportComment(comment.id, social.CommentReportReason.IdentitySpeculation);
  assert(
    (await social.commentsFor(SOCIAL_REPORT)).length === 0,
    "identity speculation must hide on sight, not queue"
  );

  // Codenames are derived, never chosen: a handle someone picks travels between
  // platforms and collapses the anonymity model into a search query.
  const profile = social.profileFor(ACTOR, { codename: "mumbai_accountant" });
  assert(
    profile.codename !== "mumbai_accountant",
    "a profile must not accept a chosen handle"
  );
  assert(profile.followListVisible === false, "follow lists must be private by default");

  console.log(
    "10b. social layer boundary       :",
    "reactions isolated, identity-speculation auto-hidden, codename derived (OK)"
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

  // 14. Karma must not invent a number. A missing registry, or a failed read,
  // is `null` — never `0`, which is a real on-chain value and would understate
  // a reporter's standing if we used it as a fallback.
  const { readKarma } = require("../src/karma");
  const prevRegistry = process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS;
  delete process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS;
  const unknown = await readKarma(account.address);
  assert(unknown === null, "karma without a registry must be unknown, not zero");
  if (prevRegistry === undefined) delete process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS;
  else process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS = prevRegistry;
  console.log("14. karma read                  : unknown without a registry (OK)");

  // 15. "Journalists only" must not be presented as real while the keys are
  // placeholders. The help text and review warning both key off this flag.
  const { journalistKeysArePlaceholders } = require("../src/content/recipients");
  assert(
    journalistKeysArePlaceholders() === true,
    "placeholder journalist keys must still be flagged as placeholders"
  );
  console.log("15. journalist keys             : flagged as placeholders (OK)");

  // 16. Vanilla bridges are accepted; obfuscated transports are refused by
  // name rather than handed to Arti to fail later with nothing useful.
  const { parseBridgePaste } = require("../src/net/bridges");
  const vanilla = parseBridgePaste(
    "# comment\nBridge 192.0.2.55:443 7DD62766BF2052432051D7B7E08A22F7E34A4543\n"
  );
  assert(vanilla.errors.length === 0, "a vanilla bridge line must be accepted");
  assert(vanilla.vanilla.length === 1, "the Bridge prefix must be optional");
  const obfs = parseBridgePaste(
    "obfs4 192.0.2.55:38114 7DD62766BF2052432051D7B7E08A22F7E34A4543 cert=abcd iat-mode=0"
  );
  assert(obfs.vanilla.length === 0, "an obfs4 line must not be treated as vanilla");
  assert(
    obfs.errors.some((e: string) => e.includes("obfs4") && e.includes("do not ship")),
    "the refusal must name the transport and say why"
  );
  const unknownPt = parseBridgePaste("dnstt 192.0.2.55:53 7DD62766BF2052432051D7B7E08A22F7E34A4543");
  assert(
    unknownPt.vanilla.length === 0 && unknownPt.errors.some((e: string) => e.includes("dnstt")),
    "a transport not on the list must still be refused by name"
  );
  const junk = parseBridgePaste("hello world\n192.0.2.55:443 notafingerprint\n[2001:db8::1]:443");
  assert(junk.vanilla.length === 0 && junk.errors.length === 3, "malformed lines must be refused");
  const v6 = parseBridgePaste("[2001:db8::1]:443 7DD62766BF2052432051D7B7E08A22F7E34A4543");
  assert(v6.errors.length === 0 && v6.vanilla.length === 1, "a bracketed IPv6 bridge must be accepted");
  console.log("16. bridge paste                : vanilla kept, obfs4 refused (OK)");

  // 17. A tip upload must isolate first, same as a report, and the mock
  // store must not be reported as a network delivery.
  torStub.available = true;
  torStub.state = "running";
  torStub.socksPort = 9150;
  torStub.circuitRotations = 0;
  const { sendTip, getRecipient } = require("../src/tips");
  const tipRecipient = getRecipient("demo-newsroom");
  assert(!!tipRecipient, "demo recipient must exist for the tip path");
  const sentTip = await sendTip("a sealed tip long enough to send", tipRecipient);
  assert(sentTip.status === "stored", "a mock-store tip is stored locally");
  assert(sentTip.simulated === true, "the mock store must not claim a network delivery");
  assert(torStub.circuitRotations === 1, "a tip must rotate the circuit before leaving");
  torStub.available = false;
  transportMod.setTransport(null);
  console.log("17. tip delivery                : isolated, marked local on mock store (OK)");

  // 18. What sits in the content store must not say who a tip is for. The
  // recipient finds it by trial decryption; nobody else learns the newsroom.
  const { secp256k1 } = require("@noble/curves/secp256k1");
  const { wrapContentKey, wrappedKeyring } = require("../src/content/contentKeys");
  const tipBundle = await getContentStore().get(sentTip.cid);
  const tipWire = JSON.stringify(tipBundle);
  assert(
    !tipWire.includes(tipRecipient.pubKey) && !tipWire.includes(tipRecipient.id) && !tipWire.includes(tipRecipient.name),
    "a stored tip must not name or key-identify its recipient"
  );
  const privA = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");
  const privB = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");
  const pubOf = (p: string) => Buffer.from(secp256k1.getPublicKey(Buffer.from(p, "hex"), true)).toString("hex");
  const ck = cryptoStub.getRandomBytes(32);
  const ring = wrappedKeyring(ck, [
    { id: "a", pubKey: pubOf(privA) },
    { id: "b", pubKey: pubOf(privB) },
  ]);
  const openedA = resolveContentKey(ring, privA);
  assert(!!openedA && Buffer.from(openedA).equals(Buffer.from(ck)), "recipient A must find its wrap by trial");
  const outsider = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");
  assert(resolveContentKey(ring, outsider) === null, "a non-recipient must open nothing");
  // A wrap made for A must not open for B even if relabelled — the KDF binds both keys.
  const forA = wrapContentKey(ck, pubOf(privA));
  assert(resolveContentKey({ mode: "wrapped", recipients: [forA] }, privB) === null, "a wrap must open only for its key");

  // Bundles from older builds (v1: named, unbound KDF) must still open.
  const { hkdf } = require("@noble/hashes/hkdf");
  const { sha256: sha256Fn } = require("@noble/hashes/sha256");
  const { gcm: gcmFn } = require("@noble/ciphers/aes");
  const eph = secp256k1.utils.randomPrivateKey();
  const sharedV1 = secp256k1.getSharedSecret(eph, Buffer.from(pubOf(privA), "hex"), true);
  const kV1 = hkdf(sha256Fn, sharedV1.slice(1), undefined, new TextEncoder().encode("khabardar/content-key-wrap/v1"), 32);
  const nV1 = cryptoStub.getRandomBytes(12);
  const v1Wrap = {
    recipientId: "a",
    recipientPubKey: pubOf(privA),
    ephemeralPubKey: Buffer.from(secp256k1.getPublicKey(eph, true)).toString("hex"),
    nonce: Buffer.from(nV1).toString("hex"),
    ciphertext: Buffer.from(gcmFn(kV1, nV1).encrypt(ck)).toString("hex"),
  };
  const openedV1 = resolveContentKey({ mode: "wrapped", recipients: [v1Wrap] }, privA);
  assert(!!openedV1 && Buffer.from(openedV1).equals(Buffer.from(ck)), "a v1 wrap must still open");
  console.log("18. recipient anonymity         : wraps unnamed, trial-opened, v1 still readable (OK)");

  console.log("\n✅ ALL SLICE STEPS PASSED — compose → encrypt → hash → encode → sign → gasless submit\n");
}

main().catch((e) => {
  console.error("\n❌ SLICE VERIFICATION FAILED\n", e);
  process.exit(1);
});
