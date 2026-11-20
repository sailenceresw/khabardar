# Deck outline

Ten slides for a five minute pitch, with the live demo from [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) between slides 4 and 5. Each slide has a headline, what goes on it, and what to say. Every number comes from the repo and has its source next to it, so a judge who asks can be shown where it came from. Answers to the likely follow-up questions are in [QA_PREP.md](./QA_PREP.md).

Screenshots of the current screens at phone size are in `docs/media/`.

## 1. Khabardar

On the slide: the name in Latin and Devanagari (खबरदार), the line "Report corruption. Stay anonymous.", and the repo link as a QR code.

Say: Khabardar lets someone who sees a bribe asked for report it from their phone without giving a name, and checks the report for details that would identify them before anything leaves the phone.

## 2. Reporting is dangerous for the person who reports

On the slide: three short lines. Formal channels ask for your name. Informal channels leak through details: your role, your desk, the time you were there. A record held by one office can be edited or lost.

Say: The people who see small, everyday corruption are clerks, drivers and accountants in district offices. In a small office, the details of a report identify its author as surely as a signature.

## 3. Who it is for

On the slide: two columns. Reporters: anyone with a phone, no account, no crypto. Institutions: newsrooms, NGOs and oversight bodies that act on reports.

Say: Reporters never pay and never sign up. The institutions that turn reports into stories and cases are the ones who pay, for the tools around a public record.

## 4. What it does

On the slide: four steps with a screenshot each. Write the report. The privacy check finds identifying details. Submit; the report is encrypted on the phone and only its fingerprint goes on the chain. A newsroom exports a case file anyone can verify.

Say: Let me show you. Then run the demo.

## 5. The privacy check

On the slide: the privacy check screenshot with five findings highlighted, and the measured numbers: 92% precision and 77% recall across 64 labelled details in 77 test texts. Source: `docs/LEAK_CHECKER.md`, reproducible with `npm run eval:leaks`.

Say: It runs entirely on the phone and sends nothing anywhere. It catches phone numbers and emails, and also the quieter details, like "the only accountant in the office". The test set was written by the same person who wrote the rules, so real reports will score lower, and the doc says so.

## 6. How it protects the reporter

On the slide: a simple flow. Phone (key made on the device, report encrypted, photo metadata stripped) to Tor built into the app, to encrypted storage on IPFS and a fingerprint on Linea. Next to it: no name, phone number or email is ever collected.

Say: There is no identity to hand over, because the app never has one. The chain is there so nobody, us included, can quietly edit or remove a report. Gas is sponsored, so the reporter never holds crypto, and it costs about 3 cents a report. Source: `BUSINESS.md`, section 3.

## 7. Trust without an administrator

On the slide: the five tiers (Unverified, Under review, Corroborated, Verified, Disputed) and one line on the jury: equal votes, secret ballot, a quorum of three, one appeal.

Say: A report starts unverified and moves only by corroboration and a jury vote. There is no admin path to a verdict, and a juror can change a tier but never edit or delete a report.

## 8. Business model

On the slide: the three plans. Community is free for nonprofit journalism and watchdogs. Pro is $400 a month. Institutional is $1,500 a month. Underneath: reporting is free forever, the reports stay public, and nothing is sold exclusively. Source: `BUSINESS.md`, section 2, and the Plans screen in the app.

Say: We charge for the tools around the record: export, API access, analytics, case management. Selling exclusive access would let a company search for reports about itself and hunt the reporter, so we do not.

## 9. Costs and the path to breakeven

On the slide: about $150,000 to $250,000 a year to run at 50,000 reports, mostly people. A year-two mix of 15 Pro and 4 Institutional accounts, grants and sponsored gas pools comes to about $274,000. Source: `BUSINESS.md`, section 3.

Say: Moderation is the largest cost, and the chain is a small one. Breakeven in 18 to 24 months is plausible, and a third of it depends on grants. This is a sustainable small organisation, and we pitch it as one.

## 10. Where it stands and what comes next

On the slide: built and tested (75 contract tests, 344 unit tests, the full flow in mock mode). Next: deploy on the Linea Sepolia testnet, test Tor on a real phone, add bridges for places that block Tor, and an independent security audit.

Say: This is a working prototype that has not protected anyone yet, and it says so in the app. Until those four steps are done, someone at real risk should use SecureDrop or GlobaLeaks. What we are asking for is the funding and partners to get through them.

## Before presenting

- Update slide 10 once the testnet deploy lands, with the contract address and a Lineascan link.
- Rerun `npm run eval:leaks` and the test suites, and update the numbers on slides 5 and 10 if they have changed.
- Keep the demo in the middle. If it fails, play the recorded video and keep going.
