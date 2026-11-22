// Control panel test: real server + real bot + fake Meet, driven through the UI in a headless browser.
// Run: npm run test:ui
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const { createServer } = require('../server');
const { CHROME } = require('../lib/session');
const { mockMeet } = require('./mock-meet');

const PORT = 4799;
const BASE = `http://localhost:${PORT}`;

function raw(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: { host: `localhost:${PORT}`, ...headers } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('control panel: join, live stats, stop, files, captions, Whisper merge, and API guards', async (t) => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-ui-out-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-ui-prof-'));
  const server = createServer({
    outRoot,
    autoTranscribe: false, // this test uploads its own Whisper file instead
    runOptions: { profile, noOpen: true, previewMs: 1000, pollMs: 500, setupPage: mockMeet({ admitDelayMs: 1200 }) },
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  // The bad-link step gets a deliberate 400 from /api/join; Chrome logs that as a console error.
  page.on('console', (m) => m.type() === 'error' && !/status of 400/.test(m.text()) && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    await t.test('API guards', async () => {
      assert.equal((await raw('POST', '/api/stop', { headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'POST without x-mrb header');
      assert.equal((await raw('GET', '/api/state', { headers: { host: 'evil.example:4799' } })).status, 403, 'foreign Host header');
      assert.equal((await raw('GET', '/rec/..%2F..%2Fsecret/x.txt')).status, 404, 'path traversal');
      assert.equal((await raw('GET', '/ui/..%2Fserver.js')).status, 404, 'ui traversal');
      const bad = await raw('POST', '/api/join', { headers: { 'x-mrb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://zoom.us/j/123' }) });
      assert.equal(bad.status, 400);
      assert.match(JSON.parse(bad.body).error, /Google Meet link/);
    });

    await t.test('bad link shows an inline error', async () => {
      await page.goto(BASE);
      await page.fill('#url', 'not a meet link');
      await page.click('.btn-join');
      await page.waitForFunction(() => document.querySelector('#joinError').textContent.length > 0);
      assert.match(await page.textContent('#joinError'), /Google Meet link|valid link/);
    });

    await t.test('join -> waiting -> recording with live data', async () => {
      await page.fill('#url', 'meet.google.com/abc-defg-hij'); // no https:// on purpose
      await page.click('.btn-join');
      await page.waitForSelector('#live:not([hidden])');
      await page.waitForFunction(() => document.body.dataset.status === 'recording', null, { timeout: 30000 });

      const dup = await raw('POST', '/api/join', { headers: { 'x-mrb': '1', 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://meet.google.com/abc-defg-hij' }) });
      assert.equal(dup.status, 409, 'second join while running is refused');

      const c1 = await page.textContent('#clock');
      await page.waitForTimeout(2200);
      const c2 = await page.textContent('#clock');
      assert.notEqual(c1, c2, 'clock ticks');

      await page.waitForFunction(() => document.querySelectorAll('.person').length >= 2, null, { timeout: 15000 });
      await page.waitForSelector('.person.speaking', { timeout: 15000 });
      await page.waitForSelector('#preview:not([hidden])', { timeout: 10000 });
      const names = await page.$$eval('.person-name', (els) => els.map((e) => e.textContent));
      assert.ok(names.includes('Alice') && names.includes('Bob'), names.join(','));
      assert.ok(!names.includes('Recorder'), 'bot is not listed as a person');
      const lanesH = await page.$eval('#lanes', (c) => c.clientHeight);
      assert.ok(lanesH > 60, 'timeline canvas drawn, height ' + lanesH);
      const statsText = await page.textContent('#stats');
      assert.match(statsText, /Video written/);
      await page.waitForFunction(() => parseFloat(document.querySelector('#stats .stat dd')?.textContent) > 0, null, { timeout: 10000 }); // video bytes flowing
      await page.screenshot({ path: path.join(__dirname, 'out', 'ui-live.png') });
    });

    await t.test('stop -> processing -> done summary + recordings list', async () => {
      await page.waitForTimeout(4000);
      await page.click('#stopBtn');
      await page.waitForFunction(() => document.body.dataset.status === 'done', null, { timeout: 60000 });
      assert.match(await page.textContent('#doneSub'), /recorded/);
      await page.waitForSelector('.rec-item');
      const files = await page.$$eval('.rec-item .rec-files a', (as) => as.map((a) => a.textContent));
      for (const f of ['video.mp4', 'audio.wav', 'speakers.csv', 'speakers.srt']) assert.ok(files.includes(f), files.join(','));
      await page.screenshot({ path: path.join(__dirname, 'out', 'ui-done.png'), fullPage: true });
    });

    await t.test('files download, video seeks (range requests), captions served as VTT', async () => {
      const id = fs.readdirSync(outRoot)[0];
      const mp4 = await raw('GET', `/rec/${id}/video.mp4`, { headers: { range: 'bytes=0-99' } });
      assert.equal(mp4.status, 206);
      assert.equal(mp4.headers['content-range'].split('/')[0], 'bytes 0-99');
      const vtt = await raw('GET', `/rec/${id}/speakers.vtt`);
      assert.equal(vtt.status, 200);
      assert.match(vtt.body, /^WEBVTT/);
      assert.match(vtt.body, /\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\n(Alice|Bob)/);

      await page.click('.act-watch');
      const meta = await page.$eval('.rec-player video', (v) =>
        new Promise((res) => (v.readyState >= 1 ? res() : v.addEventListener('loadedmetadata', res, { once: true }))).then(() => ({ d: v.duration, w: v.videoWidth, cues: v.textTracks.length }))
      );
      assert.ok(meta.d > 3 && meta.w > 0 && meta.cues === 1, JSON.stringify(meta));
    });

    await t.test('upload a Whisper transcript -> speaker-labeled transcript', async () => {
      const id = fs.readdirSync(outRoot)[0];
      const { segments } = JSON.parse(fs.readFileSync(path.join(outRoot, id, 'speakers.json'), 'utf8'));
      const whisper = {
        segments: segments.map((g, i) => ({ start: g.start + 0.05, end: g.end - 0.05, text: ` line ${i} from ${g.speaker.toLowerCase()}` })),
      };
      const wf = path.join(os.tmpdir(), 'mrb-whisper.json');
      fs.writeFileSync(wf, JSON.stringify(whisper));
      await page.setInputFiles('.act-merge input', wf);
      await page.waitForFunction(() => /turns/.test(document.querySelector('.rec-transcript')?.textContent || ''), null, { timeout: 15000 });
      const txt = fs.readFileSync(path.join(outRoot, id, 'transcript.txt'), 'utf8');
      for (const line of txt.trim().split('\n')) {
        const m = /\] (.+?)(?: \(over: [^)]*\))?: line \d+ from (.+)$/.exec(line);
        assert.ok(m, line);
        assert.equal(m[1].toLowerCase(), m[2], 'speaker label matches: ' + line);
      }
    });

    assert.deepEqual(consoleErrors, [], 'no browser console errors: ' + JSON.stringify(consoleErrors));
  } finally {
    await browser.close();
    const cur = server.getCurrent();
    if (cur && cur.active) cur.stop('test teardown');
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
    fs.rmSync(outRoot, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
