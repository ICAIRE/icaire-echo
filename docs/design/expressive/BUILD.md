# Build brief: design A into the app

For: Astra. The owner chose **direction A** (`docs/design/expressive/direction-a.html`). Build it into the real app's
Voice-overs page. You own the interface: markup, styles, and the page's own script. The engine and the server are done
and tested; call them exactly as described below. Do not change `server.js`, `lib/`, `voice/` or `test/` (if the
interface needs something the server does not give, write it under "Requests" at the end of this file and carry on
with a placeholder).

## Files

- `ui/index.html`: section `#viewVoice` and the `#voPanel` panel (left inspector).
- `ui/voice.js`: the page's script. Helpers from `ui/app.js` are global: `$`, `el`, `api(path, body)` (POST with the
  required header, throws on an error answer with the server's message), `icon(name)`, `mmss`, `bytes`, `plural`.
- `ui/style.css`, `ui/icons.js`: add only what is new; reuse what is there.
- Keep everything that works today in Standard: the 54 voices with search and the language dropdown, Pacing, samples,
  the advanced settings, Japanese and Chinese extras, the result player, the list on the right, cancel, downloads.

## The owner's rules (non-negotiable)

- Not confusing. Someone who never opens Expressive sees a page as simple as today's or simpler.
- Fewest clicks. No layout shift between states or engines; the script box never changes size when menus open.
- Tags work like ElevenLabs: cursor in the script, pick from the single **Insert tag** menu (or type `[`), and the tag goes in at the cursor with a space on each side.
  - Moods and Voice wrap the selection when there is one.
  - Pauses insert `[pause 0.5s]`, `[pause 1s]`, `[pause 2s]`, `[pause 4s]`.
  - Voice inserts `[voice Michael]…[/voice]`.
- Switching voices inside one script stays: the Voice column lists the voices of the chosen engine (Expressive: the ready ones and the person's own).
- Look: DESIGN.md. Dark midnight room, flat cards, lime for the primary action and the selection, Lucide two-tone icons.
  - No shadows, no glow, no gradients, no 3D.
  - Cards of one kind are one size.
  - Fits the window except long lists.
  - Works from 900 px wide.
  - No em dashes in visible text.
- Arabic and Hebrew scripts run right to left (`dir="rtl"` on the script box when that language is chosen).

## What the menu offers

| Group | Standard | Expressive, English | Expressive, other languages |
|---|---|---|---|
| Pause | ½ s, 1 s, 2 s, 4 s | same | same |
| Mood | Angry, Happy, Sad, Excited, Surprised, Calm, Serious, Whisper, Shouting, Normal | same, plus Scared, Sarcastic, Dramatic, Crying | same as English |
| Sound | Laugh, Sigh, Breath (approximations: one short line says so) | Laugh, Chuckle, Sigh, Gasp, Cough, Groan, Sniff, Shush, Clear throat | none (hide the column) |
| Voice | the Kokoro voices (as today) | the Expressive voices | the Expressive voices |

Tags as written: `[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`, `[cough]`, `[groan]`, `[sniff]`, `[shush]`, `[clear throat]`,
`[breath]`, `[angry]`, `[happy]`, `[sad]`, `[excited]`, `[surprised]`, `[calm]`, `[serious]`, `[whisper]`,
`[shouting]`, `[scared]`, `[sarcastic]`, `[dramatic]`, `[crying]`, `[normal]`.

## The server (all JSON; POSTs need header `x-mrb: 1`, which `api()` adds)

**Expressive state**: `GET /api/expressive` returns:

```
{ installed: bool, downloadBytes, missingBytes,
  languages: [{ code, name, rtl, sounds, intensity }],   // 23; sounds only for en, intensity for all but en
  voices: [{ id, name, about?, own, seconds?, createdAt? }],  // 6 ready (own:false) then the person's (own:true)
  defaults: { lang: 'en', voice: 'heart', intensity: 0.5 },
  setup: null | download snapshot }
```

**Download** (1.5 GB, once):
- Start it with `POST /api/expressive/setup` and cancel it with `POST /api/expressive/setup/cancel`; both return a snapshot.
- A snapshot is `{ status: running|done|error|cancelled, got, total, percent, error }`.
- Live progress arrives in the event stream: app.js calls `window.onVoiceState(data)` with `data.expressiveSetup` (a snapshot or null).
- When status becomes `done`, fetch `/api/expressive` again.
- A cancelled or failed download resumes where it stopped when started again.

**Make a voice-over**: `POST /api/voice/generate` with:

```
{ text, preset: VO.preset, changes: { ...nest(VO.changes), engine: 'expressive', expressive: { lang, voice, intensity } } }
```

- Standard sends no `engine` (or `engine: 'standard'`).
- Progress, cancel, the result and the list work exactly as today (`data.voice` in the event stream).
- Expressive is slower: the snapshot's `etaSec` gives the time left. Show it.
- The first Expressive job after the app starts spends about 8 s loading.
- Errors: 400 `{ error, needsExpressive: true }` when it is not downloaded.

**Hear a voice**: `POST /api/expressive/sample { voice, lang }` returns `{ url }` of a short sample.
- The first time takes about 8 s, so show the row's play button as busy. After that it is instant.
- It answers 400 for a language without a sample text; hide or disable play there.
- It answers 409 while a voice-over is being made.

**A voice from a recording**: `POST /api/expressive/voices?name=<name>&consent=1`.
- The body is the audio file itself (any type: a dropped or chosen file, or a `MediaRecorder` blob from the microphone).
- It returns the new voice `{ id, name, seconds, own: true }`.
- Errors come as 400 `{ error }`, shown as written:
  - no consent
  - no name or a duplicate name
  - fewer than 5 s of speech
  - unreadable audio
- Ask for: a name; the recording (record in the app, 10 to 30 s, with a timer, or choose a file); and a required checkbox, "The person speaking agreed to their voice being copied."

**Delete one**: `POST /api/expressive/voices/remove { id }` returns `{ ok, voices }`. Only own voices.

**List on the right**: `GET /api/voiceovers` now also gives `engine` ('standard' | 'expressive') and `voiceName` for
Expressive ones; show the Expressive voice's name instead of the Kokoro voice for those.

## Remember per person

Store in the existing `localStorage` key `mrb.vo` (try/catch, as now):
- the engine
- the Expressive language, voice and intensity
- the script

Start in Standard. Picking Expressive when it is not downloaded shows A's download card in the voice panel. The rest of the page stays where it is.

## Done means

- Every state works in the real app, served by `npm start` (or `test/ui-demo-server.js`):
  - Standard as today
  - Expressive not downloaded, downloading, cancelled
  - Expressive ready in English and in Arabic (RTL)
  - recording a voice, choosing a file, deleting one
  - the Insert tag menu in each engine and language, typing `[`
  - making a voice-over with time left, and the result
- Checked at 1440x900 and 1000x700 with nothing clipped or overlapping.
- `node --test test/ui.test.js` still passes. Do not commit.

## Requests

- Please include a `sample` boolean on each language in `GET /api/expressive`, derived from the sample texts. (Done: each language now has `sample`.) The picker uses the current language list from `voice/expressive.json` as a fallback so it can hide unavailable previews today.
