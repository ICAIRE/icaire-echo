# Meet Recorder

Record a meeting, get a transcript with everyone's name on their lines, and turn a script into a
voice-over. It all runs on your own computer. Nothing is uploaded.

- **Transcribe.** Send a bot into a Google Meet call, or record this computer's microphone and sound
  (works for Zoom and Teams too). When it's done you get a transcript you can read and copy.
- **Voice-over.** Paste a script, pick a voice, get an MP3. 54 voices in 9 languages.

Made at [ICAIRE](https://icaire.org), the International Center for AI Research and Ethics.

## Install

You need a Mac or a Windows PC. Download this project ([as a zip](https://github.com/ICAIRE/meet-recorder-bot/archive/refs/heads/main.zip)
or with `git clone`), then:

- **Windows:** double-click `Start Meet Recorder.cmd`.
- **Mac:** double-click `Start Meet Recorder.command`. If the Mac says it can't be opened, right-click
  it, choose **Open**, then **Open** again.

The first start installs what's missing (Node.js, the app's parts, and the transcriber) and opens
the app in your browser at <http://localhost:4777>. Keep the black window open while you use it.

The large files download from inside the app the first time you need them:

| | Size |
|---|---|
| Voices, for Voice-over | 354 MB |
| Whisper model, for Transcribe | 1.6 GB (3.1 GB on a PC with an NVIDIA graphics card) |
| Japanese or Chinese pronunciation, only if you use those voices | 29 MB / 20 MB |

## Use it

**Record a Google Meet call.** Paste the meeting link and press **Join meeting**, then let the bot in
from Meet. The panel shows who is talking as it happens. Press **Stop & save** when you're done, or
the bot leaves by itself when the meeting ends. The transcript starts on its own.

The first time, run `npm run login` in the app's folder and sign the bot into a Google account (a
separate account is best). Google doesn't let anonymous bots into most meetings. The bot also needs
Google Chrome.

**Record without the bot.** Press **Record** to record this computer's microphone. Leave **Also record
the people in my call** on to capture the call's sound as well: when the browser asks what to share,
pick **Entire screen** and turn on **Also share system audio** (on a Mac, pick the meeting's tab and
keep **Also share tab audio** on).

**Make a voice-over.** Open **Voice-over**, paste your script, choose a voice and press **Create
voice-over**. Each line of the script is read in one go, and an empty line makes a longer pause.
**Presenter** is the narrator of the Ideas City presentation with the same settings. **Layla** and
**Omar** sound like radio hosts. **Advanced settings** shows everything else.

## Your files

Everything stays in the app's folder:

- `recordings/`: one folder per meeting with the video, the audio (`audio.wav`), who spoke when, and
  the transcript.
- `voiceovers/`: one folder per voice-over, as MP3 and WAV.

Each recording and voice-over in the panel has its files as downloads and a **Show in Finder** (or
**Show in File Explorer**) button.

A recording folder holds:

| File | What it is |
|---|---|
| `video.mp4` | The meeting as the bot saw it |
| `audio.wav` | Everyone's audio, 16 kHz mono |
| `speakers.csv`, `.srt`, `.json` | Who talked, from when to when |
| `transcript.txt`, `.srt`, `.json` | The transcript with names |
| `whisper.json` | Whisper's raw output, with a time for every word |
| `meta.json`, `events.ndjson` | The meeting's details, and the raw speaking log |

## Updates

The app checks for a new version every few hours and installs it when nothing is recording or being
made, then restarts by itself. You can also press **Check for updates** at the top. Your recordings,
voice-overs and downloaded models are never touched.

The models are not part of the app: they download once into `models/`. Each one is pinned to an
exact file, so a voice never changes under you; when a newer model is worth switching to, an app
update brings the new pin and the panel offers the download.

## Good to know

- **Who said what** comes from Meet's own "speaking" highlight on each person's tile, which the bot
  watches. It's usually within half a second. Everyone needs a visible tile, so avoid screen sharing
  during the parts you care about.
- **Mixed languages work.** The transcriber cuts the speech at pauses and wherever the speaker changes,
  and works out the language of each piece, so an Arabic remark in an English meeting comes out in
  Arabic.
- **Tell people they're being recorded.** It's required in many places, and the bot shows up in the
  participant list anyway.
- **Kokoro has no Arabic voice.** The voices are English (US and UK), Spanish, French, Hindi, Italian,
  Brazilian Portuguese, Japanese and Mandarin.
- If Google changes Meet a lot, the bot may need an update to join or to see who's talking.

## Already have a transcript?

Use **Add Whisper file…** on a recording, or the command line, to put names on a transcript you made
elsewhere (Whisper JSON, `.srt` or `.vtt`):

```
npm run merge -- recordings/<date> audio.json
```

## For developers

Node.js 20 or newer. Transcription is [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(`whisper-cli`, from Homebrew on a Mac or the official build on Windows). Voice-over is
[Kokoro](https://github.com/hexgrad/kokoro) run with onnxruntime, with
[eSpeak NG](https://github.com/espeak-ng/espeak-ng) in WebAssembly for pronunciation.

```
npm ci
npm start                 # the panel, at http://localhost:4777
npm run record -- <meet link> [--show]   # the bot without the panel; --show shows its Chrome
npm test                  # everything (about 3 minutes)
npm run demo              # the panel with a fake 8-person meeting
```

`npm run test:whisper` and `npm run test:voice` need the models; they skip themselves without them.
The tests run the bot against a scripted fake Meet, so nothing goes over the network.

Settings you can set in the environment: `PORT`, `WHISPER_CPP` (path to `whisper-cli`),
`WHISPER_MODEL` (a ggml model file), `KOKORO_MODELS` (a folder with the voice files) and
`MRB_NO_AUTO_UPDATE=1`. A copy with changes of its own is never updated automatically.

## Credits and license

Built on whisper.cpp (MIT), Kokoro (Apache 2.0) and kokoro-onnx (MIT), eSpeak NG (GPL 3.0),
onnxruntime (MIT), the Silero voice detector (MIT), and for Japanese and Chinese: jpreprocess with
NAIST-JDIC, jieba and pypinyin. Each keeps its own license.

Meet Recorder itself is released under the [MIT License](LICENSE).
