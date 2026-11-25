# To do

Planned work for ICAIRE Echo, in suggested order. Nothing here is built yet unless marked **Done**.
Research notes and sources are under each item (checked 22 Nov 2026).

**Priority: the Record button.** Items 1 and 2 are about pressing **Record** (no bot): hear
everyone through the computer's sound, then label who said what. Items 3–5 (the bot in meetings,
Teams, Discord) come later.

---

# Priority: the Record button

## 1. Record the computer's sound, not only the microphone — **Done** (12e72c3, 21 Nov)

"Record" now has **Also record the people in my call** (on by default). The browser shares the
computer's sound, and it is mixed with the microphone into the one `audio.wav`.

Still to check:
- [ ] Try it in a real call on Windows (Zoom app, Teams app, Meet in Chrome).
- [ ] Try it on a Mac. Chrome on Mac may only share a *tab's* sound, not the whole computer's,
      so a Zoom or Teams *app* call may not be captured there. Find out and say so in the panel.
- [ ] Keep the microphone and the call as two channels in the same `audio.wav` (left = me,
      right = the call) instead of mixing them. That gives "Me" vs "Others" for free and makes item 2
      much easier. It is still one file, so the one-audio-file rule holds.

## 2. Tell speakers apart in Record recordings — **Done** (22 Nov)

Built with sherpa-onnx in Node (`lib/diarize.js`): pyannote segmentation-3.0 plus the 3D-Speaker CAM++ voice
model, chosen with `test/bench-diarization.js` on four AMI meetings (first 10 minutes each, no collar, overlap
included): CAM++ 21.2 % DER, ERes2Net 23.1, TitaNet-small 24.8, WeSpeaker CAM++ 29.6, ResNet34 32.6.
Transcripts say Speaker 1, 2, ...; click a name to rename it everywhere. "How many people will talk?" next to
Record fixes the count when known. Still open: the two-channel split below, and voiceprints.

**Goal:** a "Record" transcript says *Speaker 1 / Speaker 2 / …*, and you rename each one
once (e.g. "Speaker 2 → Haider") and the name carries through the whole transcript.

**About Wispr Flow:** since August 2026 Wispr Flow has a **Notetaker** that does this. It shows
generic labels during the call, then names after it, and you name the ones it couldn't place. An
independent review found its labels weak ("three people came back as three labels, just not the
right three"). It runs in the cloud and calls speaker data biometric. Our bot already does better
in Google Meet, because its names come from Meet's own speaking light, not from guessing voices.
So this item is mainly for "Record" recordings and other apps, where there is no speaking light.

**Recommended way, all on the computer, no cloud:**
1. **Split "me" from "the call" by channel** (item 1, last checkbox). It's exact and free.
2. **Separate the voices in the call channel with a diarization model.** Options:
   - **pyannote `speaker-diarization-community-1`** (Python). The best-known open model in 2026,
     with no limit on the number of speakers. Its own published scores are about 17–20 % DER
     on the AMI and DIHARD meeting sets. Licence: CC-BY-4.0. The download needs a Hugging Face
     account and a one-time click to accept its terms, so a non-technical teammate can't do it alone;
     we would download it once and ship it with attribution. It also gives an *exclusive* (one
     speaker at a time) output, which lines up cleanly with Whisper's word times.
   - **sherpa-onnx diarization** (Node.js, ONNX: pyannote segmentation-3.0 plus a speaker-embedding
     model such as 3D-Speaker, WeSpeaker or NeMo TitaNet). No PyTorch, no token, small, and runs the
     same on Windows and Mac. **Probably the best fit for this app.** It is a bit less accurate
     than community-1.
   - **DiariZen**: the strongest open model in one independent benchmark (13.3 % DER), especially
     with many speakers. Less widely tested.
   - **NeMo Sortformer**: good, but **4 speakers at most**, and our meetings often have about 8. Skip it.
3. **Give each word to a speaker**, not each sentence. We already ask Whisper for word times
   (`word_timestamps=True`), and `merge.js` already splits by word for the bot.
4. **Re-use the speaker turns to cut clips for Whisper.** `lib/whisper.js` already cuts
   audio at speaker changes (from the Meet log) so each clip gets its own language. For "Record",
   the diarization turns can feed the same cutter, which also fixes short Arabic turns being
   translated into English.
5. **Optional voiceprints:** remember teammates' voices (stored locally, opt-in, with a delete
   button) so they are named automatically next time.

**How to choose:** we already own the perfect test set. Every bot recording has Meet's own log of who
spoke when. Run each model on those recordings and score it against the log (DER). Pick on our
own audio, not on published numbers.

- [ ] Benchmark sherpa-onnx vs pyannote community-1 (and DiariZen) on our bot recordings.
- [ ] Build it into "Record": Speaker 1/2/…, rename once, the name carries through.
- [ ] In bot recordings, use it only where Meet's log is unsure (two people lit at once).

# Later: meetings and the look

## 3. Join with my own browser, where I'm already in the meeting

**Goal:** instead of the bot opening its own browser, use the Meet tab I already have open.

**Research:**
- Since **Chrome 136**, Chrome refuses `--remote-debugging-port` on your normal profile, for
  security (it was used to steal cookies). It works only with a separate profile folder.
- The one supported way to control your *real* profile is the remote-debugging switch on
  `chrome://inspect`, which you turn on yourself. Playwright can then attach with `connectOverCDP`.
- **Hard part, the sound:** the bot records sound by tapping Meet's own audio *before* Meet starts.
  In a tab that's already in the call, that moment has passed. **Easiest combination:** the
  sound comes from "Record" (item 1), and attaching to the Meet tab is used **only to read who is
  speaking** (the names). That needs no new sound code.
- A browser extension would also work, but PRODUCT.md says "no browser extension". Decide first.

- [ ] Prototype: turn on the switch, attach, find the Meet tab, read the speaking lights.
- [ ] Panel: "Use my open Meet tab", which records with "Record" and gets names from the tab.
- [ ] Mac + Windows check.

## 4. Microsoft Teams support

**Research:**
- Teams has no official way for an outside bot to join *as a participant*; Microsoft's media-bot
  route needs Azure, Windows servers and .NET. The common approach is what we do for Meet:
  a browser that joins the **Teams web client** as a guest.
- Teams is rolling out **detection of outside meeting bots**, which shows them labelled in the lobby.
  Expect the organiser to have to admit it, and some companies block guests entirely.
- Teams' page changes between versions, so the selectors will need maintenance (as with Meet).
- Speaking lights: the Teams web client shows them like Meet; how to read them is not researched yet.

- [ ] Add `lib/teams.js` (join as guest with a name, waiting room, admitted, left, ended).
- [ ] Read Teams' speaking lights for names; turn on Teams captions as a backup.
- [ ] Mock Teams page for the tests (like `test/mock-meet.js`), plus one real test call.

## 5. Discord support

**Research:**
- A **Discord bot** (not a browser) can join a voice channel and receive **each person's sound
  separately, tagged with their user ID**, so names are exact and overlaps are no problem.
- Since **1 March 2026** Discord requires its end-to-end voice encryption (DAVE) on every
  voice call. Receiving audio under DAVE was **broken** in `@discordjs/voice` 0.19.0–0.19.1 and
  is reported working in 0.19.2. Discord doesn't officially support bots *receiving* audio,
  so it can break again.
- Needs a Discord application and bot token, and the server's admin must invite the bot.
  The bot must join **un-deafened**, or Discord sends it no sound.

- [ ] Check the latest `@discordjs/voice` release for DAVE receive before starting.
- [ ] Bot: join a channel, record per person, mix to one `audio.wav`, log who spoke when.
- [ ] Panel: "Discord" option (pick server and channel), setup guide for the bot token.
- [ ] Test in a real Discord server with 2–3 people.

## 6. Redesign the panel in the ICAIRE look

- **No ICAIRE design skill is installed for Claude here.** The skills named `hammam-icaire-*`
  in the `hammam` project are for the Hammam bot, not design. Either install one, or use the brand
  from the ICAIRE template: Midnight `#0F2A38`, Deep Forest `#1C5631`, Signal Lime `#8DC63F`
  (accent only), Executive Gold `#D8A23A` (one accent per screen), Ink `#16242D`, Calibri /
  Calibri Light. Source: `Documents\قوالب\presentations\brand.pptx`.
- [ ] Get the skill or confirm the brand file is the source.
- [ ] Redesign both tabs; keep the IDs that `test/ui.test.js` uses (listed in PRODUCT.md).
- [ ] Update DESIGN.md. This also settles the design-checker warnings about shadow colours.

## 7. General tips (already used, and still to try)

Already in `lib/whisper.js`: voice detection (Silero VAD), word times (DTW),
no text carried between windows (`-mc 0`, stops one language sticking), and short per-speaker clips so Arabic and English each get detected.

To try:
- [ ] **Names and terms list** (`hotwords` / `initial_prompt`): feed teammates' names and words
      like ICAIRE so Whisper spells them right. Not tested for Arabic/English mixing; measure first.
- [ ] **Tune voice detection** (`vad_parameters`: threshold, minimum silence) on our real recordings.
- [ ] **AI summary after the transcript:** notes, decisions and to-dos from the transcript. Open
      Whisper writes what was said word for word; the tidy notes should be a separate, local step.
- [ ] **Tell people they're being recorded.** Microsoft and others are labelling bots, and laws
      differ. A short message in the chat when the bot joins is a cheap fix.

---

### Sources
- Speaker separation: [pyannote community-1 model card](https://huggingface.co/pyannote/speaker-diarization-community-1) ·
  [Benchmarking diarization models (2025)](https://www.alphaxiv.org/abs/2509.26177) ·
  [NeMo vs pyannote vs VibeVoice (2026)](https://neosophie.com/en/blog/20260223-diarization) ·
  [Top diarization models 2026 (pyannote, vendor)](https://www.pyannote.ai/blog/top-7-speaker-diarization-apis-and-models-in-2026) ·
  [sherpa-onnx diarization models](https://csukuangfj.github.io/sherpa/onnx/speaker-diarization/models.html) ·
  [sherpa-onnx Node.js API](https://csukuangfj.github.io/sherpa/onnx/javascript-api/examples/api_speaker_diarization.html) ·
  [WhisperX](https://github.com/m-bain/whisperx)
- Wispr Flow Notetaker: [Wispr docs: live transcript](https://docs.wisprflow.ai/articles/4091106439-the-live-transcript-in-notetaker-beta) ·
  [9to5Mac](https://9to5mac.com/2026/08/05/wispr-flow-takes-on-ai-meeting-assistants-with-notetaker-its-first-product-beyond-dictation/) ·
  [tl;dv review](https://tldv.io/ko/blog/wispr-flow-notetaker-review/)
- Own browser: [Chrome: changes to remote debugging switches](https://developer.chrome.com/blog/remote-debugging-port) ·
  [report on chrome://inspect route](https://github.com/trycua/cua/issues/2916)
- Teams: [Recall.ai: Teams bot with a browser](https://www.recall.ai/blog/puppeteer-microsoft-teams-bot) ·
  [Teams outside-bot detection (Univ. of Oregon IT)](https://service.uoregon.edu/TDClient/2030/Portal/KB/PrintArticle?ID=141285) ·
  [Microsoft Q&A: bots in Teams meetings](https://learn.microsoft.com/en-us/answers/questions/1756248/i-want-to-put-bots-in-ms-teams-meeting-need-help)
- Discord: [discord.js #11419: DAVE receive bug](https://github.com/discordjs/discord.js/issues/11419) ·
  [Research: DAVE support in Node libraries](https://github.com/mia-cx/discord-mcp/issues/17) ·
  [Research: bots receiving voice](https://github.com/mia-cx/discord-mcp/issues/18) ·
  [Discord E2EE by default](https://thenextweb.com/news/discord-end-to-end-encrypted-voice-video-all-users)
- Whisper tips: [faster-whisper #843](https://github.com/SYSTRAN/faster-whisper/issues/843) ·
  [Whisper hallucinations during silence](https://www.popularai.org/p/whisper-hallucinations-during-silence)
