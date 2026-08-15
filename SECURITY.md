# Security policy

Khabardar is software for people who may be at risk. A vulnerability here is not a
service outage — it is potentially somebody's safety. Please treat it accordingly, and
we will too.

## Do not use this for real reports yet

**Khabardar is a v0 prototype. It has not been audited, and it does not yet have an
anonymising network transport.** A targeted user could be deanonymized at the network
layer regardless of how well the cryptography works.

If you are in actual danger, use a tool that has been audited and deployed in the field
— [SecureDrop](https://securedrop.org) or [GlobaLeaks](https://www.globaleaks.org) —
and reach a journalist or organisation that already runs one.

We will remove this notice when the items tagged
[`blocker:mainnet`](https://github.com/sailenceresw/khabardar/issues?q=is%3Aissue+is%3Aopen+label%3Ablocker%3Amainnet)
are closed and an external audit has been published.

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

Use GitHub's private reporting: **Security → Advisories → Report a vulnerability** on
this repository. That channel is private to the maintainers and gives you a thread to
discuss the fix.

Please include:

- What the issue is, and which file or component it lives in
- How to reproduce it
- What an attacker gains — especially whether it can deanonymize a reporter
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
2. **Cryptographic flaws.** AES-GCM nonce reuse, the ECIES construction, HKDF usage,
   BIP-39 derivation, key storage in SecureStore/Keychain/Keystore.
3. **Integrity failures.** Anything that lets a hostile gateway or indexer serve altered
   content without tripping the on-chain fingerprint check.
4. **Contract bugs** in `ReportRegistry.sol` — access control, corroboration and karma
   manipulation, moderation authority.
5. **Panic delete gaps.** Anything that survives a wipe: temp files, caches, OS-level
   copies, notification history.

## Known and already documented

These are real weaknesses, and we already know. Reports are welcome if you can show a
worse impact than we have described, but they are not news:

- **No anonymising transport.** IP addresses reach the relayer, RPC, and content
  gateway directly. Tracked in [#9](https://github.com/sailenceresw/khabardar/issues/9).
- **Corroboration and karma are not sybil-resistant.** Tracked in
  [#10](https://github.com/sailenceresw/khabardar/issues/10).
- **Entity tags are reversible by dictionary attack.** The set of public offices is
  enumerable. This is an accepted trade-off — the accused is not the secret, the
  reporter is.
- **Single moderator address.** Centralization point, testnet only. Tracked in
  [#16](https://github.com/sailenceresw/khabardar/issues/16).
- **Demo recipient keys and sample feed rows ship in the current build.** Tracked in
  [#21](https://github.com/sailenceresw/khabardar/issues/21).
- **Web build's SecureStore falls back to localStorage.** Dev preview only, never a
  release path.
- **Tip length leaks; tips lack forward secrecy.** Tracked in
  [#11](https://github.com/sailenceresw/khabardar/issues/11) and
  [#12](https://github.com/sailenceresw/khabardar/issues/12).

## Out of scope

- The mock relayer and mock content store fabricating data — that is what mocks do
- Missing rate limits on a build with no deployed backend
- Automated scanner output with no demonstrated impact
- Dependency CVEs with no reachable path in this codebase (tell us anyway if you have a
  path)

## Disclosure

Report privately, give us a reasonable window to fix it, then publish whatever you like
— we would rather the finding be public than quiet. If we go silent on you, publish. A
maintainer who stops answering is not a reason to sit on a bug that puts people at risk.
