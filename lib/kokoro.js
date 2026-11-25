// Voice-over with Kokoro, in Node (no Python): finds the model files, makes the voice-over (lib/tts.js, run in a
// worker thread), encodes the result. Works with model files already on the computer (another project's Kokoro
// install counts), and can download them (about 354 MB) into ./models/kokoro when they are missing.
// Override: KOKORO_MODELS=<folder with kokoro-v1.0.onnx and voices-v1.0.bin>.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const ffmpeg = require('ffmpeg-static');
const { Download: FileDownload } = require('./download');
const g2p = require('./g2p');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(__dirname, 'tts-worker.js');
const PRESETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'voice', 'presets.json'), 'utf8'));
const { models } = require('./paths');
const OWN_MODELS = models('kokoro');
const CACHE = models('kokoro-cache');

const siblings = () => {
  try {
    const parent = path.dirname(ROOT);
    return fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory() && path.join(parent, d.name) !== ROOT).map((d) => path.join(parent, d.name));
  } catch {
    return [];
  }
};

const FILES = PRESETS.model.files;
const complete = (dir) => FILES.every((f) => {
  try { return fs.statSync(path.join(dir, f.name)).size === f.bytes; } catch { return false; }
});
function findModelDir() {
  const dirs = [process.env.KOKORO_MODELS, OWN_MODELS, path.join(os.homedir(), '.cache', 'meet-recorder', 'kokoro'), ...siblings().map((s) => path.join(s, 'kokoro', 'models'))].filter(Boolean);
  return dirs.find(complete) || null;
}

// The engine is onnxruntime-node, installed with the app (npm install); it is only missing if that install failed.
function engineVersion() {
  try {
    require('onnxruntime-node');
    return require('onnxruntime-node/package.json').version;
  } catch {
    return null;
  }
}

let cached = null;
async function detect({ refresh = false } = {}) {
  if (cached && !refresh) return cached;
  const version = engineVersion();
  const r = { available: false, engine: !!version, version, modelDir: findModelDir(), reason: '', needs: [] };
  if (!r.engine) r.needs.push('engine');
  if (!r.modelDir) r.needs.push('model');
  r.available = !r.needs.length;
  if (!r.engine) r.reason = 'The voice engine is missing. Install ICAIRE Echo again from its installer.';
  else if (!r.modelDir) r.reason = 'The voices are not downloaded yet.';
  cached = r;
  return r;
}

// ---------- settings ----------
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}
// The full settings for a preset, with any changes the user made on top.
function settingsFor(presetId, changes) {
  const preset = PRESETS.presets.find((p) => p.id === presetId) || PRESETS.presets[0];
  return merge(merge(PRESETS.defaults, preset.settings), changes || {});
}

// ---------- download ----------
class Download extends FileDownload {
  constructor() {
    super('voices');
    this.total = FILES.reduce((a, f) => a + f.bytes, 0);
  }
  async run() {
    const status = await super.run(FILES, OWN_MODELS);
    cached = null;
    return status;
  }
}

// ---------- making a voice-over ----------
function encode(raw, outDir, exp) {
  const af = ['highpass=f=' + Number(exp.highpass || 0)].filter(() => Number(exp.highpass) > 0);
  if (exp.loudnorm) af.push(`loudnorm=I=${Number(exp.I)}:TP=${Number(exp.TP)}:LRA=${Number(exp.LRA)}`);
  const base = ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, ...(af.length ? ['-af', af.join(',')] : []), '-ar', '24000', '-ac', '1'];
  const fmt = ['mp3', 'm4a', 'wav'].includes(exp.format) ? exp.format : 'mp3';
  const jobs = [[...base, '-c:a', 'pcm_s16le', path.join(outDir, 'voice.wav')]];
  if (fmt === 'mp3') jobs.push([...base, '-c:a', 'libmp3lame', '-b:a', '192k', path.join(outDir, 'voice.mp3')]);
  if (fmt === 'm4a') jobs.push([...base, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(outDir, 'voice.m4a')]);
  return jobs.reduce(
    (p, args) =>
      p.then(
        () =>
          new Promise((resolve, reject) => {
            const c = spawn(ffmpeg, args, { windowsHide: true });
            let err = '';
            c.stderr.on('data', (d) => (err += d));
            c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Encoding failed: ' + err.trim().split('\n').pop()))));
            c.on('error', reject);
          })
      ),
    Promise.resolve()
  );
}

// Expressive keeps its models loaded between voice-overs (loading them takes about 8 s): one worker that stays for
// 10 minutes after its last job, then lets them go. It runs one job at a time; a cancelled job finishes its line
// before the next one starts.
const WARM_IDLE_MS = 10 * 60 * 1000;
let warm = null; // { worker, handler, free: Promise, release() }
function warmWorker() {
  if (warm) {
    clearTimeout(warm.timer);
    return warm;
  }
  const worker = new Worker(WORKER, { workerData: { warm: true } });
  worker.unref(); // never keeps the app (or a test) running on its own
  const w = { worker, handler: null, free: Promise.resolve() };
  worker.on('message', (m) => w.handler && w.handler.message(m));
  worker.on('error', (e) => w.handler && w.handler.error(e));
  worker.on('exit', (code) => {
    if (warm === w) warm = null;
    if (w.handler) w.handler.exit(code);
  });
  warm = w;
  return w;
}
function rest(w) {
  if (warm !== w) return;
  clearTimeout(w.timer);
  w.timer = setTimeout(() => {
    if (warm === w && !w.handler) {
      warm = null;
      w.worker.postMessage({ type: 'quit' });
    }
  }, WARM_IDLE_MS);
  if (w.timer.unref) w.timer.unref();
}

// let the models go now (the server closing): a job still running finishes its line first
function releaseWarm() {
  const w = warm;
  if (!w) return;
  warm = null;
  clearTimeout(w.timer);
  try { w.worker.postMessage({ type: 'quit' }); } catch {}
}

// One voice-over. Emits 'update' with snapshot().
class VoiceJob extends EventEmitter {
  constructor({ id, text, preset, settings, outDir, modelDir, sample = false }) {
    super();
    Object.assign(this, { id, text, preset, settings, outDir, modelDir, sample });
    this.status = 'loading'; // loading -> running -> encoding -> done | error | cancelled
    this.done = 0;
    this.total = 0;
    this.error = null;
    this.result = null;
    this.startedAt = Date.now();
  }
  get active() {
    return ['loading', 'running', 'encoding'].includes(this.status);
  }
  snapshot() {
    let etaSec = null;
    if (this.status === 'running' && this.done > 0 && this.firstAt) {
      const per = (Date.now() - this.firstAt) / Math.max(1, this.done - 1 || 1);
      etaSec = Math.round((per * (this.total - this.done)) / 1000);
    }
    return {
      id: this.id,
      sample: this.sample,
      status: this.status,
      done: this.done,
      total: this.total,
      percent: this.status === 'done' ? 100 : this.total ? Math.round((this.done / this.total) * 1000) / 10 : 0,
      etaSec,
      preset: this.preset,
      error: this.error,
      result: this.result,
    };
  }
  set(f) {
    Object.assign(this, f);
    this.emit('update', this.snapshot());
  }
  run() {
    fs.mkdirSync(this.outDir, { recursive: true });
    const raw = path.join(this.outDir, 'raw.wav');
    if (!this.sample) {
      fs.writeFileSync(path.join(this.outDir, 'script.txt'), this.text);
      fs.writeFileSync(path.join(this.outDir, 'settings.json'), JSON.stringify({ preset: this.preset, settings: this.settings }, null, 2));
    }
    const job = { text: this.text, settings: this.settings, out: raw, modelDir: this.modelDir, cacheDir: CACHE, languages: PRESETS.languages, voices: PRESETS.voices };
    return new Promise((resolve) => {
      let finished = null;
      const onMessage = (m) => {
        if (this.status === 'cancelled') return;
        if (m.type === 'start') this.set({ status: 'running', total: m.total, lang: m.lang });
        else if (m.type === 'progress') {
          if (!this.firstAt) this.firstAt = Date.now();
          this.set({ done: m.done, total: m.total });
        } else if (m.type === 'done') finished = m;
        else if (m.type === 'error') this.error = m.error;
      };
      const end = async (code) => {
        this.worker = null;
        if (this.status === 'cancelled') return resolve(this);
        if (!finished || !fs.existsSync(raw)) {
          this.set({ status: 'error', error: this.error || `The voice engine stopped (code ${code}).` });
          return resolve(this);
        }
        this.set({ status: 'encoding', done: this.total });
        try {
          await encode(raw, this.outDir, this.settings.export || {});
          fs.unlinkSync(raw);
          if (!this.sample) fs.writeFileSync(path.join(this.outDir, 'lines.json'), JSON.stringify({ duration: finished.duration, lang: finished.lang, lines: finished.lines }, null, 2));
          const files = fs.readdirSync(this.outDir).filter((f) => /^voice\./.test(f));
          this.set({ status: 'done', result: { duration: finished.duration, files } });
        } catch (e) {
          this.set({ status: 'error', error: e.message });
        }
        resolve(this);
      };
      this.finish = () => resolve(this); // a cancelled job is over at once; its worker winds down on its own
      if (this.settings.engine === 'expressive') {
        // the warm worker: wait for a cancelled job before it to finish its line, then run this one
        let w;
        try {
          w = warmWorker();
        } catch (e) {
          this.set({ status: 'error', error: 'Could not start the voice engine: ' + e.message });
          return resolve(this);
        }
        const before = w.free;
        let freed;
        w.free = new Promise((r) => (freed = r));
        before.then(() => {
          if (this.status === 'cancelled') {
            freed();
            return resolve(this);
          }
          const detach = () => {
            w.handler = null;
            freed();
            rest(w);
          };
          w.handler = {
            message: (m) => {
              if (m.type === 'end') {
                detach();
                end(0);
              } else onMessage(m);
            },
            error: (e) => (this.error = this.error || e.message),
            exit: (code) => {
              w.handler = null;
              freed();
              end(code);
            },
          };
          this.worker = w.worker;
          w.worker.postMessage({ type: 'job', job });
        });
        return;
      }
      try {
        this.worker = new Worker(WORKER, { workerData: job });
      } catch (e) {
        this.set({ status: 'error', error: 'Could not start the voice engine: ' + e.message });
        return resolve(this);
      }
      this.worker.on('message', onMessage);
      this.worker.on('error', (e) => (this.error = this.error || e.message));
      this.worker.on('exit', end);
    });
  }
  cancel() {
    if (!this.active) return;
    this.set({ status: 'cancelled' });
    // never worker.terminate(): stopping onnxruntime mid-run aborts the process (see lib/tts-worker.js)
    try { this.worker && this.worker.postMessage({ type: 'cancel' }); } catch {}
    if (this.finish) this.finish();
  }
}

// ---------- Japanese and Chinese: an optional extra download ----------
// eSpeak reads them badly (Japanese kanji come out as "Chinese letter"). Kokoro's own pronunciation rules (misaki,
// ported in lib/g2p.js) read them properly, but need big dictionaries, so these are downloaded only when someone
// picks such a voice.
const EXTRA = g2p.EXTRA;
const extraFor = (lang) => Object.keys(EXTRA).find((k) => EXTRA[k].langs.includes(lang)) || null;
const hasExtra = (k) => g2p.hasExtra(k);
const extrasStatus = () => Object.fromEntries(Object.entries(EXTRA).map(([k, v]) => [k, { name: v.name, mb: v.mb, installed: hasExtra(k), langs: v.langs }]));

class ExtraInstall extends EventEmitter {
  constructor() {
    super();
    this.status = 'idle';
    this.key = null;
    this.step = '';
    this.error = null;
  }
  get active() {
    return this.status === 'running';
  }
  snapshot() {
    return { status: this.status, key: this.key, name: this.key && EXTRA[this.key].name, step: this.step, error: this.error };
  }
  set(f) {
    Object.assign(this, f);
    this.emit('update', this.snapshot());
  }
  async run(key) {
    this.abort = new AbortController();
    this.set({ status: 'running', key, step: 'Starting…', error: null });
    try {
      await g2p.install(key, { signal: this.abort.signal, onStep: (step) => this.set({ step }) });
      this.set({ status: 'done', step: '' });
    } catch (e) {
      if (this.status === 'cancelled') return;
      this.set({ status: 'error', error: e.message + ' Check the internet connection and try again.' });
    }
  }
  cancel() {
    if (!this.active) return;
    this.set({ status: 'cancelled' });
    try { this.abort.abort(); } catch {}
  }
}

const sampleKey = (settings, text) => crypto.createHash('sha1').update(JSON.stringify([settings, text])).digest('hex').slice(0, 16);

module.exports = { releaseWarm, detect, settingsFor, merge, Download, VoiceJob, ExtraInstall, extraFor, hasExtra, extrasStatus, EXTRA, PRESETS, CACHE, OWN_MODELS, sampleKey, findModelDir };
