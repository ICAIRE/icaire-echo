# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The owner and their teammates, most of them non-technical, each running the app on their own Windows PC or Mac. They run meetings in Google Meet, often around 8 people, in several languages (English and Arabic among them), with interruptions and overlapping speech. They use the control panel on the PC that runs the bot (http://localhost:4777) to send the bot into a call, keep an eye on it while the meeting runs, and afterwards find the recording and get a transcript that says who said what.

## Product Purpose
Meet Recorder is a bot that joins a Google Meet call as its own participant and records it: one video file, one audio file (`audio.wav`), and a log of who spoke when, taken from Meet's own speaking indicators. After the call, a local Whisper model (whisper.cpp, on the graphics card when there is one) turns the audio into a transcript and the speaker log labels each line with a name. Success: anyone on the team can send the bot, trust it is recording, and come back to a readable, copyable transcript with names, without knowing how any of it works.

Second tool (added 20 Nov 2026): **Voice-over**. Paste a script, pick a voice, get an MP3. The recommended voice is the Ideas City presentation's narrator with its exact settings (Kokoro af_heart, 0.94); the Manara FM radio hosts Layla and Omar are the second presets; all 54 Kokoro voices in 9 languages are available, and every setting is reachable under Advanced settings, hidden by default.

## Positioning
Nothing leaves the computer: no cloud service, no AI in the bot itself, no browser extension or OBS. The speaker names come from Meet's own speaking indicator, not from guessing voices, so overlaps and interruptions are kept with real names.

## Operating Context
- Launch: paste a Meet link, optionally rename the bot, press Join. A host in the meeting must admit the bot ("Waiting to be let in").
- During the call: recording clock, who is talking now, talk time per person, the bot's own view of the meeting, activity log, Stop & save.
- After the call: a list of recordings with date, length, speakers and turns; a whole-meeting speaker overview; Transcribe (with progress bar and time left), Copy transcript, Watch with speaker captions, Open folder, download files, upload an external Whisper file to merge.
- The bot needs a signed-in Google account set up once with `npm run login`; Meet refuses anonymous hidden browsers.

## Capabilities and Constraints
- One audio file per meeting; the user does not want a second one.
- The panel only listens on localhost and guards its API (x-mrb header, Host check).
- Live data arrives over Server-Sent Events from `/api/stream`; recordings come from `/api/recordings`; Whisper status from `/api/whisper`.
- Element IDs and classes used by `test/ui.test.js` must keep working (#url, .btn-join, #joinError, #live, #clock, .person, .person.speaking, .person-name, #preview, #lanes, #stats with .stat dd, #stopBtn, #doneSub, .rec-item, .rec-files a, .act-watch, .rec-player video, .act-merge input, .rec-transcript).
- Transcription can take minutes; only one runs at a time.

- Voice-over presets must stay identical to the Ideas City sources (checked by test/voice.test.js against the presentation's audio).
- Kokoro has no Arabic; Japanese and Chinese need an optional language pack.
- First run on a new computer installs everything itself (Start Meet Recorder.cmd / .command); big models download inside the app with progress.

## Brand Commitments
Name: "Meet Recorder". Plain, everyday wording; no jargon such as "indicator signals" or "streams" in front of non-technical teammates.

## Evidence on Hand
Real recordings in `recordings/` (some test meetings with silent audio). A demo server (`npm run demo`, port 4778) fakes an 8-person meeting for trying the panel. No testimonials, customers or metrics exist; none should be invented.

## Product Principles
1. Always show what the bot is doing right now and what the user should do next.
2. The transcript with names is the payoff; make it the easiest thing to reach and copy.
3. Everything stays on this computer, and the interface can say so plainly.
4. Teammates who have never seen it should understand each screen without help.

## Accessibility & Inclusion
Transcripts mix right-to-left (Arabic) and left-to-right text; each line must keep its own direction. Speaker colours must not be the only way to tell people apart (names always shown).
