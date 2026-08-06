# Khabardar — Business Case

**One line:** the corpus of corruption reports is a free public good; we charge the
institutions that act on it for the tooling, throughput, and assurance around it.

**Bottom line for an investor, up front:** this is a sustainable-small-organization
business, not a venture-scale one. Transparency International's entire global
federation — 100+ chapters — runs on €28M/year. The realistic ceiling here is a
$2–5M/year organization, reached slowly, with a large share of revenue from grants
and institutional contracts rather than seat expansion. If you are underwriting a
10–100× equity return, this is the wrong vehicle and you should stop reading. If you
are deploying impact capital, ecosystem funds, or foundation money against a
measurable governance outcome, the numbers below are defensible.

---

## 1. Status: what is actually built

Verified as of this commit: mobile typecheck clean, 71/71 contract tests passing,
headless end-to-end slice passing, web bundle builds.

### Completed and verified

| Area | What works |
|---|---|
| **Anonymity core** | Device-bound secp256k1 identity, no PII anywhere. Codename derived from address. AES-256-GCM encryption of bodies and evidence. EXIF/GPS stripped via re-encode before storage. Coarse geohash only (4 chars, district level). Panic delete wipes drafts, evidence, tips, jury log, chain mirror, submission queue, egress log, cases, org account, wallet session, stealth secrets, at-rest keys, and identity. |
| **Identity recovery** | BIP-39 12-word phrase, standard Ethereum derivation path, restore-on-new-device. Deliberately replaces login rather than complementing it. |
| **Chain layer** | `ReportRegistry.sol` on Linea (59144 / 59141). Anchors hash + CID + category + visibility + coarse geohash + blinded entity tag. Non-transferable karma. Corroboration with self-corroboration and double-vote blocking, auto-promotion at threshold. Five-state verification tier. Entity clustering. Per-epoch submission rate limiting. 71 tests. |
| **Moderation by jury** | An equal-weight, secret-ballot jury replaces the single moderator; there is no admin path to a verdict. Jurors commit a sealed ballot, then reveal it with a published reason, so nobody can see which way a panel is leaning while there is still time to join it. Every juror counts one, dissent costs nothing, a plurality is not a verdict, and the reporter can appeal once to a larger panel. Verdicts are auditable from an RPC endpoint alone via `JuryVoteRevealed`. |
| **Sybil resistance** | `IPersonhoodGate` gates corroboration, with `AllowlistPersonhoodGate` as a working implementation. Deliberately **not** applied to `submitReport` — reporting stays open to any address. Submission flooding is handled by rate limiting instead. |
| **Content layer** | Encrypted bundles to a `ContentStore` (mock + real IPFS pinning implementation). Per-report content key. ECIES key wrapping (secp256k1 ECDH → HKDF-SHA256 → AES-GCM) for journalist-restricted reports. Integrity check recomputes the hash against the on-chain anchor on every read. |
| **Public feed** | Browse, read, and verify others' reports. Filters: category, verification tier, region prefix, date range, entity cluster. Free-text search over readable bodies. Locked-report handling. Three interchangeable sources: mock, direct chain (chunked log scan), and a real indexer over HTTP. |
| **Evidence** | Photo (EXIF-stripped by re-encode), document, and audio, all through one strip → encrypt → hash → upload path. Plaintext audio deleted from cache after encryption. Metadata warnings surfaced before the picker opens, not after. |
| **Stealth** | PIN lock, duress PIN that wipes and then opens the app indistinguishably from a first launch, working-calculator disguise, screenshot and app-switcher blocking. |
| **Network** | Single egress seam for all traffic. Fail-closed switch that refuses unprotected requests rather than leaking. Per-host egress log surfaced to the user. |
| **Tor** | Arti compiled into the app (`modules/expo-tor`, Rust + JNI + Swift), exposing a loopback SOCKS5 proxy that OkHttp and URLSession route through. No DNS leak — hostnames are resolved by the exit, not locally. Fresh circuit per report submission, so two submissions cannot be linked by a shared exit relay. 12 protocol tests. |
| **Offline** | Failed submissions queue and retry on app resume — never on a background timer, so the reporter chooses when their IP touches the relayer. |
| **Tip channel** | Real ECIES sealing to a chosen journalist/NGO public key, padded to fixed length buckets so ciphertext size does not leak message length. |
| **Gasless** | `GaslessRelayer` abstraction. Mock relayer (default, no credentials) performs real encoding and signing. Pimlico ERC-4337 relayer with counterfactual SimpleAccount derivation (pinned on first use), paymaster sponsorship, gas estimation, and receipt polling that reads the report id from the event. |
| **Wallet option** | WalletConnect v2 as an explicitly non-default alternative signer, behind an unmissable anonymity-tradeoff warning and an acknowledgement gate. |
| **Monetization** | Org accounts stored entirely separately from reporter identity. Seats with roles and non-destructive revocation. API keys stored as hash + prefix only. Billing state with a 30-day grace period that removes capability, never data. Entitlement-gated CSV/JSON export, k-anonymous analytics, and case management with outcome tracking. Sponsored gas pools with aggregate-only attribution. |
| **i18n** | Full English + Hindi across every screen, verified by a key-coverage check. |

### In progress / partially real

| Area | Honest state |
|---|---|
| **Real chain submission** | Mock relayer is the default. The Pimlico path is now complete — counterfactual account, sponsorship, estimation, receipt polling — but has **never run against live Sepolia**. Untested code against a real bundler should be assumed broken until proven otherwise. |
| **Real content storage** | `IpfsContentStore` is written against a standard pin API but untested against a live provider. Mock store is the default. |
| **Indexer** | `IndexerNetworkIndex` and its endpoint contract exist; no indexer has been deployed against it. The direct-chain fallback now chunks log ranges so it works against public RPCs, and still does not scale. |
| **Personhood** | `SemaphorePersonhoodGate` is real zero-knowledge group membership: a member proves they belong without revealing which member, and a nullifier stops them acting twice. Contract tests generate real Groth16 proofs and verify them on-chain, negative cases included. **The mobile client cannot yet produce a proof** — snarkjs needs wasm, Hermes has none, so this needs a `rapidsnark` native module. Same shape of gap as Tor. |
| **Org accreditation & billing** | The client-side model is complete. There is no server: no payment processing, no API to serve, no server-side key verification. Accreditation remains a local flag with a dev toggle. |
| **Evidence at scale** | Three evidence types work, capped at 8 MB through `AsyncStorage` + base64. Video needs chunked reads and streaming encryption. |

### Not started

Bridges and pluggable transports for Tor — plain Tor is blocked in several of the places
this app is for, and without obfs4 support bootstrap simply fails there. **This is now the
largest gap in the anonymity story**, and it is a smaller job than the transport itself
was. Forward secrecy for tips. C2PA evidence provenance. Voice-first reporting. Languages
beyond Hindi/English (deliberately not machine-translated — mistranslated safety copy is
worse than English). RTI filing integration. A public API server. Independent security
audit and threat model review.

**Read that list honestly: the product is a working, verifiable prototype with a real
cryptographic core, not a deployable service.** Nothing here has protected a real
whistleblower yet.

On Tor specifically, resist the temptation to over-read the tick in the table above. The
transport compiles, its SOCKS layer is tested, and it is wired end to end — and **no report
has yet travelled over the live Tor network from a device.** The gap between "builds and
passes its tests" and "works on a phone in the field" is exactly where this class of
software fails. What remains before this should be trusted with a real report: a device
test, bridge support, a non-allowlist personhood gate, and an external audit. The last one
cannot be self-served — it needs funding and a counterparty, which is why it stays a
prerequisite rather than a roadmap item.

---

## 2. Revenue model

### Primary: B2B/B2G tooling on an open corpus

**The corpus stays free and public. We sell the tooling around it.**

This resolves the central ethical problem. The highest-willingness-to-pay segment for
corruption data is corporate compliance — FCPA/UK Bribery Act third-party due
diligence. But selling *exclusive* access to whistleblower reports to corporations is
indefensible: a company screening suppliers can equally screen for reports about
itself, and combine entity clustering with coarse region to hunt the reporter. Keeping
the corpus open removes the incentive entirely — there is no exclusivity to buy, so
nobody is paying for a targeting capability. What they pay for is workflow, throughput,
support, and an SLA.

This follows established precedent: OCCRP's Aleph Pro is free forever for nonprofit
journalism, at-cost for public-interest groups, priced for everyone else, and
OpenCorporates gives free public-benefit API keys while charging commercial users.

| Tier | Who | Price | Includes |
|---|---|---|---|
| **Community** | Nonprofit journalism, accredited watchdogs, TI-style chapters | **Free forever** | Advanced search, 3 seats |
| **Pro** | Funded newsrooms, mid-size NGOs | **$400/mo** | Export, API (5k calls/day), analytics, case management, 10 seats |
| **Institutional** | Oversight bodies, universities, large NGOs, compliance teams | **$1,500/mo** | 100k calls/day, 50 seats, SLA, onboarding |

Pricing is anchored on Sayari at ~$1,000/month for comparable investigative data
tooling — the willingness-to-pay band demonstrably exists at this level. Pro sits
deliberately below it to be reachable by an Indian regional newsroom.

Implemented: `packages/shared/src/org.ts` (plans, entitlements, accreditation gate, seats,
API key records, billing state), `apps/mobile/src/org.ts` (storage hard-separated from
reporter identity, seat management, key issuance), `apps/mobile/src/export.ts`
(entitlement-gated export), `apps/mobile/src/analytics.ts` (k-anonymous aggregates),
`apps/mobile/src/cases.ts` (case management with outcome tracking).

Two constraints in that implementation are worth surfacing to a buyer, because they are
the reason this is sellable at all:

- **Analytics suppress any bucket below 5 reports.** Not rounded — withheld. Small counts
  over a small area are a targeting tool wearing a dashboard's clothes, and a caveat next
  to the number does not stop anyone reading it. Suppression is itself reported, so an
  analyst can tell "withheld" from "clean".
- **Non-payment removes capability, never data.** A lapsed account drops to Community
  entitlements after 30 days of grace and keeps everything. Cutting a newsroom off from
  its case notes mid-investigation is a way to get a source hurt, and no amount of
  revenue protection justifies it.

### Secondary: sponsored gas pools

An NGO, foundation, or municipality funds submission gas for a region or category and
receives public attribution. This converts the paymaster from pure burn into a funded,
sponsor-visible line item — and at roughly **$0.03 per sponsored submission** it is
almost absurdly cheap PR for a transparency programme. A $250 pool funds over 8,000
reports.

The anonymity constraint is designed in, not bolted on: **attribution is aggregate
only.** A per-report sponsor tag would be a side channel — a narrowly-scoped sponsor
("bribery in one district") would shrink a report's anonymity set below what the
reporter consented to by publishing a coarse geohash. Sponsors get counts; no report
ever carries a sponsor marker on-chain or off. Pools below 50 funded reports go
unnamed entirely.

Implemented: `packages/shared/src/sponsor.ts`, `apps/mobile/src/sponsorPools.ts`,
attribution surfaced in the review screen, `sponsorPoolId` passed as paymaster
accounting context and deliberately excluded from calldata.

### Tertiary: grants — the actual year 0–2 funding

Grants, not revenue, pay for the first two years. Anti-corruption tech is squarely
fundable:

- **Linea ecosystem fund** — the largest ecosystem fund in the space (75% of LINEA
  supply), governed by the Linea Consortium, whose council includes Status. Direct
  relevance: this project inherits Status Network's gasless design after its merge into
  Linea, and is a public-goods use of exactly that technology.
- **Linea Exponent** growth programme for distribution and MetaMask surface exposure.
- Transparency International chapters, Omidyar Network, Ford Foundation, NED, Hewlett,
  and press-freedom funders (GIJN-adjacent).

### Optional: public donations

A separate surface for supporters — never the reporters, never in the reporting flow,
never a prompt shown to someone filing a report. Kept structurally distinct so the app
can never be read as pay-to-report. Not yet built.

### Explicitly rejected

No ads. No charging reporters, ever. No selling user data. No exclusive corporate
access to the corpus. Any of these would trade the trust that is the entire asset.

---

## 3. ROI case

### Who pays, and cost of acquiring them

The buyer is an institution, not a consumer, and the segment is small and enumerable:
roughly a few hundred addressable orgs in India (regional newsrooms, TI-India-scale
NGOs, state Lokayukta offices, university governance centres), maybe a few thousand
globally. That cuts both ways — you cannot buy growth, but you also do not need a sales
org. This is founder-led and conference-led selling: GIJN, TI chapter meetings,
Lokayukta procurement. Realistic CAC is **$2–5k per Pro account** in time and travel,
and Community accounts cost the same but pay nothing — which is intentional, because
they generate the verified corpus and the credibility the paid tiers are buying into.

### Cost to run

| Line | Annual, at ~50k reports/yr |
|---|---|
| Gas sponsorship (~$0.03 × 50k, ERC-4337 overhead ≈ 3¢ on L2) | **$1,500** |
| IPFS pinning + egress (~12 GB stored at ~$0.005/GB/mo; egress dominates) | **$1,000–3,000** |
| Infra: indexer, API, gateways, monitoring | **$8,000–18,000** |
| People: 3–5 FTE in India (eng + moderation + partnerships) | **$110,000–180,000** |
| Legal, audit, security review | **$25,000–50,000** |
| **Total** | **~$150,000–250,000** |

**The chain is not the cost.** This is worth stating plainly because investors
consistently over-index on it: gas is under 1% of the budget. Nearly all cost is
salaries, and the largest single driver is human moderation — which scales with report
volume and does not monetize. That inversion is the core structural risk, not gas.

### Path to breakeven

A credible year-2 mix:

| Source | Assumption | Annual |
|---|---|---|
| Pro | 15 orgs × $400/mo | $72,000 |
| Institutional | 4 orgs × $1,500/mo | $72,000 |
| Grants | 1 ecosystem + 1 foundation | $100,000 |
| Sponsored pools | 3 sponsors × $10k | $30,000 |
| **Total** | | **$274,000** |

That clears a $250k cost base. **Breakeven is plausible in 18–24 months**, and the
honest reading is that it depends on the grant line — 19 paying institutions is
achievable in a small market, but $100k of grant funding is doing a third of the work
and is not guaranteed. A version without grants needs roughly double the paid accounts,
which is a much harder ask in year 2.

"Return" here is a self-sustaining organization plus measurable governance outcomes
(reports → investigations → sanctions), not an exit. The comparable set is nonprofit,
not SaaS.

### Biggest risks to ROI, ranked

1. **Trust is the whole asset and it is binary.** One deanonymization incident — one
   reporter identified and harmed because of this app — ends the project permanently.
   No amount of product quality recovers from it. The gap has narrowed considerably: the
   egress seam, the fail-closed switch, the personhood enforcement point, and now a real
   embedded Tor transport with per-submission circuit isolation all exist. What remains is
   a device test on the live network, bridge support for censored networks, and an
   external audit. The audit in particular is a *funding prerequisite* rather than a
   roadmap item — it needs money and a counterparty, not more code.
2. **Regulatory and legal exposure.** India's IT Rules 2021 traceability requirements
   are in direct tension with the product's core guarantee, and India retains criminal
   defamation. An operating entity inside that jurisdiction can be compelled in ways
   that break the guarantee. Entity domicile is an existential architectural decision
   requiring counsel before launch, not after.
3. **Cold start.** A reporting platform with no reports and no outcomes is a diary.
   Distribution partnerships and a visible outcome loop are the mitigation, and both
   are unbuilt.
4. **Moderation cost scales with volume, revenue does not.** Success makes the
   dominant cost line grow faster than the revenue line. The volunteer jury is now
   built, which converts moderation from a salaried line into a community one — but that
   only helps if jurors actually show up, and recruiting and retaining an independent
   jury is an unsolved organizational problem, not a solved technical one. Budget for
   paid moderation until a volunteer jury demonstrably works.
5. **Grant dependency** (see above) — concentration risk in the single largest revenue
   line.

Chain and storage costs are deliberately absent from this list. At ~3¢ per report they
are noise.
