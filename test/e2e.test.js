// End-to-end: real bot, real (hidden) Chrome, fake Meet. Run: npm run test:e2e
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { BotRun } = require('../lib/runner');
const { mockMeet, BASE } = require('./mock-meet');

const URL = 'https://meet.google.com/abc-defg-hij';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function probe(file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const e = r.stderr || '';
  const d = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(e);
  return {
    durationSec: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    video: /Stream #.*Video: (\w+)/.exec(e)?.[1] || null,
    audio: /Stream #.*Audio: (\w+)/.exec(e)?.[1] || null,
    meanDb: Number(/mean_volume: (-?[\d.]+) dB/.exec(e)?.[1] ?? -99),
  };
}

// Runs the bot against the fake meeting. `during(run, page)` runs once recording starts.
async function runBot(mock, opts = {}, during) {
  const outRoot = tmp('mrb-out-');
  const profile = tmp('mrb-prof-');
  const meeting = mockMeet(mock);
  let page;
  let probeInfo = {};
  const run = new BotRun({
    url: URL,
    outRoot,
    profile,
    pollMs: 500,
    previewMs: 1000,
    ...meeting,
    ...opts,
    setupPage: async (p) => {
      page = p;
      await meeting.setupPage(p);
    },
  });
  const statuses = [];
  let duringP = null;
  run.on('update', (s) => {
    if (statuses[statuses.length - 1] !== s.status) statuses.push(s.status);
    if (s.status === 'recording' && !duringP) {
      duringP = (async () => {
        probeInfo = await page.evaluate(() => ({ incallAt: window.__incallAt, t0: window.__mrb.t0, log: window.__log, authuser: new URLSearchParams(location.search).get('authuser') })).catch(() => ({}));
        if (during) await during(run, page);
      })();
    }
  });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('run timed out; statuses: ' + statuses.join(' > '))), opts.timeoutMs || 90000);
  });
  const snap = await Promise.race([run.run(), timeout]).finally(() => clearTimeout(timer));
  await duringP;
  fs.rmSync(profile, { recursive: true, force: true });
  return { snap, run, statuses, probeInfo, outRoot, dir: snap.outDir };
}

test('happy path: joins as guest, records, detects speakers, auto-stops when the call ends', async () => {
  let pageLog = [];
  const { snap, statuses, probeInfo, dir, outRoot } = await runBot({ endAfterMs: 10000, upsellAtMs: 4000 }, {}, async (run, page) => {
    await new Promise((r) => setTimeout(r, 6500));
    pageLog = await page.evaluate(() => window.__log).catch(() => []);
  });
  try {
    assert.equal(snap.status, 'done', snap.error || '');
    assert.match(snap.stopReason, /meeting ended/);
    assert.deepEqual(statuses.filter((s) => s !== 'starting'), ['joining', 'waiting', 'recording', 'stopping', 'processing', 'done']);
    assert.deepEqual(probeInfo.log, ['no-devices', 'ask:Recorder', 'got-it'], 'dismissed device prompt, typed name, closed the "Got it" dialog');
    assert.ok(pageLog.includes('upsell-closed'), 'closed the upsell card that appears mid-call: ' + JSON.stringify(pageLog));
    assert.ok(!pageLog.includes('upsell-learn-more'), 'never pressed anything but close');
    assert.ok(snap.logs.some((l) => /Closed a Meet pop-up/.test(l.msg)), 'logged it');

    const files = fs.readdirSync(dir).sort();
    assert.equal(files.filter((f) => /^audio\./.test(f)).length, 1, 'exactly one audio file: ' + files);
    for (const f of ['audio.wav', 'events.ndjson', 'meta.json', 'speakers.csv', 'speakers.json', 'speakers.srt', 'video.mp4']) assert.ok(files.includes(f), 'missing ' + f + ' in ' + files);
    assert.ok(!files.some((f) => f.endsWith('.part')), 'no leftover .part files');

    const v = probe(path.join(dir, 'video.mp4'));
    const a = probe(path.join(dir, 'audio.wav'));
    assert.ok(v.video && v.audio, JSON.stringify(v));
    assert.ok(v.durationSec > 7, 'video duration ' + v.durationSec);
    assert.ok(Math.abs(a.durationSec - v.durationSec) < 1.5, `audio ${a.durationSec}s vs video ${v.durationSec}s`);
    assert.ok(a.meanDb > -35, 'audio should contain the remote tones, mean ' + a.meanDb + ' dB');

    const { segments } = JSON.parse(fs.readFileSync(path.join(dir, 'speakers.json'), 'utf8'));
    const speakers = [...new Set(segments.map((g) => g.speaker))].sort();
    assert.deepEqual(speakers, ['Alice', 'Bob', 'Chen Wei'], 'bot itself must not appear; late joiner must');

    // Align the mock's schedule (ms after admission) with the recording clock.
    const offset = (probeInfo.t0 - probeInfo.incallAt) / 1000;
    const name = Object.fromEntries(BASE.participants.map((p) => [p.id, p.name]));
    for (const s of BASE.schedule) {
      const from = s.from / 1000 - offset;
      const to = Math.min(s.to / 1000 - offset, v.durationSec);
      const hit = segments.find((g) => g.speaker === name[s.id] && Math.abs(g.start - from) < 0.4 && Math.abs(g.end - to) < 0.4);
      assert.ok(hit, `expected ${name[s.id]} ${from.toFixed(2)}-${to.toFixed(2)}, got ${JSON.stringify(segments)}`);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.botParticipantIds.length, 1);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test('stop button mid-meeting: stops cleanly and keeps everything recorded so far', async () => {
  const { snap, dir, outRoot } = await runBot({}, {}, async (run) => {
    await new Promise((r) => setTimeout(r, 5000));
    run.stop('test stop');
  });
  try {
    assert.equal(snap.status, 'done');
    assert.equal(snap.stopReason, 'test stop');
    const v = probe(path.join(dir, 'video.mp4'));
    assert.ok(v.durationSec > 4 && v.durationSec < 9, 'duration ' + v.durationSec);
    assert.ok(snap.people.length >= 2);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test('everyone leaves: bot leaves on its own after the alone timeout', async () => {
  const { snap, outRoot } = await runBot({ everyoneLeavesAfterMs: 4000, schedule: [{ id: 'p1', from: 500, to: 2500 }] }, { aloneMinutes: 0.05 });
  try {
    assert.equal(snap.status, 'done');
    assert.match(snap.stopReason, /nobody else/);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test('cancel while waiting to be admitted: nothing is left on disk', async () => {
  const outRoot = tmp('mrb-out-');
  const run = new BotRun({ url: URL, outRoot, profile: tmp('mrb-prof-'), ...mockMeet({ admitDelayMs: 600000 }) });
  run.on('update', (s) => s.status === 'waiting' && setTimeout(() => run.stop('cancel test'), 500));
  const snap = await run.run();
  assert.equal(snap.status, 'cancelled');
  assert.equal(fs.readdirSync(outRoot).length, 0);
  fs.rmSync(outRoot, { recursive: true, force: true });
});

for (const [scenario, pattern] of [
  ['blocked', /refused to let the bot join/],
  ['signin', /Sign the bot in to Google/],
  ['denied', /declined/],
]) {
  test(`join failure (${scenario}) gives a clear error and leaves nothing behind`, async () => {
    const outRoot = tmp('mrb-out-');
    const run = new BotRun({ url: URL, outRoot, profile: tmp('mrb-prof-'), ...mockMeet({ scenario, admitDelayMs: 500 }) });
    const snap = await run.run();
    assert.equal(snap.status, 'error');
    assert.match(snap.error, pattern);
    assert.equal(fs.readdirSync(outRoot).length, 0);
    fs.rmSync(outRoot, { recursive: true, force: true });
  });
}

test('talk mode: you talk in the bot window, your microphone is in the recording', async () => {
  // Chrome's fake microphone plays a steady beep; the fake meeting's own people stay silent here
  const { snap, statuses, run } = await runBot({ admitDelayMs: 300, endAfterMs: 6000, schedule: [], tones: [] }, { talk: true, testMedia: true, show: false });
  assert.equal(snap.status, 'done', statuses.join(' > ') + ' ' + (snap.error || ''));
  assert.ok(run.logs.some((l) => /Your microphone is in the recording/.test(l.msg)), run.logs.map((l) => l.msg).join('\n'));
  const a = probe(path.join(snap.outDir, 'audio.wav'));
  assert.ok(a.meanDb > -60, `the microphone is heard in audio.wav (mean ${a.meanDb} dB)`);
});

test('dismisses the covering tip and joins here too with the selected Google account', async () => {
  const accounts = ['default@example.org', 'recorder@example.org'];
  const { snap, probeInfo, outRoot } = await runBot(
    { accounts, scenario: 'otherDevice', prejoinTip: true, endAfterMs: 4000 },
    { account: 'Recorder@example.org' }
  );
  try {
    assert.equal(snap.status, 'done', snap.error);
    assert.equal(probeInfo.authuser, '1');
    assert.deepEqual(probeInfo.log, ['tip-dismissed', 'notifications-dismissed', 'no-devices', 'other-ways', 'join-here-too', 'ask:Recorder', 'got-it']);
    assert.ok(snap.logs.some((l) => l.msg.includes('Joining as recorder@example.org')));
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test('no join button logs the visible choices once and stops before the admission timeout', async () => {
  const { snap, outRoot } = await runBot({ scenario: 'noJoin' }, { joinTimeoutMs: 3000, timeoutMs: 20000 });
  try {
    assert.equal(snap.status, 'error');
    assert.match(snap.error, /could not press a join button/i);
    const warnings = snap.logs.filter((l) => l.msg.includes('Buttons on the page'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].msg, /Switch here, Allow/);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});
