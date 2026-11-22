---
name: Meet Recorder
description: A local control panel that sends a bot into Google Meet, shows it live like an interpreter's booth console, hands back a transcript with names, and turns a script into a voice-over.
colors:
  ground: "#e7e3db"
  face: "#f4f1eb"
  face-2: "#fbfaf7"
  seam: "#d5d0c5"
  seam-2: "#c4beb1"
  ink: "#1d1e21"
  ink-2: "#4d4f56"
  ink-3: "#686a72"
  key: "#26282c"
  key-hover: "#383b41"
  key-ink: "#f7f5f0"
  lcd: "#17181a"
  lcd-ink: "#ffb02e"
  lcd-dim: "#8a6d33"
  playhead: "#fff3d6"
  rec: "#d7322a"
  rec-ink: "#b4231c"
  ok: "#24804f"
  warn: "#9a5b00"
  warn-soft: "#fbecd2"
  lamp-wait: "#e09a1a"
  focus: "#1f5fd1"
  speaker-1: "#2f6fdb"
  speaker-2: "#0f8a7e"
  speaker-3: "#8a4fe0"
  speaker-4: "#d0621f"
  speaker-5: "#c23b7a"
  speaker-6: "#2e9a4a"
  speaker-7: "#b88a12"
  speaker-8: "#5560d8"
  speaker-9: "#1590a8"
  speaker-10: "#a35a2a"
  speaker-11: "#9c3fb5"
  speaker-12: "#5f8a1a"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.25
  module-title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.5
  item-title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.5
  key-title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
  script:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  speech:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.55
  small:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label-lg:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.5
  label-md:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
  label-sm:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  meta:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  readout:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, sans-serif"
    fontSize: "38px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
    fontFeature: "tnum"
  legend:
    fontFamily: "Segoe UI Variable Display, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
  mono:
    fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  led: "2px"
  keycap: "6px"
  sm: "8px"
  md: "10px"
  face: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  page: "28px"
components:
  key-primary:
    backgroundColor: "{colors.key}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.md}"
    padding: "11px 18px"
    height: "44px"
  key-primary-hover:
    backgroundColor: "{colors.key-hover}"
  key-quiet:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 18px"
    height: "44px"
  key-sm:
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: "34px"
  key-create:
    backgroundColor: "{colors.key}"
    textColor: "{colors.key-ink}"
    typography: "{typography.key-title}"
    rounded: "{rounded.md}"
    padding: "0 28px"
    height: "52px"
  key-delete-confirm:
    backgroundColor: "{colors.key}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: "34px"
  tab-tray:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.md}"
    padding: "3px"
  tab-key:
    textColor: "{colors.ink-2}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "34px"
  tab-key-selected:
    backgroundColor: "{colors.key}"
    textColor: "{colors.key-ink}"
  field-input:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 13px"
    height: "44px"
  script-well:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    typography: "{typography.script}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
    height: "280px"
  switch:
    backgroundColor: "{colors.seam-2}"
    rounded: "{rounded.pill}"
    width: "40px"
    height: "24px"
  switch-on:
    backgroundColor: "{colors.key}"
  module:
    backgroundColor: "{colors.face}"
    rounded: "{rounded.face}"
    padding: "24px"
  warn-card:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.face}"
    padding: "20px 24px"
  lcd:
    backgroundColor: "{colors.lcd}"
    textColor: "{colors.lcd-ink}"
    typography: "{typography.readout}"
    rounded: "{rounded.md}"
    padding: "10px 18px 11px"
  meter-window:
    backgroundColor: "{colors.lcd}"
    rounded: "{rounded.md}"
    padding: "10px 12px 6px"
    height: "104px"
  player-window:
    backgroundColor: "{colors.lcd}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
    height: "40px"
  play-key:
    backgroundColor: "{colors.face}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "38px"
  delegate-key:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.keycap}"
    padding: "8px 10px 9px"
  voice-key:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 60px 12px 14px"
  voice-row:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 8px 7px 12px"
  reset-key:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.keycap}"
    size: "26px"
  chip:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "3px 10px 3px 8px"
  count-chip:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  onair-pill:
    backgroundColor: "{colors.face-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "6px 8px 6px 12px"
    height: "36px"
---

# Design System: Meet Recorder

## Overview

**Creative North Star: "The Interpreter's Booth Console"**

The panel is the console a conference interpreter sits at, not a dashboard of cards. One lamp says whether you are live, one key per person lights while they speak, a recessed black LCD counts the time in amber, and the meeting's sound scrolls past in a black meter window like a voice recorder. The hardware is light putty with charcoal keys; every surface is one flat plane with hairline seams, and depth comes from a one- or two-pixel key travel edge and recessed (inset-shadowed) windows rather than from floating cards.

The console has two tools, switched by a two-key tab tray in the top strip: Transcribe (the meeting room) and Voice-over (the same booth turned to speak instead of listen). Voice-over reuses the console's parts rather than inventing new ones: a recessed script well, a column of voice keys with LEDs, one large charcoal Create key under both, results played back in a small black meter window, and every engine setting folded away under Advanced.

Density is calm and operational: generous 24px module padding at rest, tighter 14 to 20px seams once live. Type is the system UI face throughout (Segoe UI Variable on the target PC), with tabular figures on every number so clocks, talk-times and percentages never jitter. A dark variant follows the operating system (`prefers-color-scheme: dark`) unless `data-theme="light"` is set: the putty goes graphite, the charcoal keys invert to bone, and the LCD stays black with amber digits.

The direction explicitly refuses tiled dark stat panels. Hardware styling stays flat and readable: travel edges and recesses, never gradient bevels or glossy keycaps.

**Key Characteristics:**
- One console face while live: deck, sound meter and booth share a single bordered surface split by 1px seams.
- Black LCD windows (clock, meter, bot view, voice-over player) are the only dark surfaces in light mode; amber lights only while recording.
- Red means recording or failure. It is never decoration, and never a confirm.
- Selection is charcoal: the chosen tab, the chosen voice and every switch that is on take the key colour.
- Each person owns a stable colour from a 12-step palette, always paired with their name.
- Tabular figures for every number; system UI type, no webfonts.

## Colors

A warm, low-chroma putty neutral system with charcoal keys, one amber readout colour that lives only inside black LCD windows, one red for live/fail, and a 12-colour speaker palette that is the only polychrome on the page.

### Primary
- **Charcoal Keycap** (key): the fill of every primary key (Join meeting, Stop & save, Transcribe, Copy transcript, Record another, Download the voices, Create voice-over), the selected tab key, the lit LED on a chosen voice key, the border of a chosen voice, a switch that is on, the numbered step badges, the progress-bar fill, range and checkbox accents, and the armed Delete confirm. Hover lifts to **Worn Keycap** (key-hover). Text on it is **Bone Legend** (key-ink). In dark mode the key inverts to bone (#eeece7) with near-black legends, so the voice LED and the selected tab light bone there.

### Secondary
- **Amber LCD Digit** (lcd-ink): recording-time digits, the REC legend and the live waveform bars, and only while `data-status="recording"`. The clock adds a faint amber glow (`text-shadow: 0 0 12px rgba(255,176,46,.35)`) when lit.
- **Unlit Segment** (lcd-dim): the LCD's resting state: the waveform centre line, the REC legend and digits while idle, the top-strip time pill when not recording, and the not-yet-played bars of the voice-over player. It reads as unlit but still clears the 3:1 large-text floor on the lcd ground (about 3.6:1). Small readable text on the LCD uses lcd-ink.
- **Cream Playhead** (playhead): the 2px playhead in every meter window (live meter and voice-over player) and the already-played bars of the voice-over player. It is the playback light; amber is the recording light.

### Tertiary
- **ON AIR Red** (rec): the lamp while recording (breathing), the lamp on error, and the round Record key's centre dot. **Signal Red Text** (rec-ink) carries red as text: form errors, transcription and voice-over errors, the error-state headline, the ON AIR legend while recording.
- **Speaker palette** (speaker-1 to speaker-12): assigned in order of first appearance per name (`name:<display name>`) and cycled after twelve. Delivered as the `--c` custom property on delegate keys, speaker chips and transcript speaker dots, and drawn directly into the who-spoke-when lanes. Fixed across light and dark. Voice keys never use it: a voice is not a person in the meeting.

### Neutral
- **Putty Ground** (ground): page background behind everything, and the floor of the tab tray.
- **Console Face** (face): every console surface: top strip, modules, the live console, the done panel, recording items, the script and voice modules, the Advanced panel, voice-over items, and the play key.
- **Lit Face** (face-2): raised or inset parts on the face: inputs, the script well, quiet keys, delegate keys, voice keys and voice rows, chips, the ON AIR lens, the transcript well, result and progress wells, the reset key, the many-setting cluster, the switch knob.
- **Hairline Seam** (seam): the 1px dividers inside the console and the outline of every face; also an unlit LED and the lanes' time grid.
- **Deep Seam** (seam-2): borders of things you touch (inputs, quiet keys, delegate and voice keys, chips, play and reset keys) and their travel edges; the off lamp; a switch that is off.
- **Ink / Ink 2 / Ink 3** (ink, ink-2, ink-3): primary text, secondary text (ledes, field labels, unselected tab legends, setting labels), tertiary text (timestamps, hints, channel numbers, captions, disclosure triangles). The changed-setting dot is ink.
- **Status**: ok (green: done lamp, the voice-over Ready lamp, "sound is coming through", transcriber ready, the "clearest" voice tag, Copied), warn (brown-amber: no-sound warning, off-screen marker, finish notes, transcriber missing, and the 30%-mixed border of warn-tinted cards), focus (blue: focus rings and focused-field halo).
- **Warn Tint** (warn-soft; dark #3a2c16): the fill of warn-tinted cards only: the first-run "Get the voices" download card and the language-pack card under More voices. It marks "this needs one more step", not an error.
- **Waiting Lamp** (lamp-wait): the lamp while starting, joining, waiting, stopping or processing. Transitional only; it is never a fill or a text colour.
- **Track** (`rgba(29,30,33,0.05)` light / `rgba(255,255,255,0.04)` dark): empty lanes, the progress-bar trough, transcript "show more" hover.

### Named Rules
**The Red Means Live Rule.** Red appears only for recording (the ON AIR lamp, the Record key's dot, the REC legend) and for failure (error lamp, error text). If something is red and neither recording nor broken, it is wrong. A destructive confirm is not a failure: Delete arms to charcoal, not red.

**The Amber Stays In The Window Rule.** Amber digits and bars live only on the black LCD ground (lcd), and only light up while recording; outside it, nothing is amber except the warn status colour, the warn tint and the transitional waiting lamp. Playback is not recording: the voice-over player lights cream over lcd-dim, and a chosen voice key lights its LED in key colour, never amber.

**The Charcoal Means Chosen Rule.** Selection, on-state and commitment share the key colour: the selected tab, a chosen voice's LED and border, a switch that is on, the armed Delete. A second accent for "selected" is not needed and not wanted.

**The Name Beside The Colour Rule.** A speaker colour is never the only way to tell people apart: every dot, LED, chip and lane carries the person's name next to it.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI, system-ui, -apple-system, sans-serif)
**Body Font:** Segoe UI Variable Text (with Segoe UI, system-ui, -apple-system, sans-serif)
**Label/Mono Font:** Cascadia Mono (with Consolas, ui-monospace), only for file paths and raw error details

**Character:** The operating system's own face, so the panel reads like a native utility on the PC that runs it. Headings sit at a firm 650 weight; numbers use the Display optical size with tabular figures so they read like instrument readouts.

### Hierarchy
The ramp is dense at the small end, in half-pixel steps, because this is a console of labels. These are the sizes the stylesheet actually uses; nothing else should appear.
- **Display** (650, 32px, 1.15, -0.02em; 25px under 640px): the launch headline (max 24ch) and the Voice-over headline.
- **Headline** (650, 20 to 24px, 1.25): the done headline (24px), the Recordings and Your voice-overs headings (22px), the live status title (20px).
- **Module title** (650, 18px): module headings, the Script and Voice headings, the "Get the voices" card heading.
- **Item title** (650 at 17px): recording date. The same 17px carries the Meet-link slot text (400) and stat values (600, tabular).
- **Key title** (650, 16px): voice-key names and voice-over item dates; the Create voice-over legend sets 16px/600.
- **Script** (400, 16px, 1.6, plaintext bidi): the script well only.
- **Title** (650, 15px): console section heads (Sound, Who's talking, What the bot sees), the Advanced settings summary, the brand.
- **Body** (400, 15px, 1.5): running text; ledes max 62ch.
- **Speech** (400, 14.5px, 1.55, plaintext bidi): transcript text.
- **Small** (400, 14px): status sub-line, module text, empty states, form errors (500), voice-over item preview (two-line clamp), custom-voice line.
- **Label large** (600, 14.5px): key legends, person names, voice-row names, Advanced group summaries.
- **Label medium** (600, 14px): tab legends, disclosure summaries (Files and activity, More voices), switch-row inputs and range outputs, transcript title (650).
- **Label small** (600, 13.5px): small-key legends, the ON AIR pill; at 400 it carries setting labels, voice descriptions, recording facts, notes.
- **Label** (600, 13px): field labels (ink-2), speaker chips (500), meta lines and the error Details summary (400).
- **Meta** (400, 12.5px, ink-3): timestamps, hints, captions, stat terms, units.
- **Micro** (600, 12px): the "N changed" chip, pronunciation column heads (400), step badges, raw error code (mono), the player time on phones.
- **Readout** (600, 38px, tabular; 28px under 640px): the LCD clock. Smaller readouts reuse the family: top-strip time 14px, transcription percent 20px/650, the player time 13px/600 in ink-2.
- **Legend** (700, 9.5 to 11.5px, 0.12 to 0.14em tracking, uppercase in source): hardware legends only: REC on the LCD, ON AIR on the lens, the phone REC tag, delegate channel numbers (600, 11px, 0.04em), and the voice key's "Recommended" mark (600, 11.5px, 0.02em, sentence case, ink-2).

### Named Rules
**The Tabular Figures Rule.** Every number that changes or lines up (clocks, talk times, percentages, file sizes, timestamps, channel numbers, setting values, the player time) sets `font-variant-numeric: tabular-nums`.

**The Legends Are Hardware Rule.** Spaced uppercase micro-type is reserved for printed-on-the-console legends (REC, ON AIR, channel numbers). Headings, section labels, tabs and the "Recommended" mark stay sentence case.

## Layout

A single centred column (max 1240px; padding 32px 28px 96px) under a sticky top strip (12px 28px) that always shows the brand, the tab tray, and the lamp, state and time. The ON AIR pill stays in the strip on both tabs, so a running recording is visible while you work on a voice-over.

- **Transcribe, idle:** headline and lede, then two modules side by side at 1.65fr : 1fr with a 16px gap: "Send the bot to a Google Meet" (link slot, name + Join row, checkbox, four numbered steps in a 4-column strip) and "Or record here" (centred round Record key).
- **Transcribe, live:** one console face with three bands split by 1px seams: the deck (status at left; LCD and Stop at right; grid `1fr auto auto`, 24px gap), the full-width sound meter, then the booth at 1.7fr : 1fr: who's talking (delegate keys plus lanes) on the left, the bot's view and a "Files and activity" disclosure in a side column separated by a vertical seam. A local microphone recording hides the booth and grows the meter to 160px.
- **Recordings:** a 12px-gap list of faces, each with title/facts and a primary key on top, speaker chips, progress or transcript, then an actions row behind a seam.
- **Voice-over:** headline and lede; a warn-tinted first-run card when the voices are missing (it dims the desk and Advanced to 55% and makes them inert); the desk at 1.55fr : 1fr with a 16px gap (Script module, Voice module); then the Create row below both so the order is script, voice, create at every width; then the progress or result well; the Advanced settings face; and "Your voice-overs" 40px below.
- **Advanced settings:** a full-width face whose groups are stacked bands split by seams; inside a group, setting rows sit in a 2-column grid (8px 28px gap) and a switch is clustered with the settings it controls.

Spacing steps in practice are 4, 8, 12, 16, 20, 24 and 28px, with 40 to 48px between major sections.

**Responsive:**
- **At 960px and below:** modules, the booth and the voice desk stack to one column; Advanced rows and the pronunciation editor go to one column; the side column swaps its left seam for a top seam; the steps strip goes to 2 columns.
- **At 640px and below:** page padding 20px 16px 72px; top strip 10px 16px and wraps, with the tab tray taking a full-width third row and the two tab keys sharing it equally; headlines 25px; modules pad 18px (voice modules 16px); the Join and Create keys go full width; the script well drops to 200px; steps go to one column; the deck becomes `1fr auto` with the status row spanning the top and LCD + Stop below (LCD padding 8px 12px, clock 28px); console bands pad 12 to 14px; delegate keys fixed at 2 columns with 6px gap; recording and voice-over item headers stack and the primary key goes full width; transcript lines stack time over text; the player time drops to 12px. While recording, the top-strip status text collapses to a bold REC tag so the lamp and clock always fit.

## Elevation & Depth

Hybrid and low: surfaces sit flat on the putty with a single soft face shadow, and depth inside the console is expressed as hardware: keys stand on a 1 to 3px solid travel edge and press down 1 to 2px when active; windows (LCD, meter, player, bot view) are recessed with dark inset shadows; housings you put things into (inputs, the script well, the ON AIR lens, the tab tray) are recessed shallowly. There are no gradients.

### Shadow Vocabulary
These are every shadow the stylesheet uses; a new one is a new decision.
- **Face** (`box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(40,32,20,0.08), 0 8px 24px -12px rgba(40,32,20,0.18)`; dark: `0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.6)`): modules, the live console, the done panel, recording items, the script and voice modules, the Advanced panel, voice-over items.
- **Key travel** (`0 2px 0 rgba(0,0,0,0.25)` primary keys and the selected tab key; `0 1px 0 var(--seam)` quiet keys; `0 2px 0 var(--seam-2)` delegate keys, voice keys and the play key, halving to `0 1px 0` when pressed or chosen; `0 3px 0 var(--seam-2), 0 10px 24px -14px rgba(40,32,20,.5)` the Record key): the solid edge under a key.
- **LCD recess** (`inset 0 2px 6px rgba(0,0,0,.55), 0 1px 0 rgba(255,255,255,.6)`): shared by the LCD clock and the voice-over player window. The live sound meter runs deeper (`inset 0 2px 8px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.6)`), and the bot's view, which is framed by a 3px face-2 border and a seam-2 outline, uses `inset 0 2px 6px rgba(0,0,0,.5)` without the lower highlight.
- **Shallow recess** (`inset 0 1px 2px rgba(40,32,20,0.08)`): inputs, the script well, the ON AIR lens, and the tab tray.
- **LED inset** (`inset 0 1px 1px rgba(0,0,0,.12)`): an unlit LED. A lit speaker LED glows `0 1px 6px 0` of its colour at 60%; a lit voice LED has no glow.
- **Switch knob** (`0 1px 2px rgba(0,0,0,.25)`): the switch thumb only.
- **Focus halo** (`0 0 0 3px` of focus at 20%): focused text fields and the script well, with a focus-blue border.
- **Lamp breath** (`0 0 0 0 → 0 0 0 7px` of rec at 55%, 2s ease-in-out infinite): the recording lamp only.

### Named Rules
**The Travel Not Bevel Rule.** A key shows it can be pressed with a solid edge beneath it and a 1 to 2px press on `:active`; never with gradient highlights or glossy bevels.

**The Recessed Window Rule.** Anything you look *through* (clock, sound, the bot's view, the voice-over's playback) is a black inset window; anything you *press* stands proud of the face; anything you *put something into* (a field, the script, the tab tray) is a shallow recess.

## Shapes

Softly squared hardware. The outer faces (and warn-tinted cards) round at 14px; keys, inputs, the script well, wells, the tab tray and the many-setting cluster at 10px; small keys, tab keys, voice keys and rows, the lens, the bot view, the player window and selects at 8px; compact setting inputs at 7px; delegate keycaps, step badges and the reset key at 6px; LEDs and the stop glyph at 2px. Pills (999px) are reserved for status housings (the top-strip ON AIR pill and its time readout), speaker chips, the "N changed" and "clearest" tags, and the switch track. Circles are reserved for lamps, the Record key, the play key, the switch knob, speaker dots and the changed-setting dot. The stop key and the playing play key carry a square glyph (10px, 2px radius); local recordings mark their kind with a circle, meeting recordings with a 2px-rounded square. Disclosures use a ▸ triangle in ink-3 that rotates 90° when open (▾ on the recording Files key).

## Components

### Buttons (keys)
Charcoal keycaps that stand on a travel edge and press down.
- **Shape:** 10px radius; min-height 44px; 11px 18px padding; 600 weight, 14.5px.
- **Primary:** key fill, key-ink legend, 2px dark travel edge; hover goes to key-hover.
- **Quiet:** face-2 fill, seam-2 border, 1px seam edge; hover darkens the border to ink-3.
- **Small:** 34px tall, 6px 12px, 8px radius, 13.5px; for secondary actions inside list items, wells and panel headers (recording actions, transcript Copy, progress Cancel, result Open folder and downloads, Reset all).
- **Create voice-over:** the large primary key, 52px tall, 0 28px padding, 16px legend; full width on phones.
- **Active / Disabled:** `translateY(1px)` on press; disabled is 45% opacity with a not-allowed cursor. Transitions 0.15s (transform 0.08s).
- **Stop & save:** a primary key with a 10px currentColor square glyph before the legend and 20px inline padding.
- **Copy transcript, copied:** flashes to ok green with white legend.
- **Delete, armed:** a quiet small key that, on first press, turns charcoal (key fill, key-ink legend, key border) and reads "Delete for good?" for 4 seconds; a second press deletes. Never red.

### Record key
The round red-dot key: an 84px face-2 disc with a seam-2 border and 3px travel edge holding a 34px rec circle, legend "Record" beneath. Hover darkens the ring; active presses 2px.

### Play key
A round 38px key on the face colour with a seam-2 border and 2px seam-2 travel edge, holding a currentColor triangle; while playing the glyph becomes a 10px square, while loading a 14px seam-2 ring with an ink arc spinning (0.8s). Hover darkens the border; active presses 1px. Inside a voice row it shrinks to 32px with no travel edge.

### Inputs / Fields
- **Style:** face-2 fill, 1px seam-2 border, 10px radius, 11px 13px padding, 44px min-height, shallow inset recess. The Meet-link slot is larger: 17px text, 14px 16px padding, 52px tall. Selects match at 44px with 0 12px padding.
- **Script well:** the same recess at 280px minimum height (200px on phones), vertically resizable, 14px 16px padding, Script type in its own text direction.
- **Label:** 13px/600 ink-2 above the field, 6px gap.
- **Focus:** border turns focus blue plus a 3px 20%-focus halo. Elsewhere, a 2px focus outline with 2px offset.
- **Error:** rec-ink text below at 14px/500; empty error lines collapse.

### Errors
An error is one plain sentence in rec-ink that says what happened and what to try. When the engine's raw message differs from that sentence, a "Details" disclosure (13px summary, ink-2, 400) sits under it and opens a 12px mono block with the raw text, pre-wrapped. The raw message is never the headline.

### Switches
A native checkbox with `role="switch"`: a 40 by 24px pill track in seam-2 holding an 18px face-2 knob 3px in, with a small knob shadow. On, the track turns key and the knob slides 16px right (0.15s). Disabled shows a not-allowed cursor; a switch that gates other settings dims those rows to 45% and disables them.

### Navigation (tab tray)
Two keys in a recessed tray in the top strip. The tray is a 3px-padded ground-coloured housing with a seam border, 10px radius and the shallow recess; the keys inside are 34px tall, 0 16px, 8px radius, 14px/600. An unselected tab is a bare ink-2 legend that goes ink on hover; the selected tab (`aria-selected="true"`) is a charcoal key with a key-ink legend and the primary 2px travel edge. On phones the tray takes its own full-width row and the two keys split it evenly.

### Top strip and ON AIR pill
Sticky face strip with a seam underneath. The brand is a 12px charcoal dot ringed in seam plus "Meet Recorder" at 650. At right, a pill housing holds the lamp, the plain-language state, and a black LCD time pill (dim when idle, amber while recording).

### ON AIR lens and lamp
The lamp is a 10px circle (16 to 18px in the lens): seam-2 when off, lamp-wait while starting, joining, waiting, stopping or processing, red and breathing while recording, ok green when done, red on error. On the live deck it sits in a recessed 8px-radius lens above a 9.5px ON AIR legend that turns rec-ink while recording. The voice-over result uses a still 10px ok lamp beside "Ready".

### LCD
Black window, 10px radius, LCD recess; a REC legend and a 38px tabular clock in lcd-dim, both lighting to amber with a faint glow while recording.

### Sound meter window
A black recessed window holding a 104px canvas (160px for local recordings). Mirrored amber bars, one per 100ms, about 4px apart, rounded to half their width; 8 to 30 seconds visible depending on width; older bars fade from 100% to 35% toward the left edge; a lcd-dim centre line; a 2px playhead in playhead cream at the right edge; muted (#9a8f7c) 12px time marks ("-10 s", "now"). A status note above it reads ink-3, warn when people are talking but no sound arrives, ok when sound is coming through.

### Meter player
The console's meter window used for playback instead of the browser's grey audio bar: a play key, a recessed black window, and a time readout in a `auto 1fr auto` row with a 12px gap. The window is 8px radius, 6px 8px padding, with the LCD recess, holding a 40px canvas of mirrored bars 2px wide every 4px, drawn from the audio's loudness. Bars not yet played are lcd-dim; bars already played and a 2px full-height playhead are playhead cream. The canvas is a focusable slider (click or keys to seek). The readout is "0:00 / 1:24", 13px/600 tabular ink-2, right-aligned in a 9ch column. It appears in the result well and on every voice-over item.

### Delegate keys
One keycap per person in an auto-fill grid (min 148px, 8px gap; 2 columns on phones). Each has a 22 by 6px LED and a tabular channel number on top, the name (600, 14.5px, ellipsized) and talk time beneath. While the person speaks, the key takes their colour: border in `--c`, LED lit with a soft glow, a 7% colour wash, and the key sinks 1px onto a half-height edge. Off-screen people get a warn " · off screen" suffix.

### Voice keys
The delegate keycap turned into a preset picker: a radiogroup of three stacked keys (8px gap), each face-2 with a seam-2 border, 8px radius and a 2px seam-2 travel edge, padded 10px 60px 12px 14px to leave room for a play key pinned at the right. On top, a 22 by 6px LED and, on the recommended preset, an 11.5px ink-2 "Recommended" mark; beneath, the voice name (650, 16px) and a 13.5px ink-2 description. Hover darkens the border to ink-3. The chosen key's border turns key, it sinks 1px onto a half edge, and its LED lights solid key colour with no glow (bone in dark). When the user picks a voice outside the presets, a "custom" bar with a key-colour border replaces the selection.

### Voice rows
Under "More voices and languages", a scrolling list (max 340px, 6px gap) of rows: LED, name (600, 14.5px) with an optional ok-outlined "clearest" pill tag, an ink-3 female/male meta, and a 32px play key. Face-2, seam border, 8px radius; hover ink-3 border; chosen row has a key border and a lit LED.

### Advanced settings panel
A collapsed face whose summary reads "Advanced settings" (650, 15px) after a ▸ triangle, with an ink-3 note of how many values differ. Open, it shows an explanatory line and a small quiet "Reset all" key, then groups as `<details>` bands split by seams, each with a ▸ summary (600, 14.5px) and, when any of its values differ, a neutral "N changed" count chip (face-2, seam-2 border, 12px/600 ink-2 pill), never a status colour.
- **Rows:** a label (13.5px ink-2), the control (34px number field with a unit, 34px select, a 150px range with a tabular output, or a switch), and a 26px reset slot.
- **Clusters:** a switch and the settings it gates stay together in one face-2 cluster with a seam border and 10px radius; the switch's label is promoted to ink/600. Ungated settings stand alone.
- **Changed:** a changed row's label turns ink/600 and is led by a 6px ink dot; its ↺ reset key appears (26px, 6px radius, face-2, seam-2 border, ink-2 glyph, ink on hover) and its tooltip names the default.
- **Pronunciation:** two side-by-side editable lists with 12px ink-3 column heads and the same 34px inputs.

### Warn-tinted cards
For "one more step" states that are not errors: the first-run "Get the voices" card (14px radius, 20px 24px padding) with its heading, a sentence that says the size and that it happens once, and a primary Download key that gives way to a progress well; and the language-pack card under More voices (10px radius, 12px 14px, ink text, a fit-content key). Both fill with warn-soft and take a border of warn mixed 30% into seam. They never use red.

### Who-spoke-when lanes
A canvas below a seam: one 24px rounded track (track colour, 5px radius) per person with their colour dot and name at left (600 while speaking), coloured segments inset 3px, seam-coloured vertical time ticks and ink-3 tick labels.

### Chips
Speaker chips: 999px pill, face-2 fill, seam-2 border, 13px/500, with an 8px dot in the speaker's colour before the name. Count chips ("N changed") are the same pill without a dot, 12px/600 ink-2.

### Cards / Containers (faces)
- **Corner Style:** 14px.
- **Background:** face, on the ground.
- **Shadow Strategy:** Face shadow (see Elevation & Depth).
- **Border:** 1px seam.
- **Internal Padding:** 24px modules; 20px script and voice modules; 22px 24px done panel; 18px 20px recording items; 16px 20px voice-over items. Inside the live console, bands are separated by seams, not by gaps or nested cards.

### Voice-over items
A face per voice-over in a 12px-gap list: top row is the date (Key title) over ink-2 facts (length · voice · words) beside a meter player in a 220 to 340px column; then a two-line clamped preview of the script in 14px ink-2, in its own direction; then the recording actions row behind a seam: download small keys, Open folder, and Delete with its charcoal confirm. On phones the player drops under the title.

### Transcript
A face-2 well with a seam border and 10px radius. Header row: "Transcript" (650), ink-3 meta, a small Copy key. Each line is a 64px tabular timestamp column plus the speech: speaker name (650, 13.5px) led by an 8px dot in their colour, optional ink-3 "over <name>" for overlaps, then 14.5px/1.55 text in its own direction. Collapsed state caps at 236px and fades out with a mask; a full-width "Show the whole transcript" bar sits behind a top seam. Under 640px the timestamp stacks above the text.

### Progress wells
A face-2 well: a 20px/650 tabular percent, an ink-2 label and a small quiet Cancel key, over a 6px track whose charcoal fill scales from the left; while a model or voice loads, a 30% segment sweeps across. Shared by transcription, the voice download and voice-over creation. The voice-over result well is the same face-2 well holding the Ready lamp, the meter player and its actions.

## Do's and Don'ts

### Do:
- **Do** keep everything live on one console face: split deck, meter and booth with 1px seam lines, not separate cards.
- **Do** put time, sound, playback and the bot's view in black recessed windows; light the amber only while recording, and use cream over lcd-dim for playback.
- **Do** give keys a solid travel edge and a 1 to 2px press on `:active`.
- **Do** mark selection, on-state and armed confirms with the key colour (charcoal; bone in dark).
- **Do** set `tabular-nums` on every changing or aligned number.
- **Do** pair every speaker colour with the speaker's name, and assign colours from the 12-step palette in order of first appearance.
- **Do** keep each transcript line, script and voice-over preview in its own text direction (`unicode-bidi: plaintext`).
- **Do** keep touch targets at 44px for full-size keys and fields; small keys (34px) only for secondary actions inside list items, wells and panel headers.
- **Do** write errors as one plain sentence and tuck the raw message under a "Details" disclosure.
- **Do** keep a switch together with the settings it controls, and mark a changed setting with the ink dot and its own ↺ reset.
- **Do** honour `prefers-reduced-motion`: the lamp breath, progress sweep, play spinner, switch slide and key transitions all switch off.

### Don't:
- **Don't** build tiled dark stat panels; the console is light putty with black windows set into it.
- **Don't** use red for anything except recording and failure; a delete confirm is charcoal.
- **Don't** use amber digits or bars outside a black LCD window, and don't light a voice key or a player in amber.
- **Don't** give keys gradient bevels, gloss or highlights; travel edges and recesses carry the hardware.
- **Don't** use spaced uppercase legends for headings or tabs; they belong to hardware labels (REC, ON AIR, channel numbers).
- **Don't** colour the "N changed" count with a status colour; changed is not a warning.
- **Don't** load webfonts; the system UI face is the voice.

<!-- Direction: interpreter's booth console, chosen from concept-seed roll d3411ad8 (operate mode, assigned index 5). Voice-over tab added on the same world; recorded from the shipped ui/ on 2026-11-20. -->
