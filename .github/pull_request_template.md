## What this changes

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

<!-- What problem does this solve? If it closes an issue, the issue may already say it. -->

## Anonymity impact

<!-- Required. Delete the lines that do not apply. -->

- [ ] No new network requests, or all new requests go through the transport layer
- [ ] Nothing user-derived is logged, reported, or sent to a third party
- [ ] Any new file written on device is covered by panic delete
- [ ] No new metadata attached to reports or evidence
- [ ] No new timing or size side channel (message length, request order, upload timing)
- [ ] This change does not affect the anonymity model at all

<!-- If a box cannot be ticked, explain here. An honest "this leaks X, here is why it is
     acceptable" is fine and reviewable. A silent leak is not. -->

## Checks

- [ ] `npm run mobile:typecheck`
- [ ] `npm run contracts:test`
- [ ] `npm run verify:slice --workspace apps/mobile`
- [ ] New user-facing strings added to **both** English and Hindi

## Screenshots

<!-- For UI changes. Before/after if you changed something existing. -->

## What this does not do

<!-- Known gaps, TODOs left in place, follow-up issues. Being explicit here is the
     project's habit — see the "current stubs" section in the README. -->
