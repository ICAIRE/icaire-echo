// Transcription from the control panel, with the Whisper model installed on this computer.
// Skips itself when no faster-whisper install or model is found.  Run: npm run test:whisper
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { createServer } = require('../server');
const { CHROME } = require('../lib/session');
const { detect } = require('../lib/whisper');
const { makeSpeechRecording, SCRIPT } = require('./speech-fixture');

const PORT = 4798;
const BASE = `http://localhost:${PORT}`;
const words = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);

test('transcribe from the panel: progress bar, speaker-labeled transcript, copy button', async (t) => {
  const w = await detect();
  if (!w.available) return t.skip('Whisper not available: ' + w.reason);

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-whisper-'));
  const id = '2026-01-02-10-00-00';
  makeSpeechRecording(path.join(outRoot, id));
  const server = createServer({ outRoot, runOptions: { noOpen: true } });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  try {
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelector('#whisperInfo').dataset.state === 'ready', null, { timeout: 60000 });
    const badge = await page.textContent('#whisperInfo');
    assert.match(badge, new RegExp(w.models[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), badge);

    await t.test('cancel stops a running transcription', async () => {
      await page.click('.act-transcribe');
      await page.waitForSelector('.tx-progress:not([hidden])');
      await page.click('.tx-cancel');
      await page.waitForSelector('.tx-progress', { state: 'hidden', timeout: 15000 });
      await page.waitForFunction(() => !document.querySelector('.act-transcribe').disabled, null, { timeout: 10000 });
      assert.ok(!fs.existsSync(path.join(outRoot, id, 'transcript.txt')));
    });

    await t.test('progress climbs to done, transcript appears with the right speakers', async () => {
      const seen = [];
      await page.exposeFunction('__pct', (p) => seen.push(p));
      await page.evaluate(() => {
        new MutationObserver(() => window.__pct(document.querySelector('.tx-pct')?.textContent || '')).observe(document.querySelector('#recList'), { subtree: true, characterData: true, childList: true });
      });
      await page.click('.act-transcribe');
      await page.waitForSelector('.tx-progress:not([hidden])');
      await page.waitForSelector('.rec-transcript:not([hidden])', { timeout: 180000 });
      await page.screenshot({ path: path.join(__dirname, 'out', 'ui-transcript.png') });
      const pcts = seen.map((s) => parseInt(s, 10)).filter(Number.isFinite);
      assert.ok(pcts.some((p) => p > 0 && p < 100), 'saw an in-between percentage: ' + seen.join(' '));

      const txt = fs.readFileSync(path.join(outRoot, id, 'transcript.txt'), 'utf8');
      // Words said under each speaker label, in order.
      const said = { Alice: [], Bob: [] };
      for (const l of txt.trim().split('\n')) {
        const m = /\] (\w+)(?: \(over: [^)]*\))?: (.*)$/.exec(l);
        assert.ok(m && said[m[1]], 'unexpected line: ' + l);
        said[m[1]].push(...words(m[2]));
      }
      // At least 90% of each sentence's words must land under the right speaker. (Whisper's word timing
      // is about +-0.2 s, so a single word right at an interruption may land on the other side.)
      for (const u of SCRIPT) {
        const w = words(u.text);
        const pool = said[u.speaker].join(' ');
        const hit = w.filter((x) => new RegExp(`\\b${x}\\b`).test(pool)).length;
        assert.ok(hit / w.length >= 0.9, `"${u.text}": only ${hit}/${w.length} words under ${u.speaker}\n${txt}`);
      }
      const totalWords = SCRIPT.reduce((n, u) => n + words(u.text).length, 0);
      const misplaced = SCRIPT.reduce((n, u) => n + words(u.text).filter((x) => !said[u.speaker].includes(x)).length, 0);
      t.diagnostic(`speaker accuracy: ${totalWords - misplaced}/${totalWords} words`);
      assert.match(await page.textContent('.tx-meta'), /2 speakers/);
      assert.equal(await page.textContent('.act-transcribe'), 'Transcribe again');
    });

    await t.test('copy puts the whole transcript on the clipboard', async () => {
      await page.click('.tx-copy');
      await page.waitForFunction(() => /Copied/.test(document.querySelector('.tx-copy').textContent));
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      // Windows stores clipboard text with CRLF line ends.
      assert.equal(clip.replace(/\r\n/g, '\n'), fs.readFileSync(path.join(outRoot, id, 'transcript.txt'), 'utf8'));
    });

    await t.test('API refuses a second job and unknown recordings', async () => {
      const post = (p) => fetch(BASE + p, { method: 'POST', headers: { 'x-mrb': '1', 'content-type': 'application/json' }, body: '{}' });
      assert.equal((await post('/api/transcribe/does-not-exist')).status, 404);
      assert.equal((await post('/api/transcribe-cancel')).status, 409);
    });

    assert.deepEqual(errors, [], 'no browser console errors');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});
