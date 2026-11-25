# ICAIRE Echo

Record a meeting, get a transcript with everyone's name on their lines, and turn a script into a
voice-over. It all runs on your own computer. Nothing is uploaded.

- **Record.** Send a bot into a Google Meet call, or record this computer's microphone and the call's
  sound (works for Zoom and Teams too). When you stop, the transcript is written on its own.
- **Voice-overs.** Paste a script, pick a voice, get an MP3. 54 voices in 9 languages.

Made at [ICAIRE](https://icaire.org), the International Center for AI Research and Ethics.

## Install

Download the installer from the [latest release](https://github.com/ICAIRE/icaire-echo/releases/latest):

- **Mac** (Apple silicon, macOS 13.5 or newer): open `ICAIRE-Echo-<version>-mac.dmg` and drag
  **ICAIRE Echo** to **Applications**. The first time, macOS says it can't check the app: open
  **System Settings › Privacy & Security** and press **Open Anyway** (or right-click the app and choose
  **Open**).
- **Windows** (10 or 11, 64-bit): run `ICAIRE-Echo-<version>-windows-setup.exe`. If Windows warns you,
  choose **More info › Run anyway**. It installs for you only and needs no administrator.

That's all. Node.js, the app's parts and the transcriber are inside the app. It opens in your browser at
<http://localhost:4777>; **Quit ICAIRE Echo** is under **More**.

The large files download from inside the app the first time you need them:

| | Size |
|---|---|
| A transcriber model (you choose under **More › Models and storage**) | 0.5 to 3.1 GB |
| Voices, for voice-overs | 354 MB |
| Speaker models that tell voices apart | 32 MB |
| Japanese or Chinese pronunciation, only if you use those voices | 29 MB / 20 MB |

The bot also needs Google Chrome.

## Use it

**Record a Google Meet call.** Choose **Bot joins a Meet**, paste the link and press the button, then
let the bot in from Meet. Press **End** when you're done, or the bot leaves when the meeting ends.

The first time, sign the bot in to a Google account: **More › Sign the bot in to Google** opens a window
where you sign in, then close it (a separate account is best). Google doesn't let anonymous bots into most
meetings. **More** shows whether the bot is signed in.

**Record on this computer.** Press the microphone. With **Call sound** on, the call is recorded too:
when the browser asks what to share, pick the meeting's tab and keep **Also share tab audio** on (on
Windows, **Entire screen** with **Also share system audio**). Tap the button to pause and again to carry on.

The transcript says who spoke as *Speaker 1*, *Speaker 2* and so on: the app tells the voices apart on
this computer. Give each one a name under **People**; the whole transcript follows.

**Make a voice-over.** Open **Voice-overs**, paste your script, pick a voice on the left and press
**Create voice-over**. Put the cursor where you want silence and press a pause button. Voices go by
Kokoro's own names (Heart, Bella, Fenrir…); **Pacing** sets how the voice reads.

## Your files

Your recordings, voice-overs, models and the bot's sign-in are kept apart from the app, so a new version
never touches them:

- **Mac:** `~/Library/Application Support/ICAIRE Echo`
- **Windows:** `%APPDATA%\ICAIRE Echo`

Each recording has **Download** (transcript, subtitles, Markdown, audio) and **Show in Finder** (or
**Show in File Explorer**). A recording folder holds:

| File | What it is |
|---|---|
| `audio.wav` | Everyone's audio, 16 kHz mono |
| `video.mp4` | The meeting as the bot saw it (bot recordings) |
| `speakers.csv`, `.srt`, `.json` | Who talked, from when to when |
| `transcript.txt`, `.srt`, `.json` | The transcript with names |
| `whisper.json` | The transcriber's raw output, with a time for every word |
| `meta.json` | The recording's details |

## Updates

ICAIRE Echo checks GitHub for a new version every few hours. When there is one, **More › Check for
updates** shows it and opens the download page; install the new version over the old one.

## Good to know

- **Who said what** in a bot recording comes from Meet's own "speaking" highlight on each person's tile.
  Everyone needs a visible tile, so avoid screen sharing during the parts you care about.
- **Mixed languages work.** Each stretch of speech gets its own language, so an Arabic remark in an
  English meeting comes out in Arabic.
- **Tell people they're being recorded.** It's required in many places, and the bot shows up in the
  participant list anyway.
- **Kokoro has no Arabic voice.** The voices are English (US and UK), Spanish, French, Hindi, Italian,
  Brazilian Portuguese, Japanese and Mandarin.

## For developers

```
npm ci
node setup.js             # once: the transcriber (Homebrew on a Mac, the official build on Windows)
npm start                 # the app, at http://localhost:4777
npm test                  # everything (a few minutes)
npm run demo              # the app with a fake 8-person meeting
npm run build:mac         # dist/ICAIRE-Echo-<version>-mac.dmg (on an Apple silicon Mac)
npm run build:windows     # dist\ICAIRE-Echo-<version>-windows-setup.exe (needs Inno Setup 6)
```

A copy run from the code keeps its data next to the code. Pushing a tag `v<version>` builds both
installers on GitHub and publishes them as a release (`.github/workflows/release.yml`).

Transcription is [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Voice-over is
[Kokoro](https://github.com/hexgrad/kokoro) on onnxruntime, with [eSpeak NG](https://github.com/espeak-ng/espeak-ng)
in WebAssembly for pronunciation. Speakers are told apart with sherpa-onnx.

Settings you can set in the environment: `PORT`, `WHISPER_CPP` (path to `whisper-cli`), `WHISPER_MODEL`
(a ggml model file), `KOKORO_MODELS` (a folder with the voice files), `ECHO_DATA` (where your things go)
and `MRB_NO_AUTO_UPDATE=1`.

## Credits and license

Built on whisper.cpp (MIT), Kokoro (Apache 2.0) and kokoro-onnx (MIT), eSpeak NG (GPL 3.0), onnxruntime
(MIT), sherpa-onnx (Apache 2.0), the Silero voice detector (MIT), Node.js (MIT), and for Japanese and
Chinese: jpreprocess with NAIST-JDIC, jieba and pypinyin. Each keeps its own license.

ICAIRE Echo itself is released under the [MIT License](LICENSE).
