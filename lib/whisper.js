// Transcription on this computer with whisper.cpp (no Python). The program is `whisper-cli`: from Homebrew on a
// Mac (`brew install whisper-cpp`, done by "Start Meet Recorder"), or the official Windows build that the setup
// downloads into models/whisper/bin. Models are whisper.cpp's ggml files in models/whisper.
// Overrides: WHISPER_CPP=<path to whisper-cli>, WHISPER_MODEL=<path to a ggml model file>.
//
// How a recording is transcribed (the same plan the faster-whisper version used):
//   1. find the speech with the Silero VAD (lib/vad.js, identical to faster-whisper's);
//   2. cut it into clips at pauses, at 25 s, and where the speaker changes (speakers.json from the bot);
//   3. transcribe every clip on its own, so each gets its own language: in a mixed-language meeting a short
//      Arabic turn inside English speech is written in Arabic instead of being translated;
//   4. put the clips back on the recording's timeline, with word times for merge.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const wav = require('./wav');
const { speechTimestamps } = require('./vad');
const { Download } = require('./download');
const diarize = require('./diarize');

const ROOT = path.join(__dirname, '..');
const MODELS = path.join(ROOT, 'models', 'whisper');
const BIN = path.join(MODELS, 'bin');
const WIN = process.platform === 'win32';
const EXE = WIN ? 'whisper-cli.exe' : 'whisper-cli';

const run = (cmd, args, timeout = 30000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' }));
  });

// ---------- the program ----------
// The official Windows builds (release b5454 = whisper.cpp 1.9.5). The NVIDIA one is used when there is an NVIDIA card.
const WINDOWS_BUILDS = {
  cpu: { name: 'whisper-blas-bin-x64.zip', bytes: 21715607, sha256: 'b1158bd10edf92c9799149a6fc5d3e58da3f495241d6fb3423088130e88ffbf3', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-blas-bin-x64.zip' },
  cuda: { name: 'whisper-bin-win-cuda-12.4.0-x64.zip', bytes: 684913404, sha256: 'afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip' },
};

function findIn(dir, name, depth = 3) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  if (depth > 0) for (const e of entries) if (e.isDirectory()) { const f = findIn(path.join(dir, e.name), name, depth - 1); if (f) return f; }
  return null;
}

function engineCandidates() {
  const list = [process.env.WHISPER_CPP, findIn(BIN, EXE)];
  if (!WIN) list.push('/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli');
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) list.push(path.join(dir, EXE));
  return [...new Set(list.filter(Boolean))].filter((p) => fs.existsSync(p));
}

const findEngine = () => engineCandidates()[0] || null;

// Which build the Windows setup installed (cpu or cuda), written next to it.
function windowsBuild() {
  try { return JSON.parse(fs.readFileSync(path.join(BIN, 'build.json'), 'utf8')).build; } catch { return null; }
}

// ---------- models ----------
// large-v3 (about 3.1 GB) with an NVIDIA card; otherwise large-v3-turbo (about 1.6 GB), several times faster on a
// processor and on Macs, and nearly as accurate.
const DOWNLOADS = {
  'large-v3': { name: 'ggml-large-v3.bin', bytes: 3095033483, sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin' },
  'large-v3-turbo': { name: 'ggml-large-v3-turbo.bin', bytes: 1624555275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin' },
};
const STRENGTH = [
  [/large-v3(?!-turbo)/, 100],
  [/large-v2/, 90],
  [/large-v3-turbo|turbo/, 85],
  [/large/, 80],
  [/distil.*large/, 70],
  [/medium/, 60],
  [/small/, 40],
  [/base/, 20],
  [/tiny/, 10],
];
const strength = (name) => (STRENGTH.find(([re]) => re.test(name.toLowerCase())) || [null, 0])[1];

function findModels() {
  const dirs = [MODELS, path.join(os.homedir(), '.cache', 'whisper.cpp'), path.join(os.homedir(), '.cache', 'whisper')];
  const models = [];
  const seen = new Set();
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const m = /^ggml-(.+)\.bin$/.exec(f);
      if (!m || /silero|vad/i.test(f)) continue;
      const p = path.join(dir, f);
      if (seen.has(m[1])) continue;
      const known = Object.values(DOWNLOADS).find((d) => d.name === f);
      let bytes = 0;
      try { bytes = fs.statSync(p).size; } catch { continue; }
      if (known && bytes !== known.bytes) continue; // still downloading, or cut off
      seen.add(m[1]);
      models.push({ name: m[1], repo: 'ggerganov/whisper.cpp', path: p, bytes, strength: strength(m[1]) });
    }
  }
  const extra = process.env.WHISPER_MODEL;
  if (extra && fs.existsSync(extra)) models.unshift({ name: path.basename(extra).replace(/^ggml-|\.bin$/g, ''), repo: extra, path: extra, bytes: 0, strength: 1000 });
  return models.sort((a, b) => b.strength - a.strength || b.bytes - a.bytes);
}

// ---------- what this computer has ----------
let cached = null;
async function detect({ refresh = false } = {}) {
  if (cached && !refresh) return cached;
  const result = { available: false, engine: null, version: null, device: 'cpu', gpu: null, models: [], reason: '', canInstall: WIN };
  result.engine = findEngine();
  if (result.engine) {
    const real = (() => { try { return fs.realpathSync(result.engine); } catch { return result.engine; } })();
    const v = /whisper\.cpp[\\/](\d+\.\d+\.\d+)/.exec(real);
    result.version = v ? v[1] : windowsBuild() ? '1.9.5' : null;
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      result.device = 'metal';
      const g = await run('sysctl', ['-n', 'machdep.cpu.brand_string'], 5000);
      result.gpu = (g.ok && g.stdout.trim()) || 'the graphics chip';
    } else if (WIN ? windowsBuild() === 'cuda' : true) {
      const g = await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], 10000);
      if (g.ok && g.stdout.trim()) {
        result.device = 'cuda';
        result.gpu = g.stdout.trim().split('\n')[0].replace(/^NVIDIA\s+/, '') || null;
      }
    }
  } else if (WIN) {
    const g = await run('nvidia-smi', ['-L'], 10000);
    if (g.ok && g.stdout.trim()) result.device = 'cuda';
  }
  result.models = findModels();
  if (!result.engine) result.reason = WIN ? 'The transcriber is not installed yet. Run the setup (Start Meet Recorder) once.' : 'The transcriber is not installed yet. Open the app with "Start Meet Recorder" once (it installs whisper-cpp with Homebrew), or set WHISPER_CPP.';
  else if (!result.models.length) result.reason = 'The transcriber is installed but its model is not downloaded yet.';
  result.available = !!result.engine && result.models.length > 0;
  cached = result;
  return result;
}

// ---------- cutting the speech into clips ----------
const INDICATOR_LAG = 0.3; // Meet's speaking indicator lights up ~0.3 s after the voice starts
const MIN_CLIP = 1.0; // don't make clips shorter than this; Whisper does badly on fragments
const r2 = (x) => Math.round(x * 100) / 100;

function loadTurns(file) {
  if (!file || !fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
      .segments.map((s) => [Number(s.start), Number(s.end), s.pid || s.speaker])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  } catch {
    return []; // a broken timeline just means no extra cuts
  }
}

// [[start_s, end_s]]: speech found by VAD, split at pauses, at 25 s, and where a new speaker starts.
async function speechClips(audio, turns, sr = 16000) {
  const chunks = await speechTimestamps(audio, { minSilenceDurationMs: 500, maxSpeechDurationS: 25 }, sr);
  const starts = [];
  let prev = null;
  for (const [s, , who] of turns) {
    if (who !== prev) starts.push(Math.max(0, s - INDICATOR_LAG));
    prev = who;
  }
  const clips = [];
  for (const c of chunks) {
    let a = c.start / sr;
    const b = c.end / sr;
    for (const t of starts.filter((x) => a + MIN_CLIP <= x && x <= b - MIN_CLIP)) {
      if (t - a >= MIN_CLIP) {
        clips.push([r2(a), r2(t)]);
        a = t;
      }
    }
    clips.push([r2(a), r2(b)]);
  }
  return clips;
}

// ---------- reading whisper-cli's JSON ----------
// whisper-cli writes each token's raw bytes, so a letter split over two tokens is not valid UTF-8 on its own.
// The file is read byte for byte (latin1) and the bytes are put back together into letters here.
const bytesOf = (s) => Buffer.from(s, 'latin1');
const textOf = (s) => bytesOf(s).toString('utf8');
const NO_SPACES = new Set(['zh', 'ja', 'th', 'lo', 'km', 'my', 'yue']);
const PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
const PREPEND = '"\'“¿([{-';
const APPEND = '"\'.。,，!！?？:：”)]}、';

// words [{start, end, word, probability}] of one segment, the way faster-whisper groups tokens into words
function wordsOf(tokens, offset, language) {
  const text = tokens.filter((t) => t.id < 50257 && !String(t.text).startsWith('[_')); // no [_BEG_], [_TT_n], ...
  // tokens -> whole letters
  const units = [];
  let bytes = [];
  let group = [];
  for (const t of text) {
    bytes.push(bytesOf(t.text));
    group.push(t);
    const s = Buffer.concat(bytes).toString('utf8');
    if (!s.includes('�')) {
      units.push({ text: s, tokens: group });
      bytes = [];
      group = [];
    }
  }
  // letters -> words, each with the times and mean probability of its own tokens
  const words = [];
  for (const u of units) {
    if (NO_SPACES.has(language) || !words.length || u.text.startsWith(' ') || PUNCT.has(u.text.trim())) words.push({ word: u.text, tokens: [...u.tokens] });
    else {
      const w = words[words.length - 1];
      w.word += u.text;
      w.tokens.push(...u.tokens);
    }
  }
  // With DTW (attention alignment, as faster-whisper), t_dtw is when a token ends: a word runs from the end of
  // the word before it to the end of its own last token. Without it, whisper.cpp's own token times are used.
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const first = w.tokens[0];
    const last = w.tokens[w.tokens.length - 1];
    const plainEnd = offset + last.offsets.to / 1000;
    w.end = r2(last.t_dtw >= 0 ? offset + last.t_dtw / 100 : plainEnd);
    w.start = r2(i > 0 && last.t_dtw >= 0 ? words[i - 1].end : offset + first.offsets.from / 1000);
    if (w.start > w.end) w.start = w.end;
    w.probability = r2(w.tokens.reduce((a, t) => a + t.p, 0) / w.tokens.length);
  }
  // punctuation joins the word next to it, which keeps its own times (faster-whisper's merge_punctuations)
  for (let i = words.length - 2, j = words.length - 1; i >= 0; i--) {
    if (words[i].word.startsWith(' ') && PREPEND.includes(words[i].word.trim())) {
      words[j].word = words[i].word + words[j].word;
      words[i].word = '';
    } else j = i;
  }
  for (let i = 0, j = 1; j < words.length; j++) {
    if (!words[i].word.endsWith(' ') && APPEND.includes(words[j].word)) {
      words[i].word += words[j].word;
      words[j].word = '';
    } else i = j;
  }
  return words.filter((w) => w.word).map(({ start, end, word, probability }) => ({ start, end, word, probability }));
}

function readClip(file, [a, b]) {
  const j = JSON.parse(fs.readFileSync(file, 'latin1'));
  const language = (j.result && j.result.language) || null;
  const segments = [];
  for (const s of j.transcription || []) {
    const text = textOf(s.text || '').trim();
    if (!text) continue;
    const words = wordsOf(s.tokens || [], a, language).map((w) => ({ ...w, start: Math.min(w.start, b), end: Math.min(w.end, b) }));
    segments.push({ start: r2(Math.min(b, a + s.offsets.from / 1000)), end: r2(Math.min(b, a + s.offsets.to / 1000)), text, words });
  }
  return { language, segments };
}

// ---------- one transcription job ----------
const BATCH = 400; // clips per run of whisper-cli (one model load each)

// whisper.cpp's name for a model's attention heads, for DTW word times ("large-v3-turbo-q5_0" -> "large.v3.turbo")
const DTW_PRESETS = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large.v1', 'large.v2', 'large.v3', 'large.v3.turbo'];
function dtwPreset(name) {
  const n = String(name || '').toLowerCase().replace(/-q\d.*$/, '').replace(/-/g, '.');
  return DTW_PRESETS.includes(n) ? n : null;
}

class TranscribeJob extends EventEmitter {
  constructor({ id, audio, out, engine, model, language, device, separate = false, people = null }) {
    super();
    Object.assign(this, { id, audio, out, engine, model, language, separate, people });
    this.status = 'loading'; // loading -> [separating ->] running -> merging -> done | error | cancelled
    this.at = 0;
    this.duration = 0;
    this.device = device || null;
    this.error = null;
    this.startedAt = Date.now();
    this.runStartedAt = null;
    this.result = null;
    this.modelName = model && model.name;
  }

  get active() {
    return ['loading', 'separating', 'running', 'merging'].includes(this.status);
  }

  snapshot() {
    const pct = this.status === 'done' ? 100 : this.duration ? Math.min(99.9, (this.at / this.duration) * 100) : 0;
    let etaSec = null;
    if (this.status === 'running' && this.runStartedAt && this.at > 0) {
      const spent = (Date.now() - this.runStartedAt) / 1000;
      etaSec = Math.max(0, (spent / this.at) * (this.duration - this.at));
    }
    return {
      id: this.id,
      status: this.status,
      percent: Math.round(pct * 10) / 10,
      at: this.at,
      duration: this.duration,
      etaSec: etaSec == null ? null : Math.round(etaSec),
      device: this.device,
      model: this.modelName,
      elapsedSec: Math.round((Date.now() - this.startedAt) / 1000),
      error: this.error,
      note: this.note || null,
      result: this.result,
    };
  }

  set(fields) {
    Object.assign(this, fields);
    this.emit('update', this.snapshot());
  }

  // whisper-cli over some clip files; resolves once it has finished
  batch(names, clips, work) {
    // -mc 0: no text carried between windows (one language does not "stick" after a switch); -sns: no
    // non-speech tokens; DTW word times need flash attention off.
    const args = ['-m', this.model.path, '-l', this.language || 'auto', '-bs', '5', '-mc', '0', '-sns', '-ojf', '-np', '-t', String(Math.max(1, Math.min(8, os.cpus().length)))];
    const dtw = dtwPreset(this.model.name);
    if (dtw) args.push('-nfa', '-dtw', dtw);
    for (const n of names) args.push('-f', n);
    return new Promise((resolve) => {
      this.child = spawn(this.engine, args, { cwd: work, windowsHide: true });
      let stderr = '';
      let buf = '';
      this.child.stderr.on('data', (d) => {
        stderr = (stderr + d).slice(-6000);
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          const m = /saving output to '([^']+)\.json'/.exec(line);
          const k = m ? names.indexOf(path.basename(m[1])) : -1;
          if (k >= 0) {
            if (this.status === 'loading') this.set({ status: 'running', runStartedAt: this.runStartedAt || Date.now() });
            this.set({ at: Math.max(this.at, clips[k][1]) });
          }
        }
      });
      this.child.stdout.on('data', () => {});
      this.child.on('error', (e) => resolve({ code: -1, error: 'Could not start the transcriber: ' + e.message }));
      this.child.on('close', (code) => resolve({ code, stderr }));
    });
  }

  async run() {
    let work = null;
    try {
      const { samples, rate } = wav.read(this.audio);
      if (rate !== 16000) throw new Error(`expected 16 kHz audio, got ${rate} Hz`);
      this.set({ duration: r2(samples.length / 16000) });
      // no speaker log (Record, without the bot): tell the voices apart first, into speakers.json
      // if that fails (no models yet and no internet, say), the transcript is still written, without names
      if (this.separate) {
        this.set({ status: 'separating' });
        try {
          await diarize.ensureModels();
          if (this.status === 'cancelled') return this;
          await diarize.writeSpeakers(path.dirname(this.audio), samples, { numSpeakers: this.people || -1 });
        } catch (e) {
          this.note = 'The voices could not be told apart (' + e.message + '). The transcript has no speaker names.';
        }
        if (this.status === 'cancelled') return this;
        this.set({ status: 'loading' });
      }
      const clips = await speechClips(samples, loadTurns(path.join(path.dirname(this.audio), 'speakers.json')));
      if (this.status === 'cancelled') return this;
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-clips-'));
      const names = clips.map((c, i) => {
        const n = `c${String(i).padStart(5, '0')}.wav`;
        wav.write16(path.join(work, n), samples.subarray(Math.round(c[0] * 16000), Math.round(c[1] * 16000)), 16000);
        return n;
      });
      const parts = [];
      for (let i = 0; i < names.length; i += BATCH) {
        const r = await this.batch(names.slice(i, i + BATCH), clips.slice(i, i + BATCH), work);
        if (this.status === 'cancelled') return this;
        if (r.code !== 0) {
          const tail = (r.error || r.stderr || '').trim().split(/\r?\n/).filter((l) => /error|fail|unable|not/i.test(l)).slice(-2).join(' ');
          throw new Error(tail || `The transcriber stopped (code ${r.code}).`);
        }
        for (let k = i; k < Math.min(names.length, i + BATCH); k++) {
          const f = path.join(work, names[k] + '.json');
          if (fs.existsSync(f)) parts.push({ clip: clips[k], ...readClip(f, clips[k]) });
        }
      }
      // the meeting's language: the one spoken the longest
      const spoken = {};
      for (const p of parts) if (p.language && p.segments.length) spoken[p.language] = (spoken[p.language] || 0) + (p.clip[1] - p.clip[0]);
      const language = this.language || Object.entries(spoken).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null;
      const segments = parts.flatMap((p) => p.segments);
      const tmp = this.out + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ model: this.model.name, device: this.device, language, duration: this.duration, segments }, null, 1));
      fs.renameSync(tmp, this.out);
      this.set({ status: 'merging', at: this.duration });
    } catch (e) {
      if (this.status !== 'cancelled') this.set({ status: 'error', error: e.message });
    } finally {
      if (work) fs.rmSync(work, { recursive: true, force: true });
    }
    return this;
  }

  cancel() {
    if (!this.active) return;
    this.set({ status: 'cancelled' });
    try { this.child && this.child.kill(); } catch {}
  }
}

// ---------- first run on a new computer: download a Whisper model ----------
class ModelDownload extends Download {
  async run(gpu) {
    const name = gpu ? 'large-v3' : 'large-v3-turbo';
    const status = await super.run([DOWNLOADS[name]], MODELS, { label: name });
    cached = null;
    return status;
  }
}

// ---------- Windows: install the program (run by setup.js) ----------
async function installWindowsEngine({ cuda, onProgress } = {}) {
  const build = cuda ? 'cuda' : 'cpu';
  const d = new Download(build);
  if (onProgress) d.on('update', onProgress);
  const zipDir = path.join(MODELS, 'downloads');
  const status = await d.run([WINDOWS_BUILDS[build]], zipDir);
  if (status !== 'done') throw new Error(d.error || 'The download stopped.');
  const zip = path.join(zipDir, WINDOWS_BUILDS[build].name);
  fs.rmSync(BIN, { recursive: true, force: true });
  fs.mkdirSync(BIN, { recursive: true });
  // Windows 10 and later come with tar, which also opens zip files
  await new Promise((resolve, reject) => {
    const c = spawn('tar', ['-xf', zip, '-C', BIN], { windowsHide: true });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Could not unpack ' + path.basename(zip)))));
  });
  if (!findIn(BIN, EXE)) throw new Error(`${EXE} is not in ${path.basename(zip)}`);
  fs.writeFileSync(path.join(BIN, 'build.json'), JSON.stringify({ build, from: WINDOWS_BUILDS[build].url }));
  fs.rmSync(zip, { force: true });
  cached = null;
}

module.exports = { detect, findModels, findEngine, TranscribeJob, ModelDownload, DOWNLOADS, WINDOWS_BUILDS, installWindowsEngine, speechClips, wordsOf, readClip };
