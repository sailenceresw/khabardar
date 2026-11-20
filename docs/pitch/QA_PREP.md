# Questions to expect

The fifteen hardest questions likely after a demo, each with a short answer and where the detail lives. The answers say what is built and what is not. If a question goes past what is here, say you do not know yet and point to the issue that tracks it.

Numbers in this file were current when it was written: 75 contract tests, 344 unit tests, and leak checker precision of 92% and recall of 77% on its own evaluation set.

## The idea

### 1. Why use a blockchain? A database would be cheaper.

A database is controlled by whoever runs it, and that party can edit or delete a report quietly. The chain holds only a fingerprint of each encrypted report, so anyone can check later that a report has not changed and was not removed, without trusting us. Gas is under 1% of the running cost, about 3 cents a report. Linea was chosen because it supports gasless submission (ERC-4337 and EIP-7702), so a reporter never needs to hold crypto.

Detail: `docs/ARCHITECTURE.md`, section "Blockchain layer (Linea)".

### 2. Why would anyone use this over SecureDrop or GlobaLeaks?

Today they should use those, and the README and the web preview say so. SecureDrop and GlobaLeaks are audited and deployed, and this is a prototype. What Khabardar adds is a phone-first flow that needs no newsroom to run a server, a privacy check before submission, and a public record that other people can corroborate. It borrows their two main rules: the platform must not be able to identify its users, and metadata is as dangerous as content.

### 3. Has anyone used it?

No. Nothing has run against a live network yet, and no real report has been filed. The demo runs in mock mode and labels the anchor as simulated. The next step is a deployment on the Linea Sepolia testnet with seeded demo reports that are clearly marked as demo data.

## Anonymity

### 4. The chain is public. What does it reveal about the reporter?

For each report it stores the fingerprint, a pointer to the encrypted bundle, the category, the verification tier, a district-level location code (4 characters of geohash), a blinded tag for the accused office, a timestamp, and a pseudonymous address. There is no name, phone number or email anywhere in the system. Reports from the same device share an address, which is how karma works, so a reporter who files many reports links them to each other.

### 5. Can the government or the operator find out who sent a report?

The design aims to make that impossible, and parts of it are not proven yet. The app never collects identity, encrypts on the phone, strips photo metadata before storage, and sends everything through one network path that uses Tor built into the app. That Tor path is tested at the protocol level, but it has not yet carried a report over the live Tor network from a phone. Without Tor, the relayer and storage provider can see the reporter's IP address. Only plain Tor bridges are supported, so in places that block Tor the connection may fail.

Detail: `SECURITY.md`, "Known and already documented"; issue #9.

### 6. What happens if the phone is taken?

There is a PIN lock, and a duress PIN that wipes the app and then opens it as if it were a fresh install. The app can be disguised as a working calculator, screenshots are blocked, and a panic delete wipes drafts, evidence, keys and identity. The reporter can restore their identity on a new phone with their 12 recovery words. On the web preview none of this protects anyone, and the preview says so before it starts.

### 7. How good is the privacy check?

On its own evaluation set it finds 77% of the identifying details and is right 92% of the time when it flags one. The same person wrote the rules and the test set, so real reports will likely score lower. It misses paraphrased roles, names outside its lists, Devanagari script, and numbers written as words. Face and visible-text detection in photos are not in any build yet, and the check says so. It runs entirely on the phone and makes no network requests.

Detail: `docs/LEAK_CHECKER.md`; `npm run eval:leaks` reproduces the numbers.

## Abuse and moderation

### 8. What stops people posting false accusations?

Every report starts as Unverified and is shown with its tier. Other users can corroborate it, and a jury moves it between tiers: Unverified, Under review, Corroborated, Verified or Disputed. A juror can change a tier and can never edit or delete a report. The accused is named only by office, through a blinded tag, and that tag can be reversed by trying every office name. This is an accepted trade-off: the office is public anyway, and the reporter is the one the design protects.

### 9. Who moderates, and can they be bought?

An equal-weight jury with a secret ballot: jurors commit a sealed vote, then reveal it with a reason, and there is no admin path to a verdict. A quorum of three is needed, and the reporter can appeal once to a larger panel. The weak points are that the jury is only as independent as the people seated on it, and its decision log is still kept on the device, so verdicts are not yet publicly auditable (issue #17).

### 10. What stops spam and fake accounts?

Submissions are rate limited per time window in the contract. Corroboration, which affects a report's standing, goes through a personhood gate; a zero-knowledge version exists in the contracts but has not run on a phone. Reporting itself is deliberately left open to any address, because asking a whistleblower to prove who they are defeats the purpose. Stronger sybil resistance is tracked in issue #10.

## Money

### 11. How does this make money?

Reporting is free and always will be, and the reports themselves stay public. Institutions pay for the tools around them. Community is free for nonprofit journalism and accredited watchdogs. Pro is $400 a month for funded newsrooms and NGOs, with export, API access, analytics and case management. Institutional is $1,500 a month with higher limits and an SLA. Grants are expected to fund the first two years.

Detail: `BUSINESS.md`, section 2.

### 12. Why not sell the data to compliance firms? That is where the money is.

Exclusive access would let a company search for reports about itself and use the location and office tags to hunt for the reporter. Keeping the corpus open removes that incentive, because there is nothing exclusive to buy. Analytics also withhold any count below five reports for the same reason.

### 13. What does it cost to run, and when does it break even?

About $150,000 to $250,000 a year at 50,000 reports, almost all of it people. Moderation is the largest cost that grows with volume. Chain and storage costs are small. A year-two mix of 15 Pro accounts, 4 Institutional accounts, grants and sponsored gas pools comes to about $274,000, so breakeven in 18 to 24 months is plausible, but a third of that depends on grants.

## Risk

### 14. Indian law requires message traceability, and defamation is criminal. How do you deal with that?

This is the largest unresolved risk. An operating company in a jurisdiction that can compel it might be forced to break the guarantee. Where the organisation is based has to be decided with legal advice before launch. The code limits what any operator could hand over, since there is no identity to give, but that has not been tested in court.

### 15. What has to happen before a real person should use this?

Four things: a test of Tor on a real phone, support for Tor bridges that work where Tor is blocked, a personhood gate that does not rely on an allowlist, and an independent security audit. The audit needs funding and an outside firm, so it cannot be done with more code. Until then the app tells people at real risk to use SecureDrop or GlobaLeaks.
