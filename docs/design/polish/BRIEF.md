# Brief: optimise the whole app's interface

For: Astra (gpt-6.2-astra). The owner asked: "optimize the whole app". You own the interface (`ui/`), everything a
person sees and does. Backend work (server, engines, speed) is done separately: do not edit `server.js`, `lib/`,
`voice/`, `desktop/` or `test/`. If the interface needs something from the server, write it under Requests below.

## The app

ICAIRE Echo records meetings (a bot joins Google Meet, or "On this computer"), writes transcripts with speakers'
names, and makes voice-overs (Standard and Expressive). Non-technical ICAIRE staff use it. Pages: Record (home),
the live recording, a recording's transcript and people, Voice-overs (just rebuilt from your direction A: keep its
design), More / Models and storage / settings, sign-in, updates. Run it with `node test/ui-demo-server.js`
(a demo with a fake 8-person meeting; port in the file) or `npm start`.

## The owner's standing rules (non-negotiable)

- Never confusing. Fewest clicks. Plain words, no jargon.
- No layout shift: switching modes, tabs or states never moves or resizes things that stay.
- Cards of one kind are one size. Pages fit the window without scrolling except long pages and long lists.
- Clean responsiveness from 900 px wide up (and usable narrower); every element takes the space it needs.
- Look: DESIGN.md. Dark only (no white screens), flat cards, borders and tints for depth.
  - **No shadows, no glow, no 3D, no rotation, no depth gradients.**
  - Lime for the primary action and the selection.
  - Lucide two-tone icons (`ui/icons.js`).
  - Keep the dark record button with its lime ring and ripple rings: the owner chose it.
- No em dashes in visible text. Arabic text right to left.

## What to do

1. Go through every page and state in the running app at 1440x900, 1000x700 and 900x640:
   - empty, loading, running, error and done states
   - long names, long transcripts, many people, Arabic text
2. Write `docs/design/polish/AUDIT.md`: each problem in one line (page, what is wrong, why it matters), grouped by page, most harmful first.
3. Fix them in `ui/`. Things to look for:
   - confusing wording, too many controls, extra clicks
   - inconsistent spacing, type, sizes or icons
   - layout shift, clipped or overlapping text, unaligned edges, cards of one kind with different sizes
   - missing focus states, missing labels for icons, keyboard traps, contrast
   - slow or janky rendering: work done on every event-stream update, large lists rendered at once, layout thrash
4. Mark each AUDIT.md line done or skipped (with why).
5. Run `node --test test/ui.test.js` (if the sandbox refuses the port, say so). Do not commit.

## Requests

(Anything you need from the server goes here.)
