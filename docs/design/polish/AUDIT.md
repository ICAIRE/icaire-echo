# ICAIRE Echo interface audit

“Done” means the UI change is implemented. Layout findings come from the stylesheet and markup. The running-browser checks are listed under Verification.

## Record and previous recordings

- **Done** · Record · Centering the whole form moved the microphone when readiness or errors wrapped. The desktop form now has a viewport-based top anchor, with errors after the controls.
- **Done** · Record · The signed-out and missing-transcriber messages described a route through More. Each now opens the relevant action directly.
- **Done** · Record · A slow microphone permission check could put microphone advice back on the bot screen. Its result now applies only in local mode.
- **Done** · Record · The subtitle promised named transcripts regardless of the recording setup. It now describes the two ways to record.
- **Done** · Previous recordings · A failed fetch looked like an empty library. Loading, empty and failure have separate messages, with a retry action on failure.
- **Done** · Previous recordings · The first search fetched every transcript concurrently and later recordings were never indexed. Search now reads missing transcripts four at a time and includes new recordings on subsequent searches.
- **Done** · Previous recordings · Progress events detached every card, disturbing keyboard focus, and wrapped metadata could give cards different heights. Progress updates the affected card in place, rows share a height, and the open recording exposes its selection to assistive technology.

## Live recording

- **Done** · Live recording · Pausing or waiting for admission inserted an explanation above End and moved the control. The explanation now has reserved space, and the saving phase labels the disabled action “Saving…”.
- **Done** · Live recording · Meter and speaker-lane drawing ran at display refresh speed, even though sound samples arrive about ten times a second. Drawing now follows that cadence and skips hidden views and background documents.
- **Done** · Live recording · Unchanged participant and activity snapshots rebuilt lists and measured the activity scroll position. Those lists now update when their displayed contents change.
- **Done** · Live recording · Long participant names could draw into the activity lanes, and Arabic names inherited the English direction. Canvas labels have a width limit and participant names and meeting titles use automatic direction.

## Saved recording, transcript and people

- **Done** · Recording details · At 1000 × 700 and 900 × 640 the history list cut through the details card. Record, saved recordings and Voice-overs now share a full-height inspector on the left and an independently scrolling history on the right. Longer details, including People, can scroll through the full inspector.
- **Done** · Recording details · A delayed title save could rename the next recording. Each delayed write captures the recording and its text, writes in order, and updates the title without reopening the transcript.
- **Done** · People · Renaming a speaker could leave the transcript showing cached names. A successful rename reloads the affected transcript and updates its active speaker filter.
- **Done** · Transcript · Opening another recording exposed the previous text and copy buttons during loading. Loading now hides stale content and export actions, and a failed read offers a retry.
- **Done** · Transcript · Switching recordings during import or playback could refresh the wrong transcript or leave hidden video playing. Imports stay bound to their recording, and leaving clears the video.
- **Done** · Transcript · A long transcript created every row in one task, and playback scanned from its start on every time update. Rows now render in batches of 100, timeline segments are grouped once, and playback finds the current turn by binary search.
- **Done** · Transcript · At 900 × 640 the fourth speaker was cut off and the second copy action wrapped. The timeline fits four full rows and scrolls by keyboard or pointer for longer meetings. “Copy text only” and “Copy all” stay beside the heading, with the turn and speaker counts free to wrap under the title.
- **Done** · Transcript · Many speakers could push the transcript and player beyond a clipped pane. The timeline scrolls vertically, speaker filters scroll horizontally, and the recording pane permits overflow with a sticky player.
- **Done** · Transcript · The empty state did not explain a disabled Transcribe action. It now identifies missing audio, another active transcription, or the transcriber setup action.
- **Done** · Transcript · Keyboard users could not reach the hidden import input. It now has a focusable file input with a visible focus outline on its label, and transcript search has an accessible name.
- **Done** · Transcript · Previous could skip the last match on its first use, and smooth scrolling persisted even with reduced motion enabled. Match navigation now wraps correctly and scrolls only as far as needed.

## Voice-overs

- **Done** · Voice picker · At 900 × 640 the description ended before the accent was readable. Descriptions now wrap inside equal-height rows, so the full text is available while browsing the list.
- **Done** · Voice picker · Choosing a Standard voice replaced the focused row. Focus now follows the chosen voice, and custom voice names use isolated text direction.
- **Done** · Voice setup · A voice-service failure left the editor unavailable without a recovery action. The error now offers an inline retry.
- **Done** · Voice playback · Seeking could start extra animation loops, while samples and finished takes could play over one another or continue after leaving. The meter follows media events, and playback stops on switching source or leaving the page.
- **Done** · Voice controls · Sample, pause, reset and removal controls used a mix of CSS shapes and text glyphs. They now use the existing two-tone icons within the same editor and picker.
- **Done** · Voice progress · Repeated stream snapshots recreated setup controls, and loading was announced as zero percent. Unchanged snapshots are ignored, and progress distinguishes waiting from a measured percentage.

## More, sign-in, models, storage and updates

- **Done** · Sign-in · The menu said every meeting required sign-in, and long account addresses could exceed its bounds. The guidance now describes meetings that require an account, and the menu wraps its labels.
- **Done** · Models and storage · A failed check looked like a missing transcriber or blank storage section. Both failures now have inline recovery, and a model download failure clears the stale downloading status.
- **Done** · Updates · Changing release text moved the action, and the update badge widened More. The action precedes the wrapping status, and the badge is positioned within the existing menu trigger.

## Shared frame and keyboard

- **Done** · Navigation · Skip to content changed the route. It now focuses the current main pane, and the Record and Voice-overs labels remain available at intermediate widths.
- **Done** · Keyboard · Space could start playback instead of activating the focused control, and the recording shortcut could fire inside a dialog. Focused controls and dialogs now retain their keyboard behavior.
- **Done** · Menus and tabs · More and Download lacked Escape dismissal, and recording tabs and modes lacked arrow navigation. Escape returns focus to the trigger, and the groups support arrow keys, Home and End.
- **Done** · Frame · At tablet widths the inspector's content height moved the recordings rail when switching modes or tabs. All three pages now use the same column widths at 900px and above, with a shared single-column order below 900px.
- **Done** · Status feedback · Toasts used a pale panel, and model and transcript progress bars lacked accessible values. Toasts use the dark surface and lime border, and determinate bars expose their percentage.

## Verification

- **Done** · Narrow-window follow-up · Reviewed all four supplied browser screenshots. Parsed the revised stylesheet and checked the active DOM/CSS rules at 900 × 640, 1000 × 700, 1440 × 900 and 800 × 640. The three routes resolved to the same grid tracks and pane positions at each size. Checked timeline scrolling and keyboard focusability, the nonwrapping toolbar, and voice row sizing and wrapping. The DOM state fixtures passed, including the 32-speaker recording.
- **Skipped** · Follow-up browser measurement · Chromium could not start because the sandbox denied macOS Mach port registration. The screenshots show the original defects. Post-fix pixel positions and pointer scrolling could not be measured here. The UI suite was rerun and the sandbox again denied port 4799.

- **Done** · DOM fixtures · Exercised Record in both modes, sign-in, all three live tabs, bot admission through saving, recording errors and cancellation, and local recording, pause and saving.
- **Done** · DOM fixtures · Exercised recording details, People, video visibility, empty and failed transcripts, retry, transcription phases, and switching recordings before title autosave. The long fixture used 600 Arabic turns and 32 long speaker names, with search and speaker filtering.
- **Done** · DOM fixtures · Exercised Standard and Expressive, setup and download states, voice search with no matches, Arabic direction, tag picker, custom voice dialog, creation progress, errors, and a completed take with download controls.
- **Done** · DOM fixtures · Exercised storage failure and recovery, model download states, all seven update statuses, the disconnected banner, tab navigation, menu dismissal, skip navigation and dialog shortcut isolation.
- **Skipped** · Visual review at 1440 × 900, 1000 × 700 and 900 × 640 · The sandbox denied the demo server port 4778. Chromium and WebKit also failed to launch independently. Exact positioning, contrast, clipping, card dimensions and layout shift at those sizes remain unverified.
- **Skipped** · End-to-end actions · The required UI test command ran, but its server could not bind 127.0.0.1:4799 (EPERM). Real capture, Google sign-in, media playback, downloads and restart were not exercised by the DOM fixtures.
