# Contributing to Khabardar

Thanks for looking. This is a small project with an unusually high cost of failure —
the users it is built for can be harmed by a bug — so the bar for changes is different
from a typical app.

Read [SECURITY.md](./SECURITY.md) before anything else if you found a vulnerability.
**Do not open a public issue for one.**

## The one rule

**A change must not make it easier to identify a reporter.**

Everything else is negotiable. This one is not. If a feature is good and it leaks
metadata, the feature loses. When you open a PR, be explicit about which side of that
line your change sits on — the PR template asks you directly.

Things that count as identifying, which are easy to add by accident:

- A new network request outside the transport layer
- A log line, crash report, or analytics event containing anything user-derived
- A file written outside the paths that panic delete wipes
- Any new metadata on an evidence blob
- Finer-grained location than the 4-character geohash
- A timing or size side channel — message length, request timing, upload order

## Getting set up

Requires Node 20 (see `.nvmrc`) and npm 10.

```bash
npm install
npm run contracts:compile
npm run contracts:test                        # 23 tests
npm run verify:slice --workspace apps/mobile  # headless end-to-end slice
npm run mobile:web                            # dev server
```

On Windows without Watchman, Metro's watcher can hang — use
`npm run web:export --workspace apps/mobile` then `npm run web:static --workspace apps/mobile`
instead. See the troubleshooting note in the README.

## Before you open a PR

```bash
npm run mobile:typecheck
npm run contracts:test
npm run verify:slice --workspace apps/mobile
```

These are the same three things CI runs. `verify:slice` is the fastest way to know you
have not broken the chain-facing path — it exercises the real crypto, encoding,
evidence, content-store, and relayer modules under Node.

## What makes a good PR here

- **One thing at a time.** A refactor bundled with a behaviour change is hard to review
  and harder to audit later.
- **Say what you did not do.** The codebase is deliberately honest about its own gaps —
  README and BUSINESS.md both carry "here is what is fake" sections. Keep that habit.
  A TODO with a reason is worth more than silence.
- **Do not quietly upgrade a mock into something that looks real.** If `MockRelayer`
  starts returning something that reads as a real transaction, someone will believe it.
- **Match the surrounding code.** TypeScript throughout, strings via `t()`, no new
  dependency without saying why in the PR.
- **New user-facing strings need both English and Hindi.** `apps/mobile/src/i18n/`.

## Where to start

Issues are labelled by area (`area:anonymity`, `area:chain`, `area:content`, …), by
type, and by priority. Two labels worth knowing:

- [`blocker:mainnet`](https://github.com/sailenceresw/khabardar/issues?q=is%3Aissue+is%3Aopen+label%3Ablocker%3Amainnet)
  — hard gates before this can be used by anyone real. The most important work.
- [`type:research`](https://github.com/sailenceresw/khabardar/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Aresearch)
  — design decisions that need thinking through before code. Comments on these are
  as valuable as PRs.

If you want something self-contained to start with, look for `P2` items.

## Things that will be declined

- **A naive AI-text detector.** These have high false-positive rates on second-language
  English writers, which describes a large share of the intended users. Shipping one
  would systematically silence exactly the people this exists for. Provenance,
  personhood, and corroboration are the defensible answers — AI in triage, never as
  judge.
- **Any signup, email, phone number, or account recovery via a third party.** An auth
  provider is one subpoena away from deanonymizing every reporter.
- **Cloud speech-to-text, cloud translation, or cloud image processing** on report
  content. That hands over the content and the IP together.
- **Analytics or crash reporting SDKs.** No exceptions, including "anonymous" ones.
- **Making WalletConnect the default identity.** It is available and it is deliberately
  never the default.

## Licence

By contributing you agree your work is licensed under
[AGPL-3.0](./LICENSE), the same as the project.
