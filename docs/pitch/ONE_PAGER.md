# Khabardar · खबरदार

Report corruption. Stay anonymous.

Khabardar is a phone app for reporting bribes and abuse of office without giving a name. Before anything is sent, it checks the report for details that would identify the person writing it. Each report is encrypted on the phone, and only its fingerprint goes on a public blockchain, so nobody can quietly edit or remove it later.

<table>
<tr>
<td align="center"><img src="./qr-demo.svg" width="160" alt="QR code for the web preview"><br><sub>Web preview<br>khabardar-flax.vercel.app</sub></td>
<td align="center"><img src="./qr-repo.svg" width="160" alt="QR code for the source code on GitHub"><br><sub>Source code<br>github.com/sailenceresw/khabardar</sub></td>
</tr>
</table>

## The problem

The people who see everyday corruption work in small offices, where the details of a report give away who wrote it as surely as a name. A role, a desk or the time someone was there is often enough. Records held by a single office can also be changed or lost.

## What it does

- No account. A key made on the phone is the whole identity, and the app never asks for a name, phone number or email.
- A privacy check runs on the phone before review and flags phone numbers, emails, ID numbers, names and quieter details such as "the only accountant in the office". On its evaluation set it is right 92% of the time when it flags something and finds 77% of identifying details.
- Reports and evidence are encrypted on the phone, and photo metadata is removed before anything is stored.
- Only a fingerprint and a pointer go on the Linea blockchain. Gas is sponsored, so the reporter never needs crypto.
- Reports move between tiers (Unverified, Under review, Corroborated, Verified, Disputed) through corroboration and a secret-ballot jury. Nobody can edit or delete a report.
- Newsrooms and NGOs export a case file that anyone can check against the chain.

## Who pays

Reporting is free and the reports stay public. Institutions pay for the tools around them: Community is free for nonprofit journalism and watchdogs, Pro is $400 a month and Institutional is $1,500 a month. Running costs are about $150,000 to $250,000 a year at 50,000 reports, mostly people. Gas is about 3 cents a report.

## Where it stands

Built and tested: 75 contract tests, 344 unit tests, and the full flow from reporting to case file in mock mode. Tor is built into the app but has not yet carried a report from a real phone. Next: deploy on the Linea Sepolia testnet, test Tor on a phone, add Tor bridges for places that block it, and an independent security audit. Until then, anyone at real risk should use SecureDrop or GlobaLeaks, and the app says so.

Open source under AGPL-3.0.
