# Design

ICAIRE Echo is an ICAIRE studio tool: ICAIRE's colours (Midnight, Lime, Gold) on one dark, flat room. It shares
the three-column frame of ICAIRE's studio apps, with a look of its own so it is never mistaken for ICAIRE
Voice: solid surfaces instead of a glowing backdrop, a round record button inside "echo" rings, lime edges
to mark what is open.

## The frame

| Column | What it holds |
|---|---|
| Top bar | The Echo mark and name, the two sections (Record, Voice-overs), the live recording pill, More |
| Left | Details for what is in the middle: recording setup, an open recording's details and people, or the voice and its settings |
| Middle | The work: start a recording, the live recording, one recording with its transcript and player, the voice-over script, models and storage |
| Right | The list: previous recordings with their waveforms (coloured by speaker), or the voice-overs made |
| Status bar | Whether the transcriber is ready, and that everything is saved on this computer |

The page fits the screen (100vh); each column scrolls on its own. Tablets put the details and the list in
one left column; phones stack everything.

## Rules

| | |
|---|---|
| Surfaces | Solid steps of Midnight: room `--room`, bars `--bar`, side columns `--side`, cards `--card`. No white pages, no see-through panels |
| Depth | None. No shadows, no 3D, no blur, no glow, nothing tilted. Borders (`--edge`) and tints only |
| Selected | A lime edge (`border-inline-start`) or a lime outline, never a glow |
| Record button | A dark circle with a lime ring and microphone, in thin rings that ripple outward (off with reduced motion) |
| Live | The live button is the same circle; red rings ripple while it records, gold when paused |
| Primary button | Lime with Midnight text, one per view |
| Danger | Red, only for End and Delete |
| Speaker colours | One palette (`WAVE` in `ui/app.js`), the same order in the list, the timeline and the transcript |
| Cards | Cards of one kind are one size |
| Icons | Lucide (ISC), two-tone: the accent part in lime (`ui/icons.js`) |
| Type | The system font; tabular figures for every time and number |
| Direction | Logical properties where it matters, so the page can mirror |

## Inspiration, not a copy

The frame follows ICAIRE Voice (the studio layout: details, work, list). The look is Echo's own.
