# Brief: record the screen too (video), On this computer

For: Astra. The owner asked for "an option to record the meeting video, not just audio". Edit `ui/` only (no server,
lib, desktop or test files, no commits). The engine is built and tested; wire to it exactly as below.

## What exists

- **Bot joins a Meet** already records the meeting's video (`video.mp4`); a recording with a `video.mp4` shows
  **Watch with names** (`#recWatch`, `showVideo()` in `ui/app.js`): the video with who is speaking as captions.
- **On this computer** in the desktop app (`NATIVE`, `startNative()` in `ui/app.js`) records sound only. It now can
  record the main screen as well.

## The engine (desktop app only)

- `POST /api/local/start` now also returns `ffmpeg` (a path).
- `NATIVE.invoke('record_start', { dir, system, video: true, ffmpeg })` records the screen too.
  - Without `video` (or `false`), nothing changes.
  - It answers `{ device, system, system_error, video: bool, video_error }`.
  - `video_error` is set when the screen could not start: no permission, for example. The sound still records; tell the person in one line, as `system_error` is today.
- Pause, resume and stop work as today: the screen pauses with the sound and stays in step.
- When the recording finishes, the recording folder has `video.mp4`: the screen at up to 1920 px wide, 15 frames a second, with the sound. `meta.json` has `video: true`.
  - About 0.7 GB an hour on a Mac.
  - On a Mac it needs the same permission as the call's sound (Screen & System Audio Recording).
- In the browser (not the desktop app) there is no screen video: hide the option there.

## What to build

1. In **Recording details** for **On this computer**, a switch **Screen video**, off by default, under Call sound.
   - Same style as Call sound.
   - One short help line: "Also records your screen, with the sound. About 0.7 GB an hour."
   - Remember it like the other choices.
   - Only in the desktop app.
2. While recording with video on, show that the screen is being recorded in the status row under the button, like "Call sound: on".
3. On a recording that has `video.mp4`, the existing **Watch with names** works for these too: check it reads well for a screen recording (on a recording from On this computer the button can say **Watch** if names are not shown), and that the video fits the layout at 1440, 1000 and 900 px wide.
4. The owner's rules as always:
   - no layout shift when the switch changes, and no shadows
   - fewest clicks
   - plain words
   - no em dashes
   - checked at 1440x900, 1000x700 and 900x640
