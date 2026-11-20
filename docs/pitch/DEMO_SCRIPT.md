# Demo script

A three minute walkthrough of Khabardar: one person reports, the app catches what would identify them, and a newsroom turns the report into a case file it can check. Every click below is a real label in the app.

The demo runs in mock mode. Nothing is sent to a blockchain or to IPFS, and both the status screen and the case file say the transaction is simulated. Say that out loud once, early, so nobody thinks a live anchor is being shown.

## Before you start

1. Open the web preview at https://khabardar-flax.vercel.app in a fresh browser profile or a private window, so onboarding shows from the start.
2. Set the window to phone width, or open it on a phone. The app keeps itself to a phone-sized column on wide screens.
3. Copy this text so you can paste it in step 3:

   > I am the only accountant in the office. On 3 March at 4:15 the officer asked me to sign a false voucher. Call me on 9800000000 or email sunita.lama@example.com.

4. Have the offline copy ready (see the last section) and the recorded video open in another tab.

## The script

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Nothing on screen yet. | People who see a bribe asked for in a district office have no safe way to report it. Khabardar lets them report without an account, and checks the report for details that would give them away before anything leaves the phone. |
| 0:15 | Click **I understand — show me the demo**. | This is the web preview. It runs on mocks and tells you plainly that it does not protect you the way the phone app does. |
| 0:25 | Click **Create anonymous identity**. | No name, no phone number, no email. A key is made on this device and never leaves it. |
| 0:35 | Point at the 12 words, then click **I have written these words down** and **Continue**. | These 12 words are the only way back in. Nobody can reset them, including us. |
| 0:45 | On Home, click **New report**. Paste the text into the report box. | Here is a report written the way a real person writes it. It is honest, and it would get them identified. |
| 1:00 | Click **Review & submit**. | Before review, the privacy check runs. It runs on the phone and sends nothing anywhere. |
| 1:05 | Point at the five highlighted findings. | It found the phone number and the email, and also the quieter things: "the only accountant in the office" narrows it to one person, and an exact date and time do the same. |
| 1:20 | On the phone number and the email, click **Redact**. On "the only accountant", click **Fix** and change it to "I work in the office", then **Save**. On the date and time, click **Keep anyway**. | The reporter decides. Nothing is blocked; some details are part of the story. |
| 1:40 | Click **Continue to review**. | |
| 1:45 | On **Your connection is not protected**, click **Send unprotected anyway**. | The phone app routes everything through Tor. The browser cannot, so the app says so and makes you choose. |
| 1:55 | Click **Submit anonymously**. Point at **Report fingerprint**, then at the yellow note under it that starts "Simulated". | The report is encrypted, and only this fingerprint goes on the chain. This build is in mock mode, so the app says plainly that nothing went to a chain. |
| 2:05 | Click **Back to home**, then tap **Organisation** in the tab bar. Fill **Organization name** with "Demo Newsroom (fictional)" and the contact email with "desk@example.org", pick **Pro**, then **Register organization** and **Mark accredited (dev)**. | Now the other side: a newsroom. Accreditation is a manual step in a real deployment; this button stands in for it. |
| 2:25 | Click **Reports**, then **Select all exportable**, then **Download case file (print to PDF)**. | The newsroom sees reports corroborated by others, and exports a case file. |
| 2:40 | Open the downloaded file. Point at the fingerprint and the section on checking a report has not changed. | Anyone can hash the report and compare it to what is on the chain. The newsroom does not have to trust us. |
| 2:50 | Back to the app. | Reporting is free. Newsrooms and NGOs pay for the workspace. The app has not been audited, and we say so in the app and in the repo. |

If you fall behind, skip the Fix step at 1:20 and redact everything instead. That saves about ten seconds.

## Once the testnet contract is deployed

The same flow works in live mode on Linea Sepolia. After **Submit anonymously**, wait for **Anchored on-chain**, then click **View on Lineascan** and show the transaction. Allow about 20 extra seconds for this, and take them from the organisation sign-up by registering it before the demo starts.

## If there is no network

Mock mode needs no network at all, so the app can run from a laptop:

```
npm ci
npm run web:export --workspace apps/mobile
npm run web:static --workspace apps/mobile
```

Then open http://localhost:8085 and follow the same script. Build it the day before and check it once with the network switched off.

If the laptop fails too, play the recorded video of the same walkthrough and talk over it with the same lines.

## Things that go wrong

- Onboarding does not show and you land on Home: the browser kept an identity from an earlier run. Use a private window, or clear the site data for the preview.
- The privacy check shows fewer findings than five: the pasted text changed, for example a smart quote or a missing digit. Paste it again from this file.
- The organisation is already registered: the browser kept it from an earlier run. Click **Reports** straight away and carry on from 2:25.
