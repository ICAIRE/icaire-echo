#!/usr/bin/env node
// Local control panel: http://localhost:4777
// Paste a Meet link, press Join, watch it live, stop whenever you want, grab the files.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BotRun } = require('./lib/runner');
const { writeTranscript } = require('./merge');
const { ts } = require('./lib/timeline');
const whisper = require('./lib/whisper');
const kokoro = require('./lib/kokoro');
const { Updater, RESTART_CODE } = require('./lib/updater');
const diarize = require('./lib/diarize');
const { HAS_CHROME } = require('./lib/session');
const ffmpegPath = require('ffmpeg-static');

const ROOT = __dirname;
const openFolder = (dir) => spawn(process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ndjson': 'text/plain; charset=utf-8',
};

function createServer({ outRoot = path.join(ROOT, 'recordings'), voiceRoot = path.join(ROOT, 'voiceovers'), runOptions = {}, whisperDetect = whisper.detect, voiceDetect = kokoro.detect, autoTranscribe = true, autoUpdate = false } = {}) {
  let voiceJob = null; // the voice-over being made (or the last one)
  const voiceSetup = new kokoro.Download();
  const whisperSetup = new whisper.ModelDownload();
  const voiceExtra = new kokoro.ExtraInstall();
  voiceExtra.on('update', () => broadcast());
  whisperSetup.on('update', () => broadcast());
  voiceSetup.on('update', () => broadcast());
  const updater = new Updater();
  updater.on('update', () => broadcast());
  let current = null;
  let job = null; // the transcription in progress (or the last one)
  const clients = new Set();

  const payload = () => ({
    current: current && current.snapshot(),
    transcribe: job && job.snapshot(),
    voice: voiceJob && voiceJob.snapshot(),
    voiceSetup: voiceSetup.status === 'idle' ? null : voiceSetup.snapshot(),
    whisperSetup: whisperSetup.status === 'idle' ? null : whisperSetup.snapshot(),
    voiceExtra: voiceExtra.status === 'idle' ? null : voiceExtra.snapshot(),
    update: updater.snapshot(),
    background: process.env.MRB_BACKGROUND === '1',
  });
  let lastSent = 0;
  let pending = null;
  const broadcast = () => {
    // Progress lines can arrive many times a second; send at most ~5 updates/s.
    const send = () => {
      pending = null;
      lastSent = Date.now();
      const data = `data: ${JSON.stringify(payload())}\n\n`;
      for (const res of clients) res.write(data);
    };
    const wait = 200 - (Date.now() - lastSent);
    if (wait <= 0) send();
    else if (!pending) pending = setTimeout(send, wait);
  };

  async function startTranscription(id, { model: modelName, language } = {}) {
    const dir = recDir(id);
    if (!dir || !fs.existsSync(path.join(dir, 'audio.wav'))) throw Object.assign(new Error('This recording has no audio.wav.'), { code: 404 });
    if (job && job.active) throw Object.assign(new Error('Already transcribing another recording. Wait for it or cancel it.'), { code: 409 });
    const w = await whisperDetect();
    if (!w.available) throw Object.assign(new Error(w.reason || 'Whisper is not available.'), { code: 400 });
    const model = w.models.find((m) => m.name === modelName) || w.models[0];
    // a recording with no speaker log (made with Record) gets one from the voices; a bot recording has Meet's
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch {}
    const separate = meta.kind === 'local' && meta.people !== 1 && !fs.existsSync(path.join(dir, 'speakers.json')) && diarize.engineReady() && process.env.MRB_NO_SPEAKERS !== '1';
    job = new whisper.TranscribeJob({ id, audio: path.join(dir, 'audio.wav'), out: path.join(dir, 'whisper.json'), engine: w.engine, device: w.device, model, language, separate, people: meta.people || null });
    job.on('update', broadcast);
    const mine = job;
    mine.run().then(() => {
      if (mine.status !== 'merging') return broadcast();
      try {
        const r = writeTranscript(dir, mine.out);
        mine.set({ status: 'done', result: { turns: r.turns.length, unknown: r.unknown } });
      } catch (e) {
        mine.set({ status: 'error', error: 'Transcribed, but adding speaker names failed: ' + e.message });
      }
    });
    broadcast();
    return job.snapshot();
  }

  function listRecordings() {
    if (!fs.existsSync(outRoot)) return [];
    return fs
      .readdirSync(outRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^[\w-]+$/.test(d.name))
      .filter((d) => !(current && current.active && current.id === d.name))
      .filter((d) => !local.has(d.name))
      .map((d) => {
        const dir = path.join(outRoot, d.name);
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch {}
        let segments = [];
        try { segments = JSON.parse(fs.readFileSync(path.join(dir, 'speakers.json'), 'utf8')).segments; } catch {}
        const files = fs.readdirSync(dir).map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size }));
        return {
          id: d.name,
          startedAt: meta.startedAt || null,
          durationSec: meta.durationSec || 0,
          meetUrl: meta.meetUrl || '',
          kind: meta.kind || 'meeting',
          speakers: [...new Set(segments.map((g) => g.speaker))],
          segments: segments.length,
          files,
        };
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req, limit = 50 * 1048576) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });

  function sendFile(req, res, file) {
    let stat;
    try { stat = fs.statSync(file); } catch { return json(res, 404, { error: 'not found' }); }
    if (!stat.isFile() || path.basename(file).startsWith('.')) return json(res, 404, { error: 'not found' });
    const stream = (opts) => fs.createReadStream(file, opts).on('error', () => res.destroy());
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : Math.max(0, stat.size - +range[2]);
      const end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
      return stream({ start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': stat.size, 'cache-control': 'no-store' });
    stream().pipe(res);
  }

  const local = new Map(); // microphone recordings in progress: id -> { startedAt, mime }

  const readRaw = (req, limit) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error('too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const toWav = (src, dst) =>
    new Promise((resolve) => {
      const p = spawn(ffmpegPath, ['-hide_banner', '-y', '-i', src, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', dst], { windowsHide: true });
      p.on('close', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });

  function needsExtra(settings) {
    const lang = settings.lang && settings.lang !== 'auto' ? settings.lang : (kokoro.PRESETS.languages.find((l) => l.prefix === String(settings.voice)[0]) || { code: 'en-us' }).code;
    const key = kokoro.extraFor(lang);
    if (!key || kokoro.hasExtra(key)) return null;
    const x = kokoro.EXTRA[key];
    return { key, message: `${x.name} voices need one more download (about ${x.mb} MB) to pronounce words properly. Press "Add ${x.name}".` };
  }

  function listVoiceovers() {
    if (!fs.existsSync(voiceRoot)) return [];
    return fs
      .readdirSync(voiceRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^[\w-]+$/.test(d.name) && !(voiceJob && voiceJob.active && voiceJob.id === d.name))
      .map((d) => {
        const dir = path.join(voiceRoot, d.name);
        const read = (x) => { try { return JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')); } catch { return {}; } };
        const st = read('settings.json');
        const ln = read('lines.json');
        let text = '';
        try { text = fs.readFileSync(path.join(dir, 'script.txt'), 'utf8'); } catch {}
        const files = fs.readdirSync(dir).filter((x) => /^voice\./.test(x)).map((x) => ({ name: x, bytes: fs.statSync(path.join(dir, x)).size }));
        return { id: d.name, preset: st.preset || '', voice: st.settings ? st.settings.voice : '', speed: st.settings ? st.settings.speed : null, duration: ln.duration || 0, lang: ln.lang || '', preview: text.slice(0, 240), words: text.split(/\s+/).filter(Boolean).length, files };
      })
      .filter((v) => v.files.length)
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  // The "Sign the bot in" window uses the bot's own Chrome profile; close it (gracefully, so the sign-in is saved)
  // before the bot opens that profile.
  async function closeSignInWindow() {
    if (runOptions.setupPage) return; // the demo's fake Meet uses a profile of its own
    const { PROFILE } = require('./lib/session');
    const { spawnSync } = require('child_process');
    if (process.platform === 'win32') return;
    if (spawnSync('pgrep', ['-f', `user-data-dir=${PROFILE}`]).status !== 0) return;
    spawnSync('pkill', ['-TERM', '-f', `user-data-dir=${PROFILE}`]);
    for (let i = 0; i < 40 && spawnSync('pgrep', ['-f', `user-data-dir=${PROFILE}`]).status === 0; i++) await new Promise((r) => setTimeout(r, 250));
  }

  const recDir = (id) => (/^[\w-]+$/.test(id || '') ? path.join(outRoot, id) : null);

  const server = http.createServer(async (req, res) => {
    // Only answer to this machine's own browser (blocks DNS-rebinding and cross-site requests).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return json(res, 403, { error: 'forbidden host' });
    // a page on another site (even one only loading a picture or a sound from here) gets nothing
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'forbidden' });
    // the panel loads nothing from elsewhere, runs only its own scripts, and cannot be framed by another page
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    if (req.method !== 'GET' && req.headers['x-mrb'] !== '1') return json(res, 403, { error: 'missing header' });

    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return sendFile(req, res, path.join(ROOT, 'ui', 'index.html'));
      if (req.method === 'GET' && /^\/ui\/[\w.-]+$/.test(p)) {
        const f = path.join(ROOT, p);
        return fs.existsSync(f) ? sendFile(req, res, f) : json(res, 404, { error: 'not found' });
      }
      if (req.method === 'GET' && p === '/api/state') return json(res, 200, { ...payload(), recordings: listRecordings() });
      if (req.method === 'GET' && p === '/api/recordings') return json(res, 200, listRecordings());
      if (req.method === 'GET' && p === '/api/whisper') {
        const w = await whisperDetect({ refresh: url.searchParams.has('refresh') });
        return json(res, 200, { ...w, models: w.models.map(({ name, repo, bytes }) => ({ name, repo, bytes })) });
      }
      if (req.method === 'POST' && p === '/api/whisper/setup') {
        const w = await whisperDetect();
        if (!w.engine) return json(res, 400, { error: w.reason });
        if (!whisperSetup.active) {
          whisperSetup.run(w.device === 'cuda').then(async () => {
            await whisperDetect({ refresh: true }).catch(() => {});
            broadcast();
          });
        }
        return json(res, 200, whisperSetup.snapshot());
      }
      if (req.method === 'GET' && p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`data: ${JSON.stringify(payload())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (req.method === 'GET' && p === '/api/debug/tiles') {
        if (!current || !current.active) return json(res, 409, { error: 'The bot is not in a meeting.' });
        return json(res, 200, await current.inspectTiles());
      }
      if (req.method === 'GET' && p === '/api/debug/audio') {
        if (!current || !current.active) return json(res, 409, { error: 'The bot is not in a meeting.' });
        return json(res, 200, await current.inspectAudio());
      }
      if (req.method === 'GET' && p === '/api/preview.jpg') {
        if (!current || !current.preview) return json(res, 404, { error: 'no preview' });
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
        return res.end(current.preview);
      }
      if (req.method === 'POST' && p === '/api/join') {
        if (current && current.active) return json(res, 409, { error: 'The bot is already in a meeting. Stop it first.' });
        await closeSignInWindow(); // Chrome lets only one window use the bot's profile at a time
        if (!HAS_CHROME && !runOptions.setupPage) return json(res, 400, { error: 'The meeting bot needs Google Chrome. Install it from google.com/chrome, then try again.' });
        const body = await readBody(req);
        let link = String(body.url || '').trim();
        if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
        let u;
        try { u = new URL(link); } catch { return json(res, 400, { error: 'That is not a valid link.' }); }
        if (u.hostname !== 'meet.google.com' || u.pathname.length < 4) return json(res, 400, { error: 'Paste a Google Meet link, like https://meet.google.com/abc-defg-hij' });
        const name = String(body.name || 'Recorder').trim().slice(0, 60) || 'Recorder';
        current = new BotRun({ ...runOptions, outRoot, url: u.toString(), name, show: !!body.show || !!body.talk, talk: !!body.talk });
        current.on('update', broadcast);
        const run = current;
        run.run().then(() => {
          broadcast();
          // the transcript is the payoff: start it as soon as the meeting is saved
          if (autoTranscribe && run.status === 'done') startTranscription(run.id).catch(() => {});
        });
        return json(res, 200, current.snapshot());
      }
      if (req.method === 'POST' && p === '/api/stop') {
        if (!current || !current.active) return json(res, 409, { error: 'Nothing is running.' });
        current.stop('stopped from the control panel');
        return json(res, 200, { ok: true });
      }
      // ---------- voice-over (Kokoro) ----------
      if (req.method === 'GET' && p === '/api/voice') {
        const d = await voiceDetect({ refresh: url.searchParams.has('refresh') });
        const P = kokoro.PRESETS;
        return json(res, 200, {
          available: d.available,
          needs: d.needs,
          reason: d.reason,
          downloadBytes: P.model.files.reduce((a, x) => a + x.bytes, 0),
          languages: P.languages,
          voices: P.voices,
          samples: P.samples,
          defaults: P.defaults,
          extras: kokoro.extrasStatus(),
          presets: P.presets.map((x) => ({ id: x.id, name: x.name, about: x.about, recommended: !!x.recommended, settings: kokoro.settingsFor(x.id) })),
        });
      }
      if (req.method === 'GET' && p === '/api/voiceovers') return json(res, 200, listVoiceovers());
      if (req.method === 'POST' && p === '/api/voice/setup') {
        if (!voiceSetup.active) voiceSetup.run().then(broadcast);
        return json(res, 200, voiceSetup.snapshot());
      }
      if (req.method === 'POST' && p === '/api/voice/generate') {
        if (voiceJob && voiceJob.active) return json(res, 409, { error: 'A voice-over is already being made. Wait for it or cancel it.' });
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (!text) return json(res, 400, { error: 'Type or paste the script first.' });
        if (text.length > 200000) return json(res, 400, { error: 'That script is too long for one voice-over (over 200,000 characters). Split it into parts.' });
        const d = await voiceDetect();
        if (!d.available) return json(res, 400, { error: d.reason });
        const missing = needsExtra(kokoro.settingsFor(body.preset, body.changes));
        if (missing) return json(res, 400, { error: missing.message, needsExtra: missing.key });
        const id = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        voiceJob = new kokoro.VoiceJob({ id, text, preset: String(body.preset || 'presenter'), settings: kokoro.settingsFor(body.preset, body.changes), outDir: path.join(voiceRoot, id), modelDir: d.modelDir });
        voiceJob.on('update', broadcast);
        const mine = voiceJob;
        mine.run().then(() => {
          if (mine.status !== 'done') fs.rmSync(mine.outDir, { recursive: true, force: true });
          broadcast();
        });
        broadcast();
        return json(res, 200, voiceJob.snapshot());
      }
      if (req.method === 'POST' && p === '/api/voice/sample') {
        const body = await readBody(req);
        const d = await voiceDetect();
        if (!d.available) return json(res, 400, { error: d.reason });
        const settings = kokoro.settingsFor(body.preset, body.changes);
        const lang = settings.lang && settings.lang !== 'auto' ? settings.lang : (kokoro.PRESETS.languages.find((l) => l.prefix === settings.voice[0]) || { code: 'en-us' }).code;
        const text = String(body.text || kokoro.PRESETS.samples[lang] || kokoro.PRESETS.samples['en-us']).slice(0, 400);
        settings.music = { ...settings.music, on: false };
        const missing = needsExtra(settings);
        if (missing) return json(res, 400, { error: missing.message, needsExtra: missing.key });
        const key = kokoro.sampleKey({ ...settings, reader: kokoro.extraFor(lang) ? 'misaki' : 'espeak' }, text);
        const dir = path.join(kokoro.CACHE, 'samples', key);
        const pick = () => (fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => /^voice.(mp3|m4a)$/.test(x)) : null);
        if (pick()) return json(res, 200, { url: '/vo-sample/' + key + '/' + pick() });
        const sj = new kokoro.VoiceJob({ id: 'sample-' + key, text, preset: body.preset, settings, outDir: dir, modelDir: d.modelDir, sample: true });
        await sj.run();
        if (sj.status !== 'done') return json(res, 500, { error: sj.error || 'Could not make the sample.' });
        return json(res, 200, { url: '/vo-sample/' + key + '/' + (pick() || 'voice.wav') });
      }
      if (req.method === 'POST' && p === '/api/voice/extra') {
        const body = await readBody(req);
        if (!kokoro.EXTRA[body.key]) return json(res, 400, { error: 'Unknown language pack.' });
        const d = await voiceDetect();
        if (!d.engine) return json(res, 400, { error: d.reason });
        if (!voiceExtra.active) voiceExtra.run(body.key).then(broadcast);
        return json(res, 200, voiceExtra.snapshot());
      }
      if (req.method === 'POST' && p === '/api/voice/cancel') {
        if (!voiceJob || !voiceJob.active) return json(res, 409, { error: 'No voice-over is being made.' });
        voiceJob.cancel();
        return json(res, 200, { ok: true });
      }

      let m;
      if (req.method === 'GET' && (m = /^\/rec\/([\w-]+)\/speakers\.vtt$/.exec(p))) {
        const f = path.join(outRoot, m[1], 'speakers.json');
        if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' });
        const segs = JSON.parse(fs.readFileSync(f, 'utf8')).segments;
        res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' });
        return res.end('WEBVTT\n\n' + segs.map((g) => `${ts(g.start)} --> ${ts(g.end)}\n${g.speaker}\n`).join('\n'));
      }
      if (req.method === 'GET' && (m = /^\/rec\/([\w-]+)\/([\w.-]+)$/.exec(p))) {
        const f = path.join(outRoot, m[1], m[2]);
        if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' });
        if (url.searchParams.has('download')) res.setHeader('content-disposition', `attachment; filename="${m[2]}"`);
        return sendFile(req, res, f);
      }
      if (req.method === 'GET' && (m = /^\/vo\/([\w-]+)\/([\w.-]+)$/.exec(p))) {
        const file = path.join(voiceRoot, m[1], m[2]);
        if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        if (url.searchParams.has('download')) res.setHeader('content-disposition', 'attachment; filename="voice-over-' + m[1] + path.extname(m[2]) + '"');
        return sendFile(req, res, file);
      }
      if (req.method === 'GET' && (m = /^\/vo-sample\/([\w-]+)\/([\w.-]+)$/.exec(p))) {
        const file = path.join(kokoro.CACHE, 'samples', m[1], m[2]);
        return fs.existsSync(file) ? sendFile(req, res, file) : json(res, 404, { error: 'not found' });
      }
      if (req.method === 'POST' && (m = /^\/api\/vo-open\/([\w-]+)$/.exec(p))) {
        const dir = path.join(voiceRoot, m[1]);
        if (!fs.existsSync(dir)) return json(res, 404, { error: 'not found' });
        if (!runOptions.noOpen) openFolder(dir);
        return json(res, 200, { ok: true, dir });
      }
      if (req.method === 'POST' && (m = /^\/api\/rec-delete\/([\w-]+)$/.exec(p))) {
        const dir = recDir(m[1]);
        if (!dir || !fs.existsSync(dir)) return json(res, 404, { error: 'not found' });
        if ((current && current.active && current.id === m[1]) || local.has(m[1]) || (job && job.active && job.id === m[1])) return json(res, 409, { error: 'It is still being recorded or transcribed.' });
        fs.rmSync(dir, { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && (m = /^\/api\/vo-delete\/([\w-]+)$/.exec(p))) {
        const dir = path.join(voiceRoot, m[1]);
        if (!fs.existsSync(dir)) return json(res, 404, { error: 'not found' });
        if (voiceJob && voiceJob.active && voiceJob.id === m[1]) return json(res, 409, { error: 'It is still being made.' });
        fs.rmSync(dir, { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && (m = /^\/api\/open\/([\w-]+)$/.exec(p))) {
        const dir = recDir(m[1]);
        if (!dir || !fs.existsSync(dir)) return json(res, 404, { error: 'not found' });
        if (!runOptions.noOpen) openFolder(dir);
        return json(res, 200, { ok: true, dir });
      }
      if (req.method === 'POST' && (m = /^\/api\/merge\/([\w-]+)$/.exec(p))) {
        const dir = recDir(m[1]);
        if (!dir || !fs.existsSync(path.join(dir, 'speakers.json'))) return json(res, 404, { error: 'This recording has no speaker timeline.' });
        const body = await readBody(req);
        const ext = (/\.(json|srt|vtt)$/i.exec(body.filename || '') || [])[0];
        if (!ext) return json(res, 400, { error: 'Upload a Whisper .json, .srt or .vtt file.' });
        const src = path.join(dir, 'whisper' + ext.toLowerCase());
        fs.writeFileSync(src, String(body.content || ''));
        const { turns, txt } = writeTranscript(dir, src);
        return json(res, 200, { turns: turns.length, preview: txt.split('\n').slice(0, 40).join('\n') });
      }
      if (req.method === 'POST' && (m = /^\/api\/transcribe\/([\w-]+)$/.exec(p))) {
        const body = await readBody(req);
        try {
          return json(res, 200, await startTranscription(m[1], body));
        } catch (e) {
          return json(res, e.code || 500, { error: e.message });
        }
      }
      // Record without a meeting: the panel records this computer's microphone (and the call's sound, when shared) and streams it here in chunks,
      // so a closed tab loses at most the last few seconds. Finish converts it to audio.wav and transcribes it.
      if (req.method === 'POST' && p === '/api/local/start') {
        const id = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const dir = path.join(outRoot, id);
        fs.mkdirSync(dir, { recursive: true });
        const body = await readBody(req);
        const people = Math.round(Number(body.people)); // how many people talk, when the person said so
        local.set(id, { startedAt: new Date().toISOString(), mime: String(body.mime || 'audio/webm').slice(0, 80), source: body.source === 'microphone+computer' ? 'microphone+computer' : 'microphone', people: people >= 1 && people <= 20 ? people : null });
        fs.writeFileSync(path.join(dir, 'audio.part'), '');
        return json(res, 200, { id });
      }
      if (req.method === 'POST' && (m = /^\/api\/local\/([\w-]+)\/chunk$/.exec(p))) {
        if (!local.has(m[1])) return json(res, 404, { error: 'No recording in progress with that id.' });
        const buf = await readRaw(req, 64 * 1048576);
        fs.appendFileSync(path.join(outRoot, m[1], 'audio.part'), buf);
        return json(res, 200, { ok: true, bytes: buf.length });
      }
      if (req.method === 'POST' && (m = /^\/api\/local\/([\w-]+)\/finish$/.exec(p))) {
        const rec = local.get(m[1]);
        if (!rec) return json(res, 404, { error: 'No recording in progress with that id.' });
        local.delete(m[1]);
        const body = await readBody(req);
        const dir = path.join(outRoot, m[1]);
        const part = path.join(dir, 'audio.part');
        if (!fs.existsSync(part) || fs.statSync(part).size === 0) {
          fs.rmSync(dir, { recursive: true, force: true });
          return json(res, 400, { error: 'Nothing was recorded. Check that the microphone is allowed and working.' });
        }
        const ok = await toWav(part, path.join(dir, 'audio.wav'));
        if (!ok) return json(res, 500, { error: 'Could not convert the recording to audio.wav. The raw file is kept as audio.part.' });
        fs.unlinkSync(part);
        const durationSec = Math.max(0, Number(body.durationMs) || 0) / 1000;
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ kind: 'local', source: rec.source, startedAt: rec.startedAt, durationSec, people: rec.people }, null, 2));
        let transcribe = null;
        if (body.transcribe !== false) {
          try { transcribe = await startTranscription(m[1], {}); } catch (e) { transcribe = { error: e.message }; }
        }
        return json(res, 200, { id: m[1], durationSec, transcribe });
      }
      // sign the bot's browser into a Google account: opens Google's sign-in on the bot's own profile; the person signs in
      if (req.method === 'POST' && p === '/api/login') {
        if (current && current.active) return json(res, 409, { error: 'The bot is in a meeting. Stop it first, then sign it in.' });
        const { PROFILE, CHROME } = require('./lib/session');
        fs.mkdirSync(PROFILE, { recursive: true });
        spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', 'https://accounts.google.com/'], { detached: true, stdio: 'ignore' }).unref();
        return json(res, 200, { ok: true });
      }
      // the Mac app runs without a window: the panel's Quit button ends it (never mid-recording or mid-job)
      if (req.method === 'POST' && p === '/api/quit') {
        if (!idle()) return json(res, 409, { error: 'Something is still recording or being made. Stop it first.' });
        json(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 300);
        return;
      }
      // ---------- updates ----------
      if (req.method === 'POST' && p === '/api/update/check') return json(res, 200, await updater.check());
      if (req.method === 'POST' && p === '/api/update/apply') {
        if (!idle()) return json(res, 409, { error: 'Finish the recording or the job that is running first, then update.' });
        const r = await updater.apply();
        json(res, 200, r);
        if (r.status === 'updated') restart();
        return;
      }
      // name a voice once ("Speaker 2" -> "Haider"); the transcript follows
      if (req.method === 'POST' && (m = /^\/api\/rename\/([\w-]+)$/.exec(p))) {
        const dir = recDir(m[1]);
        if (!dir || !fs.existsSync(path.join(dir, 'speakers.json'))) return json(res, 404, { error: 'This recording has no speakers to name.' });
        const body = await readBody(req);
        try {
          diarize.rename(dir, String(body.from || ''), String(body.to || ''));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
        const src = ['whisper.json', 'whisper.srt', 'whisper.vtt'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
        if (src) writeTranscript(dir, src);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/transcribe-cancel') {
        if (!job || !job.active) return json(res, 409, { error: 'Nothing is being transcribed.' });
        job.cancel();
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  // nothing is recording, transcribing, making a voice-over or downloading
  const idle = () => !(current && current.active) && !(job && job.active) && !(voiceJob && voiceJob.active) && !local.size && !whisperSetup.active && !voiceSetup.active && !voiceExtra.active;
  // the launcher starts the app again when it ends with RESTART_CODE (and installs any new parts first)
  const restart = () => setTimeout(() => process.exit(RESTART_CODE), 1500);
  if (autoUpdate) updater.auto({ isIdle: idle, onUpdated: restart });

  server.getCurrent = () => current;
  server.getJob = () => job;
  server.getVoiceJob = () => voiceJob;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4777);
  const server = createServer({ autoUpdate: true });
  server.listen(port, '127.0.0.1', () => {
    const link = `http://localhost:${port}`;
    console.log(`Meet Recorder control panel: ${link}\n(keep this window open; Ctrl+C to quit)`);
    if (!process.argv.includes('--no-open')) {
      if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', link], { detached: true, stdio: 'ignore' }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [link], { detached: true, stdio: 'ignore' }).unref();
    }
  });
  process.on('SIGINT', async () => {
    const tx = server.getJob();
    if (tx && tx.active) tx.cancel();
    const cur = server.getCurrent();
    if (cur && cur.active) {
      console.log('Stopping the bot and saving files first...');
      cur.stop('control panel closed');
      await new Promise((r) => {
        const t = setInterval(() => !cur.active && (clearInterval(t), r()), 300);
      });
    }
    process.exit(0);
  });
}

module.exports = { createServer };
