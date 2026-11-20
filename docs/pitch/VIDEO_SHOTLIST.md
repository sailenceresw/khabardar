# Video shot list

A two minute recording of the same walkthrough as [DEMO_SCRIPT.md](./DEMO_SCRIPT.md). It works as a pitch video on its own and as the fallback if the live demo fails. The voice-over is about 230 words, which fits two minutes at an easy pace with room for pauses.

## Before recording

- Record the web build in mock mode at phone size (390 by 844 in the browser's device toolbar), or the app on the Android dev build. Use the same one for every shot.
- Start from a fresh browser profile so onboarding shows.
- Have the sample report from the demo script ready to paste.
- Turn off notifications and hide bookmarks and other tabs. Nothing personal should be on screen.
- Record the screen first and the voice-over afterwards, then cut the screen to the voice. It is easier than talking while clicking.
- Export at 1080p. Add captions with the voice-over text, since many people watch without sound.

## Shots

| # | Time | On screen | Voice-over |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:12 | The welcome screen, still. Slow zoom on "You are anonymous here". | In a small office, the person who reports a bribe is easy to find. Their role, their desk, the time they were there is often enough. |
| 2 | 0:12 to 0:22 | Tap **Create anonymous identity**, the codename and recovery words appear, tap through to Home. | Khabardar never asks for a name, a phone number or an email. A key made on the phone is the whole identity. |
| 3 | 0:22 to 0:35 | Tap **New report**, paste the sample report, tap **Review & submit**. | Here is a report written the way people actually write. It is honest, and it would get its author identified. |
| 4 | 0:35 to 0:55 | The privacy check with five findings. Hold for two seconds, then redact the phone number and email, fix "the only accountant" to "I work in the office", keep the date and time. | Before anything leaves the phone, a privacy check looks for what would give the reporter away: a phone number, an email, and quieter things like being the only accountant in the office. It runs on the phone and sends nothing anywhere. The reporter decides what to change. |
| 5 | 0:55 to 1:10 | Tap **Continue to review**, then **Submit anonymously**. The status screen with the fingerprint and the "Simulated" note. | The report is encrypted on the phone. Only its fingerprint goes on the Linea blockchain, so nobody can quietly change or remove it. Gas is sponsored, so the reporter never needs crypto. This recording runs in mock mode, and the app says so. |
| 6 | 1:10 to 1:25 | The public feed with the redacted report and its Unverified tier, then a sample report marked Corroborated. | Every report starts as unverified. It moves up through corroboration and a secret-ballot jury, and nobody can edit or delete it. |
| 7 | 1:25 to 1:42 | Organisation tab: register "Demo Newsroom (fictional)", open **Reports**, **Select all exportable**, download the case file, then show it open with the fingerprint visible. | Newsrooms and NGOs pay for the tools: export, analytics and case files that anyone can check against the chain. Reporting stays free. |
| 8 | 1:42 to 2:00 | The one-pager or the README header, with the QR codes. | Khabardar is an open-source prototype. It has not been audited, and until it has, people at real risk should use SecureDrop or GlobaLeaks. The code and a live preview are linked here. |

## Checks before publishing

- No real names, phone numbers or emails appear anywhere. The sample report uses made-up details.
- The "Simulated" note is visible in shot 5, so nobody mistakes the demo for a live anchor.
- Captions match the voice-over.
- Once the testnet deploy is done, a second cut can replace shot 5 with a live anchor and the Lineascan page.
