# Khabardar (खबरदार)

Anonymous anti-corruption reporting. Compose a report, attach evidence, and anchor a
tamper-proof fingerprint of it on the Linea blockchain — without revealing who you are,
without holding any cryptocurrency, and without the app ever learning your name, phone
number, or email.

> **Status: v0 scaffold.** The app shell, anonymity primitives, contracts, and one
> end-to-end slice (compose → encrypt/hash → gasless submit) are wired. Several
> features are deliberate stubs — see [Roadmap](#roadmap--current-stubs).

---

## Monorepo layout

```
khabardar/
├── apps/
│   └── mobile/            # Expo (React Native) app — iOS, Android, web preview
│       ├── app/           # expo-router screens
│       └── src/           # identity, crypto, evidence, relayer, i18n
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
  bundle), category, coarse geohash, timestamp, pseudonymous reporter address. A
  moderator role (v0: single address; later: karma-weighted jury) marks reports
  credible, adjusting reporter karma.

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

## Getting started

Prereqs: Node 20 (`.nvmrc`), npm 10.

```bash
npm install                    # installs all workspaces

# Contracts
npm run contracts:compile
npm run contracts:test         # 5 passing

# Mobile app (mock relayer — no credentials needed)
npm run mobile:web             # web preview in browser
npm run mobile:start           # QR code for Expo Go on a device

# Headless smoke test of the whole submission slice (no simulator/Metro needed)
npm run verify:slice --workspace apps/mobile
```

`verify:slice` runs the real `cryptoUtils` / `encoding` / `MockRelayer` modules
under Node (with `expo-crypto` shimmed to Node's `crypto`) and asserts the full
path: encrypt → decrypt round-trip → deterministic keccak256 fingerprint →
ABI-encoded `submitReport()` calldata → device-key signature → relay result.
It's the fastest way to confirm the chain-facing logic still works, and is CI-safe.

Try the end-to-end slice: create identity → New report → fill category/body/area →
Review & submit → watch it "anchor" (simulated tx via MockRelayer) → status screen
shows the report fingerprint + tx hash.

To go against the real testnet, follow [gasless setup](#gasless-flow-nobody-holds-eth)
and copy `.env.example` → `.env`.

## i18n

English + Hindi (`apps/mobile/src/i18n/`). Locale auto-detects from the device and can
be switched in Settings. All UI strings go through `t()` — add a language by dropping a
new JSON file.

## Roadmap / current stubs

- **Moderation workflow** — screen stub; contract has single-moderator `verifyReport`.
  Next: karma-weighted jury, moderator dashboard reading `ReportSubmitted` events.
- **Tip channel to journalists/NGOs** — screen stub. Next: recipients publish an
  X25519 public key; tips sealed on-device, delivered over anonymising transport.
- **Tor/onion transport** — not yet wired. Next: route relayer + RPC traffic through
  Tor (Arti has mobile bindings) or an onion-routed proxy; SecureDrop treats this as
  non-negotiable and so should we before any mainnet launch.
- **RLN rate limiting** — borrow Status Network's Rate-Limiting Nullifier pattern so
  one device can't flood the sponsored endpoint (protects the paymaster budget and
  feed quality without identifying users).
- **Evidence storage** — v0 keeps encrypted blobs in AsyncStorage; production should
  use expo-file-system streaming encryption + upload of encrypted bundles to
  operator-run storage (the on-chain hash commits to the bundle either way).
- **Audio/document evidence** — photo pipeline is wired; audio/docs follow the same
  strip → encrypt → hash path.
- **Offline drafts** — drafts already work offline (local encrypted storage);
  submission queueing/retry on reconnect is not yet automatic.

## Security & threat-model caveats (v0)

- The web build's SecureStore fallback is localStorage — **dev preview only**.
- `MockRelayer` fabricates tx hashes; nothing is on-chain until a real relayer is configured.
- A single moderator address is a centralization point — acceptable for testnet only.
- No security audit has been performed. Do not use for real reports yet.
