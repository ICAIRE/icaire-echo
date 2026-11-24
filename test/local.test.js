// "Record here" without a meeting: the panel streams microphone chunks, finish makes audio.wav and a plain transcript.
// Run: node --test test/local.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { createServer } = require('../server');
const { writeTranscript } = require('../merge');

const PORT = 4798;
const BASE = `http://localhost:${PORT}`;
const post = (p, body, raw) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'x-mrb': '1', 'content-type': raw ? 'application/octet-stream' : 'application/json' },
    body: raw ? body : JSON.stringify(body || {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('record here: chunks -> audio.wav, hidden while recording, plain transcript lines', async () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-local-'));
  const src = path.join(outRoot, 'mic.webm');
  spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3', '-c:a', 'libopus', src]);
  const server = createServer({ outRoot, runOptions: { noOpen: true }, whisperDetect: async () => ({ available: false, reason: 'not in this test', models: [] }) });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  try {
    const { body: { id } } = await post('/api/local/start', { mime: 'audio/webm' });
    assert.match(id, /^\d{4}-\d\d-\d\d-/);
    const listed = await fetch(BASE + '/api/recordings').then((r) => r.json());
    assert.ok(!listed.some((r) => r.id === id), 'not listed while recording');

    const buf = fs.readFileSync(src);
    const half = Math.floor(buf.length / 2);
    assert.equal((await post(`/api/local/${id}/chunk`, buf.subarray(0, half), true)).status, 200);
    assert.equal((await post(`/api/local/${id}/chunk`, buf.subarray(half), true)).status, 200);
    const fin = await post(`/api/local/${id}/finish`, { durationMs: 3000 });
    assert.equal(fin.status, 200);
    assert.equal(fin.body.durationSec, 3);
    assert.match(fin.body.transcribe.error, /not in this test/, 'transcription is attempted right away');

    const rec = (await fetch(BASE + '/api/recordings').then((r) => r.json())).find((r) => r.id === id);
    assert.equal(rec.kind, 'local');
    assert.deepEqual(rec.files.map((f) => f.name).sort(), ['audio.wav', 'meta.json']);

    // a transcript of a microphone recording has no "Unknown:" speaker labels
    const dir = path.join(outRoot, id);
    const w = path.join(dir, 'whisper.json');
    fs.writeFileSync(w, JSON.stringify({ segments: [{ start: 0.2, end: 2.5, text: ' hello there: one two' }] }));
    const { txt } = writeTranscript(dir, w);
    assert.equal(txt.trim(), '[00:00:00 - 00:00:02] hello there: one two');

    assert.equal((await post('/api/local/nope/finish')).status, 404, 'unknown id');
    const { body: { id: empty } } = await post('/api/local/start');
    const r = await post(`/api/local/${empty}/finish`, { durationMs: 1000 });
    assert.equal(r.status, 400, 'nothing recorded');
    assert.ok(!fs.existsSync(path.join(outRoot, empty)), 'empty recording folder removed');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

// "Also record the people in my call": the panel shares another tab's sound (the call) and mixes it with the
// microphone into one audio.wav. The browser's share picker can't be clicked in a hidden browser, so the shared
// sound is stood in by a 440 Hz tone; the fake microphone plays a 1000 Hz pulse.
const { CHROME } = require('../lib/session');
const tone = (file, expr, sec) =>
  spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=48000:d=${sec}`, '-ac', '1', file]);
// strength of one frequency in a mono 16 kHz+ wav (Goertzel over the whole file)
function strength(wav, hz) {
  const pcm = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', wav, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 28 }).stdout;
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const w = (2 * Math.PI * hz) / 16000;
  let s1 = 0, s2 = 0;
  for (const v of x) [s1, s2] = [v + 2 * Math.cos(w) * s1 - s2, s1];
  return Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2) / x.length;
}

test('record here with the call: microphone and the shared call sound land in one audio.wav', { skip: !CHROME && 'Chrome not found' }, async () => {
  const { chromium } = require('playwright-core');
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-call-'));
  const mic = path.join(outRoot, 'mic.wav');
  tone(mic, '0.5*sin(2*PI*1000*t)*lt(mod(t,0.6),0.3)', 20);
  assert.ok(fs.existsSync(mic), 'test microphone file made');
  const server = createServer({ outRoot, runOptions: { noOpen: true }, whisperDetect: async () => ({ available: false, reason: 'not in this test', models: [] }) });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ // never plays anything out loud: --mute-audio
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${mic}`,
      '--mute-audio', // nothing reaches the speakers
    ],
  });
  try {
    const ctx = await browser.newContext({ permissions: ['microphone'] });
    const panel = await ctx.newPage();
    await panel.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const a = new AudioContext();
        const o = a.createOscillator();
        o.frequency.value = 440;
        const g = a.createGain();
        g.gain.value = 0.4;
        const d = a.createMediaStreamDestination();
        o.connect(g).connect(d);
        o.start();
        await a.resume();
        const v = document.createElement('canvas').captureStream(1).getVideoTracks()[0];
        window.__shared = new MediaStream([v, ...d.stream.getAudioTracks()]);
        return window.__shared;
      };
    });
    await panel.goto(BASE + '/');
    assert.equal(await panel.isChecked('#localCall'), true, 'on by default');
    assert.match(await panel.textContent('#localHint'), /share/);
    await panel.click('#bigBtn');
    await panel.waitForSelector('#viewLive:not([hidden])', { timeout: 15000 });
    assert.match(await panel.textContent('#captureStatus'), /Call sound on/);
    assert.equal(await panel.textContent('#liveLabel'), 'Recording');
    await panel.waitForTimeout(4000);
    // the browser's own 'Stop sharing' button: recording carries on with the microphone and says so
    await panel.evaluate(() => window.__shared.getAudioTracks()[0].dispatchEvent(new Event('ended')));
    await panel.waitForFunction(() => /only your microphone/.test(document.getElementById('liveSub').textContent));
    await panel.waitForTimeout(1000);
    // pause: the clock stands still and nothing is recorded; resume carries on in the same recording
    const wallStart = Date.now();
    await panel.click('#captureBtn');
    assert.equal(await panel.textContent('#liveLabel'), 'Paused');
    assert.equal(await panel.textContent('#captureLabel'), 'Tap to continue');
    assert.match(await panel.textContent('#pillState'), /Paused/);
    const clockAtPause = await panel.textContent('#clock');
    await panel.waitForTimeout(3000);
    assert.equal(await panel.textContent('#clock'), clockAtPause, 'the clock stands still while paused');
    await panel.click('#captureBtn');
    assert.equal(await panel.textContent('#captureLabel'), 'Tap to pause');
    await panel.waitForTimeout(1500);
    const pausedWall = (Date.now() - wallStart) / 1000;
    await panel.click('#stopBtn');
    await panel.waitForSelector('#viewRec:not([hidden])', { timeout: 30000 });
    assert.match(await panel.textContent('#recFacts'), /microphone and call sound/);

    const id = fs.readdirSync(outRoot).find((d) => /^\d{4}-/.test(d));
    const meta = JSON.parse(fs.readFileSync(path.join(outRoot, id, 'meta.json'), 'utf8'));
    assert.equal(meta.source, 'microphone+computer');
    const fileSec = Number((/Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(outRoot, id, 'audio.wav')]).stderr.toString()) || []).slice(1).reduce((a, x) => a * 60 + Number(x), 0));
    console.log(`# recorded ${meta.durationSec.toFixed(1)} s, audio.wav ${fileSec.toFixed(1)} s, paused about 3 s of ${pausedWall.toFixed(1)} s`);
    assert.ok(Math.abs(fileSec - meta.durationSec) < 1.5, 'the file is as long as the recorded time');
    assert.ok(meta.durationSec < 4 + 1 + pausedWall - 2, 'the paused time is not in the recording');
    const wav = path.join(outRoot, id, 'audio.wav');
    const [callHz, micHz, none] = [strength(wav, 440), strength(wav, 1000), strength(wav, 2700)];
    console.log(`# call 440 Hz ${callHz.toFixed(4)}, mic 1000 Hz ${micHz.toFixed(4)}, empty band ${none.toFixed(4)}`);
    const peak = Number(/max_volume: (-?[0-9.]+) dB/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString())[1]);
    console.log(`# loudest peak ${peak} dB`);
    assert.ok(peak < -0.5, 'two loud voices together do not clip');
    assert.ok(callHz > 10 * none, 'the call is in the recording');
    assert.ok(micHz > 10 * none, 'the microphone is in the recording');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});
