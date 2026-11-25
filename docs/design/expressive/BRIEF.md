# Design brief: Voice-overs with an Expressive option

For: Astra (interface and prototypes only). Backend, engine and wiring are done separately; do not change any file
outside `docs/design/expressive/`.

## The product

ICAIRE Echo is a desktop app (Mac and Windows) that records meetings and writes transcripts with speaker names, and
turns scripts into voice-overs. Everything runs on the computer; nothing is uploaded. It is used by ICAIRE staff, most
of them not technical. Read `DESIGN.md` (the rules) and look at `docs/design/expressive/current-voiceovers.jpg` (the
Voice-overs page today). The page's code is `ui/index.html` (section `#viewVoice` and the `#voPanel` panel),
`ui/style.css` and `ui/voice.js`.

## What changes

Voice-overs gets a second engine.

- **Standard** (Kokoro, today's engine, the default). Fast, the most natural plain narration, 54 voices in 9
  languages, no Arabic. Its "moods" (Angry, Happy, Sad…) are only speed, pitch and loudness changes, and "Laughs" is
  the voice saying "ha ha".
- **Expressive** (Chatterbox). Real laughs, sighs, gasps and other sounds, stronger emotion, Arabic, and a voice made
  from a short recording. Slower (about real time), and a one-time download of about 1 to 2 GB the first time it is
  chosen.

**The most important rule: it must not get confusing.** Someone who never opens the advanced option should see a
page as simple as today's or simpler: script, voice, Create. Expressive is one clearly marked step further, chosen on
purpose, and it says plainly what it adds and what it costs (download size, slower).

## What Expressive needs on screen

1. **Choosing the engine:** Standard (default) or Expressive. Where it lives is the main design question.
2. **First-time download:** before Expressive can be used, a download of about 1 to 2 GB with progress; it can be
   cancelled; afterwards it works offline.
3. **Language:** English, Arabic, and about 20 more (Expressive). Arabic text runs right to left in the script box.
4. **Voice:** a few ready voices, plus **"Make a voice from a recording"**: the person adds a clear 10 to 30 second
   recording (or records one) and confirms the speaker agreed to it being copied. Their voices are listed with the
   ready ones and can be deleted.
5. **Intensity:** one control for how strongly emotion comes through (calm to dramatic), default in the middle.
6. **Tags in the script**, inserted at the cursor like today's pause buttons:
   - Sounds, Expressive and English only: laugh, chuckle, sigh, gasp, cough, groan, sniff, shush, clear throat.
   - Moods (both engines): Angry, Happy, Sad, Excited, Surprised, Calm, Serious, Whisper, Shouting, Normal.
   - Pauses (both engines): ½ s, 1 s, 2 s, 4 s.
   - Another voice for a part (both engines).
   Today these are three rows of buttons above the script (see the screenshot), which is too much. Find a calmer way
   to offer them, for example one "Insert" control, a slash menu in the text box, or chips that appear on demand.
   Tags show in the script as text like `[laugh]` or `[angry]`; consider showing them as small pills.
7. **What each engine can do** should be honest without a lecture: a tag the chosen engine cannot really do (Standard
   cannot laugh) is either hidden, or marked as an approximation.
8. **Making it:** the Create button, the progress while it is made (Expressive is slower: show time left), the
   result with a player, and the list of voice-overs on the right.

## The look (non-negotiable)

- Follow `DESIGN.md` and the existing app: the dark midnight room, flat cards, lime for the primary action and for what
  is selected, the same type, the same icons (Lucide, two-tone, see `ui/icons.js`).
- **No shadows, no 3D, no glow, no tilted shapes, no gradients that suggest depth.** Depth comes from borders and tints.
- Cards of one kind are one size. The page fits the window without scrolling except where a list is long.
- It must work from 900 px wide up, and stay usable on a narrow window.

## What to make

Three different directions for the Voice-overs page, each as one self-contained HTML file in
`docs/design/expressive/` (`direction-a.html`, `direction-b.html`, `direction-c.html`), with static sample data and
just enough inline script to switch states: Standard chosen; Expressive chosen but not yet downloaded; Expressive
ready with Arabic and a voice made from a recording; the insert-a-tag control open; a voice-over being made.
Link `../../../ui/style.css` and `../../../ui/icons.js` so they use the real styles and icons, and put anything new in a
`<style>` block in the file.

Then write `docs/design/expressive/DIRECTIONS.md`: one short paragraph per direction (the idea, where Expressive
lives, how tags are offered), and which one you recommend and why.

Do not edit anything outside `docs/design/expressive/`, do not install packages, do not commit.
