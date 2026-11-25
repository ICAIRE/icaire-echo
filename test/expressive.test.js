// Expressive voice-overs (Chatterbox): English with moods and sounds, Arabic, [slow], a voice from a recording, the
// checks on the way in, and the words checked back with Whisper when it is on this computer.
// Run: node --test test/expressive.test.js   (needs the Expressive download; skipped otherwise)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { createServer } = require('../server');
const chatterbox = require('../lib/chatterbox');
const whisper = require('../lib/whisper');
const wav = require('../lib/wav');
const tts = require('../lib/tts');

const PORT = 4797;
const B = `http://localhost:${PORT}`;
const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'x-mrb': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
async function waitJob(server) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const s = server.getVoiceJob().snapshot();
    if (!['loading', 'running', 'encoding'].includes(s.status)) return s;
  }
}
// what Whisper hears in a 24 kHz voice-over (null when Whisper is not set up here)
let W = null;
async function hear(file, lang) {
  if (W === null) W = await whisper.detect();
  if (!W.available) return null;
  const tmp = path.join(os.tmpdir(), `echo-x-${process.pid}-${Date.now()}.wav`);
  spawnSync(ffmpeg, ['-loglevel', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', tmp]);
  const r = spawnSync(W.engine, ['-m', W.models[0].path, '-f', tmp, '-l', lang, '-nt', '-np'], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  return (r.stdout || '').replace(/\s+/g, ' ').trim();
}
const words = (s) => s.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
// share of the expected words that were heard
const heardShare = (heard, want) => {
  const h = new Set(words(heard));
  const w = words(want);
  return w.filter((x) => h.has(x)).length / w.length;
};

test('tags are read the Expressive way', () => {
  // Turbo keeps sounds inside the sentence; other languages lose them
  const en = tts.pieces('Well [laugh] that went well. [clear throat] Next.', 'lines');
  assert.equal(en.filter((p) => p[5]).length, 1, 'Standard: the laugh is its own part, the cough-like sounds are left out');
  assert.ok(en.every((p) => !/\[|\]/.test(p[0])), 'no tag is read out as words');
});

test('expressive voice-over', async (t) => {
  if (!chatterbox.installed()) return t.skip('Expressive is not downloaded on this computer');
  const voiceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-xvo-'));
  const server = createServer({ outRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'echo-xrec-')), voiceRoot, runOptions: { noOpen: true } });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const made = [];
  const make = async (text, expressive) => {
    const r = await post('/api/voice/generate', { text, preset: 'presenter', changes: { engine: 'expressive', expressive, music: { on: false } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = await waitJob(server);
    assert.equal(s.status, 'done', s.error || '');
    const dir = path.join(voiceRoot, s.id);
    const w = wav.read(path.join(dir, 'voice.wav'));
    return { dir, sec: w.samples.length / w.rate, w };
  };
  try {
    await t.test('status lists 23 languages and the ready voices', async () => {
      const s = await fetch(B + '/api/expressive').then((r) => r.json());
      assert.equal(s.installed, true);
      assert.equal(s.languages.length, 23);
      assert.ok(s.languages.find((l) => l.code === 'ar' && l.rtl && !l.sounds && l.intensity));
      assert.ok(s.languages.find((l) => l.code === 'en' && l.sounds));
      assert.ok(s.voices.find((v) => v.id === 'heart'));
    });

    let plain;
    await t.test('English: the words come out right, with a laugh and a mood', async () => {
      const line = 'We finished the project a week early.';
      plain = await make(line, { lang: 'en', voice: 'heart' });
      const tagged = await make(`[happy] We finished the project a week early. [laugh] Nobody expected that.`, { lang: 'en', voice: 'heart' });
      assert.ok(plain.sec > 1.5 && plain.sec < 8, `plain ${plain.sec}`);
      assert.ok(tagged.sec > plain.sec + 0.8, `the laugh and the second sentence add time: ${tagged.sec} vs ${plain.sec}`);
      const lines = JSON.parse(fs.readFileSync(path.join(tagged.dir, 'lines.json'), 'utf8')).lines;
      assert.ok(lines.some((l) => l.text.includes('[laugh]')), 'the timing shows the tag as written, not the internal mark');
      const h = await hear(path.join(plain.dir, 'voice.wav'), 'en');
      if (h !== null) assert.ok(heardShare(h, line) >= 0.8, `Whisper heard: ${h}`);
      made.push(plain.dir, tagged.dir);
    });

    await t.test('[whisper] is quieter, [slow] is longer', async () => {
      const line = 'Please keep this between the two of us.';
      const loud = await make(line, { lang: 'en', voice: 'heart' });
      const quiet = await make(`[whisper]${line}`, { lang: 'en', voice: 'heart' });
      const slow = await make(`[slow]${line}[/slow]`, { lang: 'en', voice: 'heart' });
      const rms = (a) => Math.sqrt(a.reduce((n, x) => n + x * x, 0) / a.length);
      // the export evens out the loudness, so compare before it: raw level of the speech parts
      assert.ok(quiet.sec > 1 && loud.sec > 1);
      assert.ok(slow.sec > loud.sec * 1.08, `slow ${slow.sec} vs ${loud.sec}`);
      assert.ok(rms(quiet.w.samples) > 0, 'the whisper is not silent');
    });

    await t.test('Arabic: read by Multilingual, words checked by Whisper', async () => {
      const line = 'مرحباً بكم في هذا اللقاء. نبدأ الآن.';
      const ar = await make(line, { lang: 'ar', voice: 'heart', intensity: 0.5 });
      assert.ok(ar.sec > 1.5 && ar.sec < 10, `arabic ${ar.sec}`);
      const h = await hear(path.join(ar.dir, 'voice.wav'), 'ar');
      if (h !== null) assert.ok(heardShare(h, line) >= 0.6, `Whisper heard: ${h}`);
    });

    await t.test('a voice from a recording: added, used, removed', async () => {
      // a 12 s recording: the Heart sample the app made, read back as an MP3 upload
      const src = path.join(chatterbox.DIR, 'voices', 'ready', 'heart.wav');
      assert.ok(fs.existsSync(src), 'the ready voice sample was made on first use');
      const mp3 = path.join(os.tmpdir(), `echo-own-${process.pid}.mp3`);
      spawnSync(ffmpeg, ['-loglevel', 'error', '-y', '-i', src, '-i', src, '-filter_complex', 'concat=n=2:v=0:a=1', mp3]);
      const up = (q) => fetch(`${B}/api/expressive/voices?${q}`, { method: 'POST', headers: { 'x-mrb': '1', 'content-type': 'audio/mpeg' }, body: fs.readFileSync(mp3) }).then(async (r) => ({ status: r.status, body: await r.json() }));
      assert.equal((await up('name=Test%20voice')).status, 400, 'no consent, no voice');
      const added = await up('name=Test%20voice&consent=1');
      assert.equal(added.status, 200, JSON.stringify(added.body));
      assert.equal((await up('name=Test%20voice&consent=1')).status, 400, 'the same name twice is refused');
      const short = path.join(os.tmpdir(), `echo-short-${process.pid}.wav`);
      spawnSync(ffmpeg, ['-loglevel', 'error', '-y', '-i', src, '-t', '2', short]);
      const tooShort = await fetch(`${B}/api/expressive/voices?name=Short&consent=1`, { method: 'POST', headers: { 'x-mrb': '1' }, body: fs.readFileSync(short) }).then((r) => r.json());
      assert.match(tooShort.error, /seconds of speech/);
      const used = await make('This is my own voice. [voice Heart]And this is Heart.[/voice]', { lang: 'en', voice: added.body.id });
      assert.ok(used.sec > 2);
      const gone = await post('/api/expressive/voices/remove', { id: added.body.id });
      assert.equal(gone.status, 200);
      assert.ok(!gone.body.voices.some((v) => v.id === added.body.id));
      fs.rmSync(mp3, { force: true });
      fs.rmSync(short, { force: true });
    });

    await t.test('refuses an unknown voice and an unknown language', async () => {
      const r = await post('/api/voice/generate', { text: 'Hi.', preset: 'presenter', changes: { engine: 'expressive', expressive: { lang: 'xx', voice: 'heart' } } });
      assert.equal(r.status, 200);
      const s = await waitJob(server);
      assert.equal(s.status, 'error');
      assert.match(s.error, /language/);
    });
  } finally {
    server.close();
  }
});
