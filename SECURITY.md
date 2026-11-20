# Security policy

Khabardar is software for people who may be at risk. A vulnerability here is not a
service outage. It is potentially somebody's safety. Please treat it accordingly, and
we will too.

## Do not use this for real reports yet

**Khabardar is a v0 prototype. It has not been audited, and its network protection
has not been proven on a real device.** Native builds embed a Tor client (Arti) and
can refuse to send anything that would not go through it, but no dev build has yet
run Tor on a phone and landed a report. The web preview and Expo Go cannot load Tor
at all, and there every request leaves from your IP address unless the build is pointed
at an anonymising proxy, which then sees every destination you contact. A targeted user
could be deanonymized at the network layer regardless of how well the cryptography
works.

If you are in actual danger, use a tool that has been audited and deployed in the field,
such as [SecureDrop](https://securedrop.org) or [GlobaLeaks](https://www.globaleaks.org),
and reach a journalist or organisation that already runs one.

We will remove this notice when the items tagged
[`blocker:mainnet`](https://github.com/sailenceresw/khabardar/issues?q=is%3Aissue+is%3Aopen+label%3Ablocker%3Amainnet)
are closed and an external audit has been published.

## Live mode

The app runs on mocks by default and touches no network. `EXPO_PUBLIC_KHABARDAR_MODE=live` turns on real services one at a time as their settings are filled in (see `apps/mobile/src/runtimeConfig.ts` and `docs/ARCHITECTURE.md`).

- Live mode is for Linea Sepolia, the testnet. The config refuses Linea mainnet.
- Keys and tokens belong in a local `.env`, which is gitignored. Never commit one, and never paste one into an issue.
- In live mode the relayer, the IPFS pinning service and the RPC endpoint each see the connecting IP address. The pinning service only ever receives encrypted bundles. Without Tor running, each of them can link a submission to an IP.

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

Use GitHub's private reporting: **Security → Advisories → Report a vulnerability** on
this repository. That channel is private to the maintainers and gives you a thread to
discuss the fix.

Please include:

- What the issue is, and which file or component it lives in
- How to reproduce it
- What an attacker gains, especially whether it can deanonymize a reporter
- Any suggested fix

You will get an acknowledgement within **7 days**. This is a small project; that is a
realistic promise rather than an enterprise SLA one.

There is **no bug bounty**. We cannot pay, and we would rather say so plainly than let
you spend a weekend expecting one.

## What we consider in scope

Ranked by how much we care, which is not the same as how severe a scanner would call it:

1. **Anything that deanonymizes a reporter.** Metadata surviving the strip pipeline, a
   network request escaping the transport, identity material leaking into logs, a
   correlation channel between a report and a device. This is the whole product.
   It includes the leak checker or the privacy check sending any part of a draft off
   the device, and a photo being stored after its metadata check should have refused it.
2. **Cryptographic flaws.** AES-GCM nonce reuse, the ECIES construction, HKDF usage,
   BIP-39 derivation, key storage in SecureStore/Keychain/Keystore.
3. **Integrity failures.** Anything that lets a hostile gateway or indexer serve altered
   content without tripping the on-chain fingerprint check.
4. **Contract bugs** in `ReportRegistry.sol`: access control, corroboration and karma
   manipulation, moderation authority.
5. **Panic delete gaps.** Anything that survives a wipe: temp files, caches, OS-level
   copies, notification history.
6. **Organisation tooling.** A recipient key accepted without matching a pinned
   recipient, or surviving sign-out; a restricted report opening for a key it was not
   sealed to; a case file that carries a reporter address or report text that runs as
   markup or a spreadsheet formula.

## Known and already documented

These are real weaknesses, and we already know. Reports are welcome if you can show a
worse impact than we have described, but they are not news:

- **Embedded Tor is unproven on a device.** Every request goes through `netFetch` in
  `apps/mobile/src/net/`, and the viem chain clients use the same path. In a native
  build with Arti running, that path is Tor; the SOCKS5 layer has unit tests, but
  nothing yet tests Arti against the live network. Without Arti (the web preview,
  Expo Go, or Tor not started) requests go direct, or through
  `EXPO_PUBLIC_ANONYMISING_PROXY_URL` when it is set, unless the fail-closed setting is
  on, and that setting is off by default. A system-wide VPN such as Orbot cannot be
  seen from inside the app, so it is never reported as verified.
  Tracked in [#9](https://github.com/sailenceresw/khabardar/issues/9).
- **Only vanilla Tor bridges are supported.** obfs4, snowflake and other pluggable
  transports are not in the build, so where Tor is censored bootstrap may fail.
- **Corroboration and karma are not sybil-resistant.** Tracked in
  [#10](https://github.com/sailenceresw/khabardar/issues/10).
- **Entity tags are reversible by dictionary attack.** The set of public offices is
  enumerable. This is an accepted trade-off: the accused is not the secret, the
  reporter is.
- **The moderation jury is only as independent as its seats.** The single moderator
  address was replaced by an equal-weight secret-ballot jury with a quorum of three
  ([#16](https://github.com/sailenceresw/khabardar/issues/16)). A deployment that seats
  fewer than three unrelated jurors brings the centralization back. The jury's decision
  log is kept on the device, so verdicts are not yet publicly auditable. Tracked in
  [#17](https://github.com/sailenceresw/khabardar/issues/17).
- **Demo recipient keys and sample feed rows ship in the current build.** Tracked in
  [#21](https://github.com/sailenceresw/khabardar/issues/21).
- **Web build's SecureStore falls back to localStorage.** Dev preview only, never a
  release path.
- **Tips lack forward secrecy.** A recipient key stolen later opens every tip sealed
  to it. Tracked in [#12](https://github.com/sailenceresw/khabardar/issues/12). Tip
  length is padded to fixed buckets ([#11](https://github.com/sailenceresw/khabardar/issues/11)),
  so only the bucket leaks, not the exact length.
- **The leak checker matches patterns and misses things.** Paraphrased roles, names
  outside its lists, Devanagari script and numbers written as words all get through.
  Its measured precision and recall come from a small synthetic set written by the same
  person who wrote the rules, so real reports will likely score lower. Details and the
  current numbers are in [docs/LEAK_CHECKER.md](docs/LEAK_CHECKER.md).
- **Photos are not checked for faces or visible text yet.** Both need native modules
  that are not in any build; the privacy check says so rather than implying a photo
  was looked at.
- **The photo metadata check has only been tested against hand-built files,** not
  against the real output of the platform image encoders.
- **An organisation's recipient key is kept in localStorage in the web preview,** like
  every other key there. Native builds use the platform's secure storage.

## Out of scope

- The mock relayer and mock content store fabricating data, which is what mocks do
- Missing rate limits on a build with no deployed backend
- Automated scanner output with no demonstrated impact
- Dependency CVEs with no reachable path in this codebase (tell us anyway if you have a
  path)

## Disclosure

Report privately, give us a reasonable window to fix it, then publish whatever you like.
We would rather the finding be public than quiet. If we go silent on you, publish. A
maintainer who stops answering is not a reason to sit on a bug that puts people at risk.
