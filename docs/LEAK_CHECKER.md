# Leak checker

Encryption protects a report on the way to its readers. It does nothing about what the reporter writes. A report that says "as the only accountant in the Dhangadhi office, I saw the transfer on 3 March at 4:15" is perfectly encrypted and still names its author to anyone who knows that office.

The leak checker reads the draft before it is submitted and points out details that could identify the reporter. It runs entirely on the device, it advises and never blocks, and the reporter decides what to change.

This note sets out what the checker looks for, what it misses, and why it runs on the device. It describes the design. Measured precision and recall go in the last section once the evaluation set exists, and until then there are no numbers to quote.

## What can identify a reporter

Reports are read by people who know the setting: colleagues, the accused, the officials named. They do not need a database to recognise someone. A detail is dangerous when few people could have written it.

Direct identifiers name the reporter outright:

- their own name, or the name of a close relative
- a phone number, email address or social media handle
- citizenship, national ID, PAN, passport or licence numbers
- a vehicle number plate
- an exact street address or house number

Quasi-identifiers narrow the field until one person is left:

- a unique role: "I am the only accountant", "as the driver for the district officer"
- a place only one person occupies: "my desk", "the cash counter I run"
- exact dates and times only a witness would know: "at 4:15 on 3 March"
- rare job titles, small teams, or a recent transfer or promotion
- first-person access: "when I opened the ledger", "the file I was asked to sign"

Images carry their own risks:

- location and device details in metadata
- the reporter's face, or a reflection of it
- a screen showing a username, an email or an account name
- document headers, letterheads, file numbers and stamps that trace back to the one copy the reporter handled

## What the checker does

Text is checked by small rule-based detectors in `packages/shared`. Each finding has a type, the exact span of text, a severity, and a plain-language reason the reporter can read. The detectors cover emails, Nepali (+977) and UK phone numbers, ID and citizenship number patterns, vehicle plates, URLs that contain a personal handle, street addresses, and personal names from a small on-device list of Nepali and English names plus capitalisation rules.

Quasi-identifiers are caught by a short list of first-person phrases and patterns, such as "I am the only", "my desk" and exact clock times. Every rule has a test for a sentence it must not flag, because a checker that flags everything gets ignored. Exact dates and times are marked low severity: most reports need some, and they only become a risk when few people were there.

Images are checked for the things above where the device can do it:

- Photos are already re-encoded before storage (`apps/mobile/src/evidence.ts`), which drops EXIF, IPTC and XMP metadata including GPS. The checker confirms that step ran.
- Faces are detected and can be blurred with one tap.
- Visible text is flagged where an on-device text recogniser is available. The web preview has no native modules, so there the checker says it could not look rather than implying the image is clean.

The results appear as a privacy check step between Review and Submit. Each finding is highlighted in the text with three choices: fix it, redact it, or keep it anyway. The reporter can always submit.

## What it does not catch

The checker matches patterns. It does not understand the story, so a reporter should read its silence as "nothing obvious", never as "safe".

- Paraphrase. "The person who handles the petty cash on the second floor" identifies someone as well as a name does, and no pattern list will catch every wording.
- Knowledge only the reporter has. If only three people attended a meeting, describing what was said there narrows it to three, however it is phrased.
- Writing style. Word choice, spelling habits and sentence rhythm can identify an author. The checker does not attempt stylometry.
- Names outside its list, unusual spellings, and names written in Devanagari script until that is added.
- Metadata in documents and audio. Only photos are re-encoded. A PDF or Word file can still carry an author name, and the app already warns about this when one is attached.
- Images where face or text detection is not available, and faces that are partly hidden, small or at an angle.
- Details in the area field. Location is already capped at a four-character geohash (about city level, `apps/mobile/src/geo.ts`), so the checker does not re-check it.

False positives are expected too. A number that looks like an ID may be a case number the reporter wants to keep. That is why every finding offers "keep anyway".

## Why it runs on the device

The draft is the most sensitive thing the app ever holds: plaintext, written by the reporter, before any of it is encrypted. Sending it to a server or a cloud AI service to be checked would create exactly the copy the rest of the design avoids. That copy could sit in a provider's logs, next to the reporter's IP address and the time, readable by the provider and by anyone who can compel the provider.

So the checker makes no network requests. It is plain TypeScript and a few bundled word lists, it works offline, and anyone can confirm it with a network inspector while the check runs. The cost is that a small rule-based checker is less clever than a large model. A checker that leaks is worse than one that misses things, because a reporter can be told what it misses.

## How well it works

Each detector will be measured against a labelled set of synthetic reports written for the purpose, with no real people in them. `npm run eval:leaks` will run the set and print precision and recall per detector, and the results will be copied here unchanged.

No measurements exist yet.
