// Live end-to-end test in a REAL Google Meet, with nobody human in it.
//
//   1. Copies the bot's signed-in profile for a few hidden "speaker" Chromes.
//   2. Speaker 1 starts a new meeting (meet.google.com/new); the others join it as more devices on the
//      same account, so nobody has to admit anyone.
//   3. The recorder (the control panel, which must be running: npm start) joins and records.
//   4. The speakers play a scripted conversation (English + Arabic, interruptions, cross-talk) into their
//      microphones. Each one logs exactly when it played what: the ground truth.
//   5. Stops the recorder, transcribes with Whisper through the panel, and scores:
//      audio level, the who-spoke-when timeline, and the transcript (words + speaker labels).
//
//   node test/live-meeting.js [--panel http://localhost:4777] [--speakers 4] [--keep]
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { chromium } = require('playwright-core');
const ffmpeg = require('ffmpeg-static');
const { CHROME, PROFILE, regularUserAgent } = require('../lib/session');
const { clickJoin } = require('../lib/meet');

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const PANEL = opt('--panel', 'http://localhost:4777');
const OUT = path.join(__dirname, 'out', 'live-meeting');
const N = Number(opt('--speakers', 4));

const SPEAKERS = [
  { key: 'George', voice: 'George' },
  { key: 'Susan', voice: 'Susan' },
  { key: 'Zira', voice: 'Zira' },
  { key: 'Naayf', voice: 'Naayf' },
].slice(0, N);

// gap = seconds after the previous line ENDS (negative: starts before it ends, i.e. interrupts / overlaps).
const SCRIPT = [
  { who: 'George', gap: 0, text: 'Good afternoon, this is George. Let us review the shipping schedule for the northern warehouse.' },
  { who: 'Susan', gap: -1.6, text: 'Sorry George, the trucks from Leeds are delayed by two days.' },
  { who: 'Zira', gap: 0.8, text: 'I can call the supplier in Chicago this evening and ask for a new delivery date.' },
  { who: 'Naayf', gap: 1.0, text: 'مرحبا بالجميع، أنا نايف. سأرسل تقرير المبيعات غدا صباحا.' },
  { who: 'George', gap: 0.9, text: 'Thank you. Susan, can you confirm the cost of the extra storage?' },
  { who: 'Susan', gap: -0.4, text: 'Yes, it is around four thousand pounds per month.' },
  { who: 'Zira', gap: 0.3, text: 'That sounds expensive.' },
  { who: 'Naayf', gap: 1.2, text: 'أعتقد أننا نحتاج إلى اجتماع آخر يوم الخميس.' },
  { who: 'George', gap: 1.0, text: 'Fine, we will meet again on Thursday. Until then, please send me your notes about the warehouse, the trucks and the storage contract.' },
  { who: 'Zira', gap: -4.5, text: 'Wait, Thursday does not work for me.' },
  { who: 'Susan', gap: 1.0, text: 'Then let us choose Friday morning at ten o clock.' },
  { who: 'Naayf', gap: 1.0, text: 'يوم الجمعة مناسب لي. شكرا جزيلا.' },
  { who: 'George', gap: 1.2, text: 'Great, Friday it is, thank you everyone.' },
  { who: 'Zira', gap: -1.8, text: 'Perfect, see you all on Friday.' },
].filter((l) => SPEAKERS.some((s) => s.key === l.who));

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const r = await fetch(PANEL + p, { method, headers: { 'x-mrb': '1', 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${j.error || ''}`);
  return j;
}

function probeSec(file) {
  const e = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(e);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

// ---------- 1. speech clips ----------
function makeClips() {
  const dir = path.join(OUT, 'clips');
  fs.mkdirSync(dir, { recursive: true });
  const jobs = SCRIPT.map((l, i) => ({ voice: SPEAKERS.find((s) => s.key === l.who).voice, text: l.text, file: path.join(dir, `raw${i}.wav`) }));
  const jobFile = path.join(dir, 'jobs.json');
  fs.writeFileSync(jobFile, JSON.stringify(jobs), 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'tts.ps1'), '-jobs', jobFile], { stdio: 'inherit' });
  const edge = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  return SCRIPT.map((l, i) => {
    const file = path.join(dir, `line${i}.wav`);
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', jobs[i].file, '-af', `${edge},areverse,${edge},areverse`, '-ac', '1', '-ar', '48000', file]);
    return { ...l, i, file, sec: probeSec(file) };
  });
}

// ---------- 2. speaker browsers ----------
function copyProfile(i) {
  const dst = path.join(OUT, 'profiles', 'speaker' + i);
  fs.rmSync(dst, { recursive: true, force: true });
  const skip = /(^|[\\/])(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|GraphiteDawnCache|DawnCache|Service Worker[\\/]CacheStorage|component_crx_cache|optimization_guide_model_store|OnDeviceHeadSuggestModel|Crashpad|BrowserMetrics.*|Singleton\w*|lockfile)$/i;
  fs.cpSync(PROFILE, dst, { recursive: true, filter: (src) => !skip.test(path.relative(PROFILE, src)) });
  return dst;
}

// Runs in each speaker page: the microphone Meet gets is a WebAudio stream we play clips into.
const MIC = () => {
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let ctx, dest;
  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 48000 });
      dest = ctx.createMediaStreamDestination();
    }
    if (ctx.state !== 'running') ctx.resume();
  };
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await orig(c);
    if (c && c.audio) {
      ensure();
      for (const t of s.getAudioTracks()) {
        s.removeTrack(t);
        t.stop();
      }
      s.addTrack(dest.stream.getAudioTracks()[0].clone());
    }
    return s;
  };
  const clips = {};
  window.__load = async (id, b64) => {
    ensure();
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    clips[id] = await ctx.decodeAudioData(bytes.buffer);
    return clips[id].duration;
  };
  window.__play = (id) => {
    ensure();
    const src = ctx.createBufferSource();
    src.buffer = clips[id];
    src.connect(dest);
    const lead = 0.05;
    src.start(ctx.currentTime + lead);
    return { t: Date.now() + lead * 1000, dur: clips[id].duration };
  };
};

const SELF_PID = () => {
  const SELF_ONLY = /^(backgrounds and effects|reframe|apply visual effects)$|others might still see your full video/i;
  for (const tile of document.querySelectorAll('[data-participant-id]')) {
    for (const e of tile.querySelectorAll('[role="tooltip"], [aria-label], span')) {
      const s = (e.getAttribute('aria-label') || e.textContent || '').trim();
      if (s.length < 60 && SELF_ONLY.test(s)) return tile.getAttribute('data-participant-id');
    }
  }
  return null;
};

async function openSpeaker(i, profile) {
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--mute-audio',
      '--lang=en-US',
      '--no-first-run',
      '--user-agent=' + regularUserAgent(),
    ],
  });
  await ctx.addInitScript(MIC);
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { i, ctx, page };
}

async function joinCall(sp, url) {
  const { page } = sp;
  const say = (m) => log(`speaker ${sp.i + 1}: ${m}`);
  page.goto(url, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
  let clicked = false;
  for (let n = 0; n < 120; n++) {
    await sleep(1000);
    if (page.url().includes('accounts.google.com')) throw new Error(`speaker ${sp.i + 1}: the copied profile is not signed in`);
    const body = await page.locator('body').innerText().catch(() => '');
    if (/you can.t join this (video )?call/i.test(body)) throw new Error(`speaker ${sp.i + 1}: Meet refused (${url})`);
    if (await page.locator('[aria-label*="Leave call" i]').count()) {
      if (!/please wait until a meeting host|asking to be let in/i.test(body)) {
        say('in the call');
        break;
      }
    }
    const cam = page.locator('[role="button"][aria-label*="Turn off camera" i], button[aria-label*="Turn off camera" i]');
    if (await cam.first().isVisible().catch(() => false)) await cam.first().click().catch(() => {});
    await page.getByRole('button', { name: /^(got it|dismiss|close)$/i }).first().click({ timeout: 300 }).catch(() => {});
    if (!clicked && (await clickJoin(page))) {
      clicked = true;
      say('clicked join');
    }
    if (n === 40) await page.screenshot({ path: path.join(OUT, `speaker${sp.i + 1}-stuck.png`) }).catch(() => {});
    if (n === 119) throw new Error(`speaker ${sp.i + 1}: never got into the call`);
  }
  await page.mouse.move(1, 1).catch(() => {});
  // Make sure the microphone is on.
  for (let n = 0; n < 5; n++) {
    const on = page.locator('[aria-label*="Turn on microphone" i]');
    if (!(await on.first().isVisible().catch(() => false))) break;
    await on.first().click().catch(() => {});
    await sleep(800);
  }
  const micOff = await page.locator('[aria-label*="Turn on microphone" i]').first().isVisible().catch(() => false);
  if (micOff) say('WARNING: microphone still off');
}

// ---------- 5. scoring ----------
const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // combining marks: Arabic diacritics, and the hamza NFKD splits off أ/إ/آ
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

function score(recDir, truth, pidOf) {
  const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8'));
  const t0 = Date.parse(meta.startedAt);
  const dur = meta.durationSec;
  const { segments } = JSON.parse(fs.readFileSync(path.join(recDir, 'speakers.json'), 'utf8'));
  const lines = truth.map((l) => ({ ...l, start: (l.t - t0) / 1000, end: (l.t - t0) / 1000 + l.dur }));
  const report = [];
  const out = (s = '') => (report.push(s), console.log(s));

  // audio
  const vd = spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(recDir, 'audio.wav'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const mean = Number(/mean_volume: (-?[\d.]+)/.exec(vd)?.[1]);
  const max = Number(/max_volume: (-?[\d.]+)/.exec(vd)?.[1]);
  out(`# Live meeting test, ${meta.startedAt}`);
  out();
  out(`Recording ${dur.toFixed(1)} s. audio.wav mean ${mean} dB, peak ${max} dB: ${max > -30 ? 'speech is there' : 'SILENT or nearly silent'}.`);

  // timeline: per speaker frames at 0.1 s with the best indicator lag (0..1.5 s)
  out();
  out('## Who spoke when (Meet speaking indicator vs what each speaker actually played)');
  out();
  out('| speaker | label in recording | lines caught | time agreement | recall | precision | lag |');
  out('|---|---|---|---|---|---|---|');
  const STEP = 0.1;
  const frames = Math.ceil(dur / STEP);
  const mask = (ivs, shift = 0) => {
    const m = new Uint8Array(frames);
    for (const [a, b] of ivs) for (let i = Math.max(0, Math.floor((a + shift) / STEP)); i < Math.min(frames, Math.ceil((b + shift) / STEP)); i++) m[i] = 1;
    return m;
  };
  const labelOf = {};
  for (const sp of SPEAKERS) {
    const pid = pidOf[sp.key];
    const mine = lines.filter((l) => l.who === sp.key).map((l) => [l.start, l.end]);
    const det = segments.filter((s) => s.pid === pid).map((s) => [s.start, s.end]);
    labelOf[sp.key] = segments.find((s) => s.pid === pid)?.speaker || '(never detected)';
    const tm = mask(mine);
    let best = { lag: 0, acc: -1 };
    for (let lag = 0; lag <= 1.5; lag += 0.1) {
      const dm = mask(det, -lag);
      let a = 0;
      for (let i = 0; i < frames; i++) a += tm[i] === dm[i];
      if (a / frames > best.acc) best = { lag, acc: a / frames };
    }
    const dm = mask(det, -best.lag);
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < frames; i++) {
      if (tm[i] && dm[i]) tp++;
      else if (dm[i]) fp++;
      else if (tm[i]) fn++;
    }
    const hits = mine.filter(([a, b]) => det.some(([c, d]) => c - best.lag < b && d - best.lag > a)).length;
    out(`| ${sp.key} | ${labelOf[sp.key]} | ${hits}/${mine.length} | ${(best.acc * 100).toFixed(0)}% | ${((tp / (tp + fn || 1)) * 100).toFixed(0)}% | ${((tp / (tp + fp || 1)) * 100).toFixed(0)}% | ${best.lag.toFixed(1)} s |`);
  }
  const stray = segments.filter((s) => !Object.values(pidOf).includes(s.pid));
  if (stray.length) out(`\n${stray.length} segment(s) belong to tiles that are not one of the speakers: ${[...new Set(stray.map((s) => s.speaker))].join(', ')}`);

  // transcript
  const wj = path.join(recDir, 'whisper.json');
  const tj = path.join(recDir, 'transcript.json');
  if (!fs.existsSync(wj) || !fs.existsSync(tj)) {
    out('\nNo transcript to score.');
    return report.join('\n');
  }
  const words = JSON.parse(fs.readFileSync(wj, 'utf8')).segments.flatMap((s) => (s.words || []).map((w) => ({ ...w, mid: (w.start + w.end) / 2 })));
  const { turns } = JSON.parse(fs.readFileSync(tj, 'utf8'));
  out();
  out('## Transcript (Whisper large-v3 + speaker labels)');
  out();
  out('| # | speaker | words recognised | labelled as | right speaker? | heard |');
  out('|---|---|---|---|---|---|');
  let wordsOk = 0, wordsAll = 0, labelOk = 0;
  for (const l of lines) {
    const want = norm(l.text);
    const heard = words.filter((w) => w.mid >= l.start - 0.3 && w.mid <= l.end + 1.2);
    const got = norm(heard.map((w) => w.word).join(' '));
    const pool = [...got];
    let found = 0;
    for (const w of want) {
      const k = pool.indexOf(w);
      if (k >= 0) found++, pool.splice(k, 1);
    }
    wordsOk += found;
    wordsAll += want.length;
    // speaker label: the turn(s) that hold this line's words, weighted by overlap
    const w8 = {};
    for (const t of turns) {
      const o = Math.min(t.end, l.end + 0.8) - Math.max(t.start, l.start);
      if (o > 0) {
        const tw = norm(t.text).filter((x) => want.includes(x)).length;
        if (tw) w8[t.speaker] = (w8[t.speaker] || 0) + tw;
      }
    }
    const lab = Object.entries(w8).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    const ok = lab === labelOf[l.who];
    labelOk += ok;
    out(`| ${l.i + 1} | ${l.who} | ${found}/${want.length} | ${lab} | ${ok ? 'yes' : 'NO'} | ${heard.map((w) => w.word).join('').trim().slice(0, 90)} |`);
  }
  out();
  out(`Words recognised: ${wordsOk}/${wordsAll} (${((wordsOk / wordsAll) * 100).toFixed(0)}%). Lines under the right speaker: ${labelOk}/${lines.length}.`);
  out();
  out('Speaker labels in the recording: ' + SPEAKERS.map((s) => `${s.key} = "${labelOf[s.key]}"`).join(', '));
  return report.join('\n');
}

// Re-run the timeline + transcript labels on a finished recording and score it again (after code changes).
//   node test/live-meeting.js --rescore recordings/<id>
function rescore(recDir) {
  const { writeTimeline } = require('../lib/finalize');
  const { writeTranscript } = require('../merge');
  const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8'));
  writeTimeline(recDir, { durationMs: meta.durationSec * 1000, names: meta.participants, ignorePids: new Set(meta.botParticipantIds) });
  if (fs.existsSync(path.join(recDir, 'whisper.json'))) writeTranscript(recDir, path.join(recDir, 'whisper.json'));
  const { truth, pidOf } = JSON.parse(fs.readFileSync(path.join(OUT, 'truth.json'), 'utf8'));
  fs.writeFileSync(path.join(OUT, 'report.md'), score(recDir, truth, pidOf) + '\n\nRecording: ' + recDir + '\n');
}

// ---------- main ----------
if (require.main === module && args.includes('--rescore')) rescore(path.resolve(opt('--rescore')));
else if (require.main === module) (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const st = await api('GET', '/api/state').catch(() => null);
  if (!st) throw new Error('The control panel is not running at ' + PANEL + ' (npm start).');
  if (st.current && st.current.active) throw new Error('The recorder is already busy.');

  log('Making speech clips...');
  const clips = makeClips();
  log(`${clips.length} lines, ${clips.reduce((a, c) => a + c.sec, 0).toFixed(0)} s of speech`);

  log('Starting speakers...');
  const speakers = [];
  for (let i = 0; i < SPEAKERS.length; i++) speakers.push(await openSpeaker(i, copyProfile(i)));
  let cleanup = async () => {
    for (const sp of speakers) {
      await sp.page.locator('[aria-label*="Leave call" i]').first().click({ timeout: 2000 }).catch(() => {});
      await sp.ctx.close().catch(() => {});
    }
  };
  process.on('SIGINT', async () => (await cleanup(), process.exit(130)));

  try {
    // speaker 1 creates the meeting
    const host = speakers[0];
    host.page.goto('https://meet.google.com/new', { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
    let url = null;
    for (let n = 0; n < 60 && !url; n++) {
      await sleep(1000);
      const m = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/.exec(host.page.url());
      if (m) url = 'https://meet.google.com/' + m[1];
      if (host.page.url().includes('accounts.google.com')) throw new Error('The copied profile is not signed in.');
    }
    if (!url) throw new Error('Could not start a new meeting (page: ' + host.page.url() + ')');
    log('New meeting: ' + url);
    fs.writeFileSync(path.join(OUT, 'meeting.txt'), url);
    await joinCall(host, url);
    for (const sp of speakers.slice(1)) await joinCall(sp, url);

    // load clips into each speaker
    for (const c of clips) {
      const sp = speakers[SPEAKERS.findIndex((s) => s.key === c.who)];
      await sp.page.evaluate(([id, b64]) => window.__load(id, b64), [String(c.i), fs.readFileSync(c.file).toString('base64')]);
    }

    log('Sending the recorder...');
    const run = await api('POST', '/api/join', { url, name: 'Recorder' });
    for (let n = 0; ; n++) {
      await sleep(1000);
      const c = (await api('GET', '/api/state')).current;
      if (c.status === 'recording') break;
      if (!c.active) throw new Error('Recorder ended: ' + (c.error || c.status));
      if (n === 180) throw new Error('Recorder never started recording (' + c.status + ')');
    }
    log('Recorder is recording (' + run.id + ')');

    const pidOf = {};
    for (let i = 0; i < speakers.length; i++) pidOf[SPEAKERS[i].key] = await speakers[i].page.evaluate(SELF_PID);
    log('Speaker tiles: ' + JSON.stringify(pidOf));
    await sleep(5000);

    // play the conversation
    log('Playing the conversation...');
    const truth = [];
    let prevEnd = Date.now();
    for (const c of clips) {
      const at = prevEnd + c.gap * 1000;
      await sleep(Math.max(0, at - Date.now()));
      const sp = speakers[SPEAKERS.findIndex((s) => s.key === c.who)];
      const r = await sp.page.evaluate((id) => window.__play(id), String(c.i));
      truth.push({ i: c.i, who: c.who, text: c.text, t: r.t, dur: r.dur });
      log(`  ${c.who}: ${c.text.slice(0, 50)}`);
      prevEnd = Math.max(prevEnd, r.t + r.dur * 1000); // gaps count from whoever finishes last
    }
    await sleep(Math.max(0, prevEnd - Date.now()) + 4000);
    fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify({ pidOf, truth }, null, 2));

    log('Stopping the recorder...');
    await api('POST', '/api/stop');
    let rec;
    for (let n = 0; n < 300; n++) {
      await sleep(1000);
      rec = (await api('GET', '/api/state')).current;
      if (!rec.active) break;
    }
    log('Recorder: ' + rec.status + (rec.error ? ' ' + rec.error : ''));
    for (const l of rec.logs.slice(-12)) log('  | ' + l.msg);
    await cleanup();
    cleanup = async () => {};

    log('Transcribing with Whisper...');
    await api('POST', '/api/transcribe/' + rec.id, {});
    for (let n = 0; n < 1200; n++) {
      await sleep(1000);
      const t = (await api('GET', '/api/state')).transcribe;
      if (t && ['done', 'error', 'cancelled'].includes(t.status)) {
        log('Transcription: ' + t.status + (t.error ? ' ' + t.error : ''));
        break;
      }
    }

    const report = score(rec.outDir, truth, pidOf);
    fs.writeFileSync(path.join(OUT, 'report.md'), report + '\n\nRecording: ' + rec.outDir + '\n');
    log('Report: ' + path.join(OUT, 'report.md'));
  } finally {
    await cleanup();
    if (!args.includes('--keep')) fs.rmSync(path.join(OUT, 'profiles'), { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});

module.exports = { score };
