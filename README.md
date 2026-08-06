# Khabardar (खबरदार)

Anonymous anti-corruption reporting. Compose a report, attach evidence, and anchor a
tamper-proof fingerprint of it on the Linea blockchain — without revealing who you are,
without holding any cryptocurrency, and without the app ever learning your name, phone
number, or email.

> **Status: v0.** Working end-to-end: compose → encrypt → upload to the content layer →
> anchor hash + CID via a gasless transaction → read back in a public feed with an
> integrity check. Also wired: entity clustering, a moderation review queue, an
> encrypted tip channel, BIP-39 recovery, and an optional WalletConnect identity.
> The relayer and content store default to local mocks so everything runs with **no
> credentials**. See [Roadmap](#roadmap--current-stubs) for what is still missing.

---

## Monorepo layout

```
khabardar/
├── apps/
│   └── mobile/            # Expo (React Native) app — iOS, Android, web preview
│       ├── app/           # expo-router screens (feed, compose, moderation, tips, …)
│       └── src/
│           ├── content/   # encrypted blob store (IPFS/mock) + ECIES key wrapping
│           ├── feed/      # network index, demo seed, fetch+decrypt+integrity check
│           ├── relayer/    # gasless submission (mock / Pimlico)
│           ├── wallet/     # optional WalletConnect v2
│           └── …          # identity, recovery, crypto, evidence, moderation, tips, i18n
├── packages/
│   ├── contracts/         # Hardhat + Solidity (ReportRegistry.sol) → Linea
│   └── shared/            # chain config, ABI, TypeScript types shared app↔contracts
├── .env.example           # every env var documented
└── package.json           # npm workspaces root
```

## Why React Native (Expo) and not Flutter

Both are fine cross-platform frameworks; the deciding factor is the **blockchain layer**:

1. **The entire Ethereum/AA toolchain is TypeScript-first.** viem, permissionless.js,
   Pimlico/thirdweb/Biconomy SDKs — all TS. Dart bindings (web3dart) lag badly on
   ERC-4337/EIP-7702 support; we would end up hand-rolling UserOperation plumbing.
2. **One language across the monorepo.** The app imports the contract ABI and types
   directly from `@khabardar/shared`; contract changes surface as compile errors in the
   app.
3. **Expo's security-relevant modules** (SecureStore → Keychain/Keystore, expo-crypto,
   ImageManipulator for EXIF-free re-encode) cover our anonymity primitives out of the
   box, plus EAS OTA updates let us ship security fixes without store review delays.

## Architecture

### Anonymity model (prior art: GlobaLeaks / SecureDrop)

The design borrows two principles from GlobaLeaks and SecureDrop, the reference
implementations for anonymous whistleblowing:

- **The platform must not be able to deanonymize its users** (SecureDrop: no accounts,
  source codenames, Tor-only). Khabardar's analogue: no signup, a **device-bound
  secp256k1 keypair** generated locally in the secure enclave/Keystore is the entire
  identity. The UI shows a derived codename (e.g. `silent-heron-42`), never the address.
- **Metadata is as dangerous as content** (GlobaLeaks strips file metadata server-side;
  SecureDrop sanitizes documents). Khabardar strips **client-side, before anything is
  stored**: photos are re-encoded through expo-image-manipulator (EXIF/GPS/device tags
  do not survive re-encode), the picker is called with `exif: false`, and Android
  location permissions are **blocked in the manifest** so precise geolocation cannot
  even be requested.

Concrete guarantees in this scaffold:

| Threat | Mitigation |
|---|---|
| Identity leakage at signup | No PII collected — device keypair only (`src/identity.ts`) |
| EXIF/GPS in evidence | Re-encode pipeline (`src/evidence.ts`) |
| Precise location in report | Geohash hard-capped at 4 chars ≈ city level (`src/geo.ts`) |
| Device seizure | AES-256-GCM at rest + **panic delete** wipes drafts, evidence, keys, identity (`src/panic.ts`) |
| Content on a public chain | Only `keccak256` fingerprints go on-chain, never content |
| Network observation | **Future work:** Tor/onion or mixnet transport (see Roadmap) |

### Blockchain layer (Linea)

- **Chains:** Linea Sepolia testnet (`59141`) now; Linea mainnet (`59144`) later.
- **Why Linea:** post-Pectra Linea supports **EIP-7702** natively and serves ERC-4337
  bundler methods on `rpc.linea.build`; the AA provider ecosystem (Pimlico, thirdweb,
  Etherspot, Biconomy, Arka) is first-class. Status Network — previously the "gasless
  L2" on the Linea stack — **merged into Linea (April 2026)**, so we build against
  Linea directly and borrow Status's ideas rather than their SDK:
  - **Karma:** non-transferable reputation (`ReportRegistry.karma`) — credibility that
    cannot be bought or transferred, only earned through verified reports.
  - **RLN-style rate limiting:** planned — sybil-resistant per-epoch submission limits
    to keep a gasless endpoint spam-free (see Roadmap).
- **`ReportRegistry.sol`** stores per report: `reportHash` (fingerprint of the encrypted
  bundle), `cid` (pointer to that bundle in the content layer), category, visibility,
  verification tier, coarse geohash, blinded `entityTag`, timestamp, and the
  pseudonymous reporter address. A moderator role (v0: single address; later:
  karma-weighted jury) sets the tier, adjusting reporter karma.

### Content layer — how reports become readable

The chain holds a hash and a pointer; the bytes live elsewhere. Without this, a report
is a diary entry nobody else can read.

| Layer | Holds |
|---|---|
| Device | plaintext, only while composing |
| Content store (IPFS/Arweave) | the **encrypted** bundle + evidence blobs |
| Chain | `reportHash` + `cid` + coarse metadata |

Each report gets a **fresh content key**. What happens to that key is the whole
visibility model:

- **Public** — the key is published in the bundle's keyring, so anyone can read it.
- **Journalists only** — the key is wrapped per recipient with **ECIES**
  (ephemeral secp256k1 ECDH → HKDF-SHA256 → AES-256-GCM). Only a listed private key
  opens it; everyone else sees the report as locked.

Because `reportHash` covers the *encrypted* bundle, any reader can recompute it and
compare against the chain. The feed does this on every fetch and shows
`⚠️ Content does NOT match the on-chain fingerprint` when it fails — so a hostile
gateway that swaps or edits a bundle is detected rather than believed. Malformed
responses degrade to "unavailable" instead of throwing, so a bad gateway cannot crash
the reader either.

`EXPO_PUBLIC_CONTENT_STORE` selects `mock` (default, local, no credentials) or `ipfs`.

### Linking reports without deanonymizing anyone

Several people reporting the same office is the strongest signal the system has. Doing
that naively means publishing the accused entity's name on-chain.

Instead, the entity name **stays on the device** and only
`keccak256("khabardar/entity-tag/v1" | normalized(name))` is published. Identical
entities produce identical tags, so reports cluster (`reportsForEntity`), while the tag
itself carries nothing about who filed it. Normalization is aggressive, so
`"Block Development Office, Sitapur"` and `"block development office sitapur"` collide.

**Honest limit:** this is not hiding the entity from a determined observer — the set of
public offices is enumerable, so tags are reversible by dictionary attack. That is an
accepted trade-off: *the accused is not the secret, the reporter is.* What it does buy
is keeping entity names out of restricted reports entirely and out of casual chain
scraping.

Separately, `corroborate(reportId)` lets a witness back a report; the contract blocks
self-corroboration and double-voting, and auto-promotes to `CommunityCorroborated` at
3 independent corroborations.

### Sybil resistance, applied asymmetrically

Three attacks, three defences, and — the part that matters — they are **not** applied to
the same place:

| Attack | Defence | Applied to |
|---|---|---|
| Flood the gasless endpoint | Per-epoch submission cap (10/day/account) | `submitReport` |
| Sybil the witness set | `IPersonhoodGate` | `corroborate` |
| Capture the moderator | Karma-weighted jury | tier verdicts |

Note what is deliberately absent: **there is no personhood check on `submitReport`.**
Requiring anyone to prove who they are before reporting corruption would rebuild the
identity chokepoint this whole design exists to remove, and would exclude exactly the
people least able to obtain credentials. Reporting stays open to any address; only
*vouching for someone else* is gated, because that is where sybils actually buy something.

`AllowlistPersonhoodGate` is a working implementation, and honest about being
non-anonymous — the operator learns who they admitted, which is fine for a closed pilot
with known participants and unacceptable where a corroborator faces real risk. RLN is the
endgame and needs a zk verifier that is not in this repo. With no gate configured (the
default) corroboration is not sybil-resistant at all.

### Identity: three options, one default

| Mode | How | Anonymity |
|---|---|---|
| **Device key** (default) | secp256k1 key generated on-device from a BIP-39 phrase | Strongest — tied to nothing else |
| **Recovery phrase** | Same key, restorable on a new device from 12 words | Same as above |
| **WalletConnect** (opt-in) | Sign with an external wallet | **Weaker** — see below |

There is deliberately **no email/phone login**. An auth provider is one subpoena away
from deanonymizing every reporter; a BIP-39 phrase gives the same "don't lose
everything with your phone" benefit with nothing held by anyone but the user.

**WalletConnect** is available for people who already manage keys, but it is never the
default and never required. The screen shows an unmissable warning *above* the connect
control, because a reused wallet carries a public history — exchange withdrawals tie it
to KYC, and reusing it later can retroactively expose past reports. Requires
`EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`; without it the screen says so and the device key
keeps working.

### Gasless flow (nobody holds ETH)

```
device keypair ──owns──▶ counterfactual smart account (SimpleAccount)
      │                             │
      │ signs userOpHash            │ sender of UserOperation
      ▼                             ▼
UserOperation{ callData: submitReport(hash, category, geohash) }
      │
      ├─▶ pm_sponsorUserOperation  (Pimlico verifying paymaster — sponsor pays)
      └─▶ eth_sendUserOperation    (Pimlico bundler → EntryPoint v0.7 on Linea)
```

The relayer is an interface (`src/relayer/`) with two implementations:

- **`MockRelayer` (default):** runs the identical encode → sign pipeline, then simulates
  the bundler locally. No network, no credentials. This is what the scaffold demo uses.
- **`PimlicoRelayer`:** real integration points against Pimlico's bundler/paymaster
  JSON-RPC on Linea Sepolia, env-gated. Written against raw `pm_sponsorUserOperation` /
  `eth_sendUserOperation` so the protocol surface is explicit; swap in permissionless.js
  to productionize.

**What a real gasless setup needs** (~15 min):

1. Create an API key at [dashboard.pimlico.io](https://dashboard.pimlico.io).
2. Add a **sponsorship policy** scoped to your deployed `ReportRegistry` address
   (so the paymaster only ever sponsors report submissions), and fund it.
3. Deploy the contract: `npm run contracts:deploy:sepolia` (needs
   `DEPLOYER_PRIVATE_KEY` + Sepolia ETH from the [Linea faucet](https://docs.linea.build/get-started/how-to/get-testnet-eth)).
4. Set in `.env`: `EXPO_PUBLIC_GASLESS_PROVIDER=pimlico`,
   `EXPO_PUBLIC_PIMLICO_API_KEY`, `EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS`.
5. Finish the two marked TODOs in `pimlicoRelayer.ts` (counterfactual account
   derivation + receipt polling) — or replace the class body with permissionless.js's
   `createSmartAccountClient`, which handles both.

Alternative providers (same interface, different config): thirdweb, Etherspot Prime,
Biconomy, or self-hosted [Arka](https://github.com/etherspot/arka) if operator
independence from a commercial paymaster is required — likely the right endgame for an
anti-corruption tool.

### Privacy note on sponsored gas

A paymaster sees the UserOperations it sponsors (sender address, calldata, IP of the
submitting client). Since calldata is only ever a hash + category + coarse geohash,
content stays private, but **network-level anonymity (Tor) is required before mainnet**
to prevent IP↔pseudonym linkage by relayer infrastructure.

### Sponsored gas pools and attribution

Organizations can fund submission gas for a region or category
(`packages/shared/src/sponsor.ts`, `apps/mobile/src/sponsorPools.ts`). Reporters never
see a payment step; the pool only decides who reimburses the paymaster.

**Attribution is aggregate only, by design.** A per-report sponsor tag would be a side
channel: a narrowly-scoped sponsor would shrink a report's anonymity set below what the
reporter consented to by publishing a coarse geohash. So `sponsorPoolId` travels as
paymaster accounting context and is deliberately *excluded from calldata*, sponsors
receive counts rather than per-report ledgers, and any pool below `MIN_SCOPE_REPORTS`
(50) goes unnamed in the UI even though it still pays.

### Organizations — the accountable side

`Organization` (`packages/shared/src/org.ts`, `apps/mobile/src/org.ts`) is a **named**
account for newsrooms, NGOs, oversight bodies, researchers, and funders. It is stored
under separate keys, with a separate lifecycle, from reporter identity, and the two are
never returned together — an org account is billable and contactable, a reporter account
is a device key and nothing else. Joining them would break the product's central
guarantee.

Accreditation is not self-serve: a new org gets Community entitlements regardless of
selected plan until a human verifies it, because analytics over a whistleblower corpus
should never be one signup form away. Plans and entitlements gate corpus export
(`apps/mobile/src/export.ts`), which excludes restricted reports and never exports
reporter addresses.

**Seats and API keys.** Seats carry a role (`admin` / `member` / `viewer`, the last
read-only and excluded from export) and revoked seats are kept with a `revokedAt` rather
than deleted — "who had access to this corpus, and when" is a question an org will
eventually have to answer, and a deleted row cannot answer it. API keys store only a
prefix and a SHA-256 hash, so the secret is shown once and a stolen database yields no
working credentials.

**Analytics** (`/analytics`) suppresses any bucket below 5 reports rather than rounding
it. Aggregates over a whistleblower corpus are *more* dangerous than individual reports:
"three bribery reports in geohash tsj9 this month" sounds anonymous and is not, because
three is a small enough set for someone with local knowledge to start guessing.
Suppressed buckets are counted and reported, so an analyst sees that data was withheld
rather than concluding a region is clean. There are no per-reporter statistics of any
kind — not even counts.

**Case management** (`/cases`) groups reports, tracks what was done, and records the
outcome. Outcomes are the point: reports filed is an activity metric, investigations
concluded is a result, and `outcomeSummary()` is the number that belongs in a grant
report. Cases reference report *ids* only, never content, and carry no reporter
identifier anywhere in the model.

**Non-payment removes capability, never data.** A lapsed account drops to Community
entitlements after a 30-day grace period and keeps everything. Cutting a newsroom off
from its case notes mid-investigation is a way to get someone hurt.

See [BUSINESS.md](./BUSINESS.md) for the revenue model, unit economics, and a
completed / in-progress / not-started status breakdown.

## Getting started

Prereqs: Node 20 (`.nvmrc`), npm 10.

```bash
npm install                    # installs all workspaces

# Contracts
npm run contracts:compile
npm run contracts:test         # 48 passing

# Mobile app (mock relayer — no credentials needed)
npm run mobile:web             # dev server with hot reload
npm run mobile:start           # QR code for Expo Go on a device

# Static web build — no file watcher, always starts (see Troubleshooting)
npm run web:export  --workspace apps/mobile
npm run web:static  --workspace apps/mobile   # serves dist/ on :8085

# Headless smoke test of the whole submission slice (no simulator/Metro needed)
npm run verify:slice --workspace apps/mobile
```

### Web demo deployment (Vercel)

`vercel.json` at the repo root builds `apps/mobile/dist` and serves it as an SPA.

```bash
npx vercel deploy          # preview URL
npx vercel deploy --prod   # production alias
```

**The web build is a demonstration and the deployment is configured to keep it that
way.** Three of the app's guarantees do not exist in a browser:

| Guarantee | Why it is absent on web |
|---|---|
| Keys in secure hardware | No Keychain/Keystore — the identity key, at-rest keys and stealth PINs fall back to `localStorage`, readable by any extension or XSS |
| Tor | A browser cannot load the native module; every request leaves from the visitor's real IP |
| Panic delete | Clears `localStorage`, but cannot reach a browser profile, sync, or backup that already copied those values |

So the deployment does two things beyond serving files. `WebDemoGate` shows an
unmissable interstitial before anything else on web — a gate rather than a dismissible
banner, because someone who has started typing has already made the decision the banner
was meant to inform. And `X-Robots-Tag: noindex` plus `robots.txt` keep it out of search
results: a person searching for a way to report corruption safely must not *find* this
and trust it, which is the precise failure the project exists to prevent.

`Referrer-Policy: no-referrer` is set for the same reason — an anonymity tool should not
announce itself as the origin when a visitor follows an outbound link.

`.vercelignore` excludes the Rust build directory (5.4 GB) and `node_modules` (874 MB).
Both are gitignored and the CLI would likely skip them anyway, but a silent
multi-gigabyte upload is not a failure worth leaving to chance.

`verify:slice` runs the real `cryptoUtils` / `encoding` / `evidence` / `content` /
`MockRelayer` / `tips` / `moderation` modules under Node (with `expo-crypto`,
AsyncStorage, SecureStore and the native picker modules shimmed) and asserts the full
path: encrypt → decrypt round-trip → deterministic keccak256 fingerprint → blinded entity
tag → evidence upload returning a resolvable CID → ABI-encoded `submitReport()` calldata →
device-key signature → relay result. It additionally guards three properties that are
easy to regress silently:

- **Report ids stay unique across app restarts.** The mock relayer stands in for the
  contract's monotonic `reportCount`; an in-memory counter would restart at 0 on reload
  and two reports would share an id, which makes the feed open the wrong one.
- **Tip padding collapses different lengths onto one bucket**, and round-trips.
- **No single juror can reach quorum** — the cap must stay strictly below the threshold,
  or the jury quietly becomes a moderator again.

It's the fastest way to confirm the chain-facing logic still works, and is CI-safe.

### Troubleshooting: Metro hangs on Windows

On Windows **without Watchman**, Metro falls back to a recursive `fs.watch` watcher
that intermittently never finishes starting, failing after a 240-second timeout with:

```
Failed to construct transformer: Error: Failed to start watch mode.
```

This is not a project misconfiguration — `watchFolders` is already minimal (only
`packages/shared`; resolution uses `resolver.nodeModulesPaths`, which is not watched).
Two fixes, either works:

1. **Install Watchman** (recommended, what React Native expects):
   `winget install facebook.watchman`, then restart your shell so it lands on `PATH`.
   `.watchmanconfig` files at each watch root are already committed.
2. **Skip the watcher entirely** with `web:export` + `web:static` above. No hot reload,
   but it always starts — this is the reliable path for verification and screenshots.

Try the end-to-end slice: create identity → New report → fill category/body/area →
Review & submit → watch it "anchor" (simulated tx via MockRelayer) → status screen
shows the report fingerprint + tx hash.

To go against the real testnet, follow [gasless setup](#gasless-flow-nobody-holds-eth)
and copy `.env.example` → `.env`.

## i18n

English + Hindi (`apps/mobile/src/i18n/`). Locale auto-detects from the device and can
be switched in Settings. All UI strings go through `t()` — add a language by dropping a
new JSON file.

## Verification & moderation

Reports move through explicit tiers, and **nothing is presented as credible until it
has moved past `Unverified`**:

`Unverified → UnderReview → CommunityCorroborated → Verified` (or `Disputed`)

The review queue (`/moderation`) lists everything not yet adjudicated, oldest first,
with each report's integrity-check result.

### Karma-weighted jury

There is **no moderator address**. Verdicts come from a jury, and the contract has no
admin path to a tier — the admin seats and unseats jurors and nothing else. Four
properties, each of which exists to remove a specific failure:

| Property | Removes |
|---|---|
| A verdict needs 3 units of agreeing weight | One captured account deciding alone |
| Juror weight is capped at 2, below quorum | A high-karma juror becoming that account |
| Dissenting jurors lose 6 karma, agreeing gain 3 | Careless review having no cost |
| Every vote publishes its reason, before the outcome | Unaccountable reasoning |

That last one is the important one. `JuryVoteCast` carries the juror's stated reason
on-chain at the moment they vote, so the public can audit moderators with nothing but an
RPC endpoint — no trust in the operator required. A moderation system nobody can audit is
just censorship with extra steps.

A jury can move a report's **tier** and can **never edit or delete the report** — the
content hash is anchored, so moderation adds judgement on top of an immutable record.

Still unfinished, and it should not be glossed over: the in-app "act as a juror" toggle is
a **local dev affordance**, and the simulated peer jurors exist so a single device can
reach quorum in a demo. Both are labelled everywhere they appear and both must be deleted
before a real deployment. And a jury of three addresses controlled by one party is exactly
the centralization this replaced — the contract cannot detect that, only the people
seating jurors can.

On detecting AI-generated reports: **do not ship a naive AI-text detector.** They have
high false-positive rates on second-language English writers, which describes a large
share of the intended users — it would systematically silence exactly the people this
exists for. The defensible stack is provenance (C2PA capture signatures), personhood
(RLN / anonymous credentials), and corroboration. AI belongs in triage, never as judge.

## Tip channel

`/tips` sends an end-to-end encrypted message to a named journalist or NGO. Unlike a
report, a tip is **never anchored on-chain** — it is a private message, not a public
record. Sealing uses the same ECIES construction as restricted bundles, so only the
recipient's private key opens it, and only a short preview + digest stay on the device.

Three gaps to close before anyone relies on it, all documented in `src/tips.ts`:

- **Transport.** Tips are sealed but not delivered over an anonymising transport yet.
  Network metadata is what deanonymizes people, not ciphertext.
- **Padding.** Message length currently leaks; tips should be padded to fixed buckets.
- **Forward secrecy.** A recipient key compromise retroactively opens past tips.

Recipient keys in `src/content/recipients.ts` are **demo placeholders**. Production must
publish them somewhere independently verifiable (DNS TXT, a well-known URI on the
organisation's own domain, or an on-chain registry) and pin them in-app, so a compromised
backend cannot silently swap in its own key and read every restricted report.

## Surviving a seized phone

Every other protection here assumes the adversary is on the network. Stealth mode
(`/stealth`) assumes they are in the room, which for an anti-corruption reporter is the
ordinary case rather than the exotic one.

- **Duress PIN.** A second PIN that wipes everything and then opens the app as if it were
  new — no error, no confirmation, nothing an observer could read as a wipe having
  happened. When refusing to unlock is more dangerous than complying, the tool has to
  make complying safe.
- **Disguise.** The lock screen can be a working calculator. It has to actually
  calculate: a calculator that does not add up marks the phone as having something to
  hide, which is worse than no disguise at all.
- **Screenshot and app-switcher blocking**, on by default. Both operating systems
  snapshot the current screen, and a snapshot of a report is the report.

**What this cannot do**, stated plainly: a duress wipe does not defend against a forensic
image taken *before* the wipe, and it cannot recover data already copied. It makes a
seized-and-unlocked phone survivable. It does not make it safe to carry this app into a
search.

## Network egress and Tor

All outbound traffic — content store, relayer, RPC, indexer — goes through a single seam
(`src/net/transport.ts`), and the strongest available transport wins:

| Transport | Anonymised | Verified | When |
|---|---|---|---|
| **Tor** (`modules/expo-tor`) | yes | **yes** | native module present *and* Arti bootstrapped |
| HTTP proxy | claimed | no | `EXPO_PUBLIC_ANONYMISING_PROXY_URL` is set |
| Direct | no | no | otherwise |

`verified` is not decoration. It is true only for embedded Tor, because that is the one
case where the app owns the whole path — Arti runs in-process, we hold its SOCKS port, and
the platform HTTP client is pointed at that port and nothing else. A proxy that *claims* to
front Tor cannot be confirmed from inside the app, and Orbot's VPN mode is invisible to it
entirely. Reporting either as verified would be exactly the false assurance the seam exists
to prevent.

### Embedded Tor

`modules/expo-tor` runs **Arti** (Tor's Rust implementation) inside the app:

```
Arti (Rust, in-process)
  └── loopback SOCKS5 proxy on an ephemeral port
        └── OkHttp (Android) / URLSession (iOS)
              └── TorTransport → the same netFetch() every other module uses
```

Native code owns exactly one thing — running Arti and offering a SOCKS port — and the
platform HTTP stacks do the rest. Writing HTTP onto Arti's streams directly would have
meant reimplementing TLS, certificate validation, and HTTP/2 in Rust, badly, in the one
place where a mistake silently costs a user their anonymity.

Three properties worth knowing about:

- **No DNS leak.** Hostnames travel to the proxy as SOCKS5 `ATYP=0x03` and are resolved by
  the Tor exit. Both HTTP clients build *unresolved* socket addresses for SOCKS proxies,
  and OkHttp is additionally given a DNS resolver that refuses to answer. Resolving locally
  is the classic way to leak while "using Tor": the traffic is anonymised and the lookup
  that says exactly where you are going is not.
- **A fresh circuit per submission.** `publishReport()` calls `isolateNextRequests()`
  before any byte leaves. Two reports sharing a circuit share an exit relay and a timing
  pattern — enough to infer one author, even though each report is individually anonymous.
  The blinded entity tags and aggregate-only sponsor attribution elsewhere in this project
  exist to prevent that inference; letting the transport hand it back would waste the work.
- **No silent fallback.** When Tor is on and a request cannot go through it, the request
  fails. A transport that quietly degrades is worse than none, because the user has been
  told they are protected and has acted on it.

**Requires a development build or a release binary.** Expo Go and the web preview cannot
load native code, and in those builds `/network` says so in as many words rather than
implying protection that is not there.

```bash
# Rust core — protocol tests, no Tor network needed
npm run tor:test

# Cross-compile Arti (needs the Android NDK / Xcode)
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo install cargo-ndk
npm run tor:build:android
npm run tor:build:ios
```

Arti's state directory holds its **guard set** — the small number of entry relays the
client deliberately reuses to resist traffic analysis. The config plugin excludes it from
Android auto-backup and Android 12+ device transfer, and the iOS module marks it
`isExcludedFromBackup`. A guard set sitting in cloud storage is subject to legal process
and links every restore of that backup to the same user.

### The rest of the seam

- **Fail-closed policy.** Turn on "refuse unprotected connections" in `/network` and any
  request that would leave without an anonymising transport throws instead of leaking.
- **Egress accounting.** `/network` lists every host the app has contacted and why.
  "We never see your data" is a claim; a list the user can read is better than a claim.

## Roadmap / current stubs

- **Tor on a real network** — the transport is built and its protocol layer is tested, but
  it has never carried traffic over the live Tor network from a device. The SOCKS5 server
  is tested against a plain-TCP connector; Arti's own bootstrap and circuit handling are
  exercised only by Arti's test suite, not ours. Until someone runs a dev build on a phone
  and watches a report land, treat "works" as unproven.
- **Bridges and pluggable transports** — plain Tor is blocked in several of the places this
  app is for. Arti supports bridges and obfs4; the module does not configure them yet, so
  bootstrap simply fails where Tor is censored. This is the next thing to build.
- **RLN proof-of-personhood** — `IPersonhoodGate` is in the contract and corroboration is
  gated on it, with `AllowlistPersonhoodGate` as a working non-anonymous implementation
  for closed pilots. Real RLN needs a zk verifier contract and a prover, neither of which
  is here. Per-epoch submission rate limiting (the non-zk half) *is* enforced on-chain.
- **Forward secrecy for tips** — padding landed; a recipient key compromise still opens
  every past tip. Needs a ratchet or per-tip recipient subkeys.
- **Evidence at scale** — audio, documents and photos all encrypt and upload, but the
  path is `AsyncStorage` + base64 and capped at 8 MB. Video needs `expo-file-system`
  chunked reads with streaming AES-GCM.
- **C2PA provenance** — capture-time signatures for evidence authenticity. Not started;
  needs a signing cert chain, so it is real infrastructure rather than a code change.
- **Billing backend and public API** — the client-side model is built (seats, roles, API
  key issuance with hash-only storage, billing state with a grace period). There is no
  server: no payment processing, no API to serve, no server-side key verification. That
  is deliberate scope, not an oversight — it is a different deployment.
- **Languages beyond English and Hindi** — the i18n layer takes a new JSON file and
  nothing else. Not adding machine translations on purpose: mistranslated safety copy in
  an app for at-risk users is worse than English they have to work through.
- **Voice-first reporting** — audio evidence is wired; dictating a report needs
  speech-to-text, and an on-device model is the only version that does not ship a
  reporter's voice to a third party.
- **Independent security audit** — not performed, and cannot be self-served. This is a
  funding prerequisite, not a roadmap item.

## Security & threat-model caveats (v0)

- The web build's SecureStore fallback is localStorage — **dev preview only**.
- `MockRelayer` fabricates tx hashes and `MockContentStore` writes locally; nothing is
  on-chain or on IPFS until real providers are configured.
- **Tor is off by default and unproven on a real network.** It has to be started
  explicitly in `/network`, so an untouched install still connects directly. And while the
  transport is built and its SOCKS layer tested, no report has yet travelled over the live
  Tor network from a device — see the roadmap. Do not assume it works because it compiles.
- **Tor cannot start where Tor is blocked.** No bridge or pluggable-transport support yet,
  so in exactly the censored environments that need it most, bootstrap fails and the user
  is left choosing between a direct connection and no app.
- A build without the native module — Expo Go, web preview — cannot run Tor at all. It
  says so, but the distinction between "cannot protect you" and "is not protecting you
  right now" is easy to miss.
- Corroboration is sybil-resistant only to the degree the configured personhood gate is.
  With no gate set — the default — it is not sybil-resistant at all.
- Entity tags are reversible by dictionary attack — see the trade-off note above.
- The jury is only as independent as its seated members. A deployment that seats three
  addresses controlled by one party has the centralization the jury was meant to remove,
  and the contract cannot detect that.
- Simulated peer jurors, demo recipient keys, sample feed rows, and demo sponsor pools
  must all be removed before any real deployment.
- Org accreditation is a local flag; the dev toggle grants nothing on a real deployment,
  where accreditation belongs server-side next to the billing relationship.
- A PIN has very little entropy. It protects against someone picking up an unlocked
  phone, not against a forensic lab; the data's real protection is the OS keystore.
- No security audit has been performed. Do not use for real reports yet.
