# Design

Meet Recorder looks like an ICAIRE tool: ICAIRE's colours, type and flat surfaces, composed as a quiet
working page, not as a page of icaire.org. Every colour comes from `ui/tokens.css` (ICAIRE's design
tokens, copied as they are); `ui/style.css` names no hex value.

## The idea

A calm desk with one obvious thing to do. White page, soft Raised panels, hairline borders, no
shadows, generous space, large light headings. One big action per view: the round **Record** key on
the start screen, **Create voice-over** on the Voice-over tab, **Copy transcript** once a transcript
exists.

The one heavy moment is the live recording: a Midnight panel with the clock, **Stop & save** in Lime,
and the sound running in Lime. Nothing else on the page is dark.

## Rules

| | |
|---|---|
| Surfaces | Canvas (`--surface-page`) and Raised (`--surface-raised`); Midnight only for the live panel |
| Borders | `--border-subtle` hairlines; `--border-strong` on hover and for inputs |
| Shadows | none. Focus rings are the only glow |
| Radius | `--radius-lg` panels and cards, `--radius-md` buttons and inputs, `--radius-pill` tabs and chips |
| Primary button | Deep Forest with white text, one per view; on Midnight, Lime with Midnight text |
| Quiet button | transparent with a `--border-strong` outline; Forest on hover |
| Lime | graphic only: dots, the sound, "Recommended", changed-setting marks. Never text on white |
| Gold | the "busy" lamp (joining, processing) and warnings on Midnight |
| Red (`--state-danger`) | the Record dot, the recording lamp, errors |
| Speaker colours | a categorical palette in `ui/app.js` (data, not brand), the same for a person everywhere |
| Type | ICAIRE's stack (Calibri, Carlito, then the system font); headings 300 weight at display size; tabular figures for every time and number |
| Direction | logical properties (`margin-inline-start`, `border-block-end`) so the page can mirror |
| Dark | follows the computer's setting through ICAIRE's dark tokens (`html[data-theme="dark"]`) |

## Identity

The UNESCO | ICAIRE lockup, small (2.5rem high), at the start of the top strip, next to the product
name. The white lockup in dark mode. Nowhere else.

## Inspiration, not a copy

The calm, the space and the single obvious action are in the spirit of voice tools like Wispr Flow.
Its layout, its floating bar, its colours and its type are not used.
