// Voice-over: presets, making a voice-over through the API, cancel, samples, the missing-voices state, and an exact
// match with the Ideas City presentation when that project is next to this one.
// Run: node --test test/voice.test.js   (needs the Kokoro engine and model on this computer; skipped otherwise)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { createServer } = require('../server');
const kokoro = require('../lib/kokoro');
const tts = require('../lib/tts');
const wav = require('../lib/wav');

const PORT = 4796;
const B = `http://localhost:${PORT}`;
const post = (p, body, base = B) =>
  fetch(base + p, { method: 'POST', headers: { 'x-mrb': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const duration = (file) => {
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr || '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};
async function waitJob(server) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const s = server.getVoiceJob().snapshot();
    if (!['loading', 'running', 'encoding'].includes(s.status)) return s;
  }
}

test('voice-over', async (t) => {
  const d = await kokoro.detect();
  if (!d.available) return t.skip('Kokoro is not set up on this computer: ' + d.reason);
  const voiceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-vo-'));
  const server = createServer({ outRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-rec-')), voiceRoot, runOptions: { noOpen: true } });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  try {
    await t.test('presets copy the presentation and the radio hosts', async () => {
      const info = await fetch(B + '/api/voice').then((r) => r.json());
      assert.equal(info.available, true);
      assert.equal(info.voices.length, 54);
      assert.equal(info.languages.length, 9);
      const [presenter, layla, omar] = info.presets;
      assert.equal(presenter.recommended, true);
      // the walkthrough's pacing: one sentence at a time, 0.5 s between sentences, 1.3 s more between paragraphs
      assert.deepEqual([presenter.settings.voice, presenter.settings.speed, presenter.settings.split, presenter.settings.pauses.sentence, presenter.settings.pauses.paragraph, presenter.settings.export.loudnorm], ['af_heart', 0.94, 'sentences', 0.5, 1.3, true]);
      assert.deepEqual([layla.settings.voice, layla.settings.speed, layla.settings.closeGaps.on, layla.settings.room.wet], ['af_heart', 0.97, true, 0.11]);
      assert.deepEqual([omar.settings.voice, omar.settings.speed, omar.settings.level.target], ['am_fenrir', 0.97, 0.085]);
    });

    const text = 'Welcome to the test. This is the first line.\nHow many lines are there? There are 3.\n\nThank you for listening.';
    let normal;
    await t.test('makes a voice-over with each preset; speed changes the length', async () => {
      for (const preset of ['presenter', 'layla', 'omar']) {
        const r = await post('/api/voice/generate', { text, preset });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const s = await waitJob(server);
        assert.equal(s.status, 'done', s.error || '');
        const dir = path.join(voiceRoot, s.id);
        for (const f of ['voice.mp3', 'voice.wav', 'script.txt', 'settings.json', 'lines.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
        assert.ok(!fs.existsSync(path.join(dir, 'raw.wav')), 'raw file cleaned up');
        const lines = JSON.parse(fs.readFileSync(path.join(dir, 'lines.json'), 'utf8')).lines;
        // the Presenter reads sentence by sentence (5 sentences); the radio hosts line by line (3 lines)
        assert.equal(lines.length, preset === 'presenter' ? 5 : 3, 'one piece per sentence or per line');
        if (preset === 'presenter') normal = duration(path.join(dir, 'voice.wav'));
      }
      const r = await post('/api/voice/generate', { text, preset: 'presenter', changes: { speed: 1.3 } });
      const s = await waitJob(server);
      assert.equal(s.status, 'done');
      const saved = JSON.parse(fs.readFileSync(path.join(voiceRoot, r.body.id, 'settings.json'), 'utf8'));
      assert.equal(saved.settings.speed, 1.3, 'the change is what was used');
      assert.equal(saved.settings.voice, 'af_heart', 'everything else stays the preset');
      const fast = duration(path.join(voiceRoot, r.body.id, 'voice.wav'));
      assert.ok(fast < normal - 0.5, `faster speed is shorter: ${fast} vs ${normal}`);
      const list = await fetch(B + '/api/voiceovers').then((x) => x.json());
      assert.equal(list.length, 4);
    });

    await t.test('cancel stops it and leaves nothing behind', async () => {
      const long = Array.from({ length: 40 }, (_, i) => `This is line number ${i + 1} of a long script that will be cancelled.`).join('\n');
      const r = await post('/api/voice/generate', { text: long, preset: 'presenter' });
      assert.equal(r.status, 200);
      assert.equal((await post('/api/voice/generate', { text: 'again', preset: 'presenter' })).status, 409, 'one at a time');
      await new Promise((x) => setTimeout(x, 2500));
      assert.equal((await post('/api/voice/cancel')).status, 200);
      const s = await waitJob(server);
      assert.equal(s.status, 'cancelled');
      await new Promise((x) => setTimeout(x, 300));
      assert.ok(!fs.existsSync(path.join(voiceRoot, r.body.id)), 'folder removed');
    });

    await t.test('samples play for presets and for a voice in another language', async () => {
      for (const body of [{ preset: 'omar' }, { preset: 'presenter', changes: { voice: 'ff_siwis' } }, { preset: 'presenter', changes: { voice: 'jf_alpha' } }]) {
        const r = await post('/api/voice/sample', body);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const a = await fetch(B + r.body.url);
        assert.equal(a.headers.get('content-type'), 'audio/mpeg');
        assert.ok((await a.arrayBuffer()).byteLength > 10000);
      }
    });

    await t.test('empty script is refused with a plain message', async () => {
      const r = await post('/api/voice/generate', { text: '   ', preset: 'presenter' });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /script/i);
    });
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(voiceRoot, { recursive: true, force: true });
  }
});

test('voice-over without the voices downloaded asks for them', async () => {
  const PORT = 4795;
  const B = `http://localhost:${PORT}`;
  const server = createServer({ outRoot: os.tmpdir(), voiceRoot: os.tmpdir(), runOptions: { noOpen: true }, voiceDetect: async () => ({ available: false, needs: ['model'], reason: 'The voices are not downloaded yet.' }) });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  try {
    const info = await fetch(B + '/api/voice').then((r) => r.json());
    assert.equal(info.available, false);
    assert.deepEqual(info.needs, ['model']);
    assert.ok(info.downloadBytes > 350e6 && info.downloadBytes < 360e6, 'about 354 MB');
    const r = await post('/api/voice/generate', { text: 'hello', preset: 'presenter' }, B);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not downloaded/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('the Presenter preset sounds exactly like the Ideas City presentation', async (t) => {
  const ic = path.join(__dirname, '..', '..', 'ideas-city-walkthrough');
  const d = await kokoro.detect();
  if (!d.available || !fs.existsSync(path.join(ic, 'kokoro', 'cache'))) return t.skip('the Ideas City project is not next to this one');
  // The presentation's spoken lines are the plain strings in its script's CHAPTERS; its build cached each one under the
  // same file name scheme the voice-over uses, so a line spoken here can be compared with the presentation's own file.
  const src = fs.readFileSync(path.join(ic, 'city-kits-demo', 'voice', 'script.py'), 'utf8');
  const lines = [...src.slice(src.indexOf('CHAPTERS = ['), src.indexOf('\nSAY = {')).matchAll(/^\s*"((?:[^"\\]|\\.)*)",\s*$/gm)].map((m) => JSON.parse('"' + m[1] + '"'));
  const s = kokoro.settingsFor('presenter');
  const picks = [];
  for (const want of [(x) => x.includes('Manara'), (x) => x.includes('?'), (x) => /\d/.test(x), (x) => x.includes('ICAIRE'), () => true]) {
    const x = lines.find((l) => want(l) && !picks.includes(l) && fs.existsSync(path.join(ic, 'kokoro', 'cache', tts.cacheName(l, s, s.speed, 'en-us'))));
    if (x) picks.push(x);
  }
  assert.ok(picks.length >= 4, 'compared ' + picks.length + ' lines');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-parity-'));
  for (const text of picks) {
    const mine = await tts.speakLine({ text, settings: s, speed: s.speed, lang: 'en-us', modelDir: d.modelDir, cacheDir });
    const theirs = wav.read(path.join(ic, 'kokoro', 'cache', tts.cacheName(text, s, s.speed, 'en-us'))).samples;
    assert.equal(mine.length, theirs.length, 'same length: ' + text);
    let max = 0;
    for (let i = 0; i < mine.length; i++) max = Math.max(max, Math.abs(mine[i] - theirs[i]));
    assert.ok(max < 1e-4, `same sound: ${text} (max difference ${max})`);
  }
});
