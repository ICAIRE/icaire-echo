// Expressive voice-overs: Chatterbox by Resemble AI (MIT), two ONNX models run on this computer with onnxruntime.
//   Turbo (English, about 560 MB): real sounds ([laugh] [sigh] [gasp] ...) and moods ([angry] [whispering] ...)
//     written straight into the text it reads.
//   Multilingual (23 languages, Arabic among them, about 1 GB more): moods through "exaggeration", the intensity.
// Both copy a voice from a few seconds of someone speaking (the reference). The generation loops are ports of the
// model cards' Python (greedy decoding with a repetition penalty of 1.2), checked against Whisper: the words come out
// right in English and Arabic.
//
// onnxruntime-node 1.31 turns half-float outputs into Float16Array when Node has one (Node 24 does), and its native
// side then refuses them as inputs. Without Float16Array it keeps them as raw 16-bit words, which it accepts. The
// thread that loads this module must remove it BEFORE onnxruntime-node is first loaded (lib/tts-worker.js does).
const fs = require('fs');
const path = require('path');
const { Download: FileDownload } = require('./download');
const { models, ROOT } = require('./paths');

const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'voice', 'expressive.json'), 'utf8'));
const DIR = models('chatterbox');
const VOICES = path.join(DIR, 'voices');
const SR = 24000;
const START = 6561n;
const STOP = 6562n;
const SILENCE = 4299n; // the silence token: three of them close the decoder's input
const KV_HEADS = 16;
const HEAD_DIM = 64;

const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return -1; } };
const installed = () => CFG.files.every((f) => sizeOf(path.join(DIR, f.name)) === f.bytes);
const downloadBytes = () => CFG.files.reduce((a, f) => a + f.bytes, 0);
const missingBytes = () => CFG.files.reduce((a, f) => a + (sizeOf(path.join(DIR, f.name)) === f.bytes ? 0 : f.bytes), 0);

class Download extends FileDownload {
  constructor() {
    super('Expressive voices');
    this.total = downloadBytes();
  }
  run() {
    return super.run(CFG.files, DIR);
  }
}

// ---------- tensors ----------
let ort = null;
const T = (type, data, dims) => new ort.Tensor(type, data, dims);
const raw = (t) => (t.type === 'float16' && !(t.data instanceof Uint16Array) ? T('float16', new Uint16Array(t.data.buffer, t.data.byteOffset, t.data.length), t.dims) : t);
function half(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
const floats = (t) => (t.type === 'float16' ? Float32Array.from(t.data, half) : Float32Array.from(t.data, Number));

function resample(x, from, to) {
  if (from === to) return x;
  const n = Math.round((x.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i * from) / to;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? x[j] ?? 0) * f;
  }
  return out;
}

// the original's punc_norm: a capital first letter, no odd punctuation, and an ending stop
function tidy(text) {
  let t = String(text).replace(/\s+/gu, ' ').trim();
  if (!t) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t
    .replace(/\.\.\.|…/gu, ', ')
    .replace(/[:;]/gu, ',')
    .replace(/ - /gu, ', ')
    .replace(/[—–]/gu, '-')
    .replace(/ ,/gu, ',')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
  if (!/[.!?\-,،؟。！？]$/u.test(t.replace(/\[[^\]]*\]$/u, '').trim())) t += '.';
  return t;
}

// ---------- the two models ----------
class Model {
  constructor(kind) {
    this.kind = kind; // 'turbo' | 'multilingual'
    this.dir = path.join(DIR, kind);
    this.conds = new Map();
  }
  async load() {
    if (this.lm) return this;
    if (!ort) ort = require('onnxruntime-node');
    const { Tokenizer } = require('@huggingface/tokenizers');
    const v = this.kind === 'turbo' ? '_q4f16' : '';
    const opt = { graphOptimizationLevel: 'all', intraOpNumThreads: Math.max(2, Math.min(8, require('os').cpus().length - 1)) };
    const open = (n) => ort.InferenceSession.create(path.join(this.dir, `${n}.onnx`), opt);
    // both read their speech tokens with Turbo's audio decoder: Multilingual's own takes 45 s to load and sounds the same
    const decoder = ort.InferenceSession.create(path.join(DIR, 'turbo', 'conditional_decoder_q4f16.onnx'), opt);
    [this.enc, this.emb, this.lm, this.dec] = await Promise.all([open(`speech_encoder${v}`), open(`embed_tokens${v}`), open('language_model_q4f16'), decoder]);
    const read = (f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
    this.tok = new Tokenizer(read('tokenizer.json'), read('tokenizer_config.json'));
    this.kvNames = this.lm.inputNames.filter((n) => n.includes('past_key_values'));
    const meta = this.lm.inputMetadata && this.lm.inputMetadata.find ? this.lm.inputMetadata.find((m) => m.name === this.kvNames[0]) : null;
    this.kvType = meta && meta.type === 'float16' ? 'float16' : 'float32';
    this.lmTakesPositions = this.lm.inputNames.includes('position_ids');
    return this;
  }
  async release() {
    for (const s of [this.enc, this.emb, this.lm, this.dec]) try { s && (await s.release()); } catch {}
    this.enc = this.emb = this.lm = this.dec = null;
    this.conds.clear();
  }
  ids(text, lang) {
    if (this.kind === 'turbo') return this.tok.encode(text).ids.map(BigInt);
    // the template puts special tokens around the text that the JS tokenizer cannot look up: their ids are set here
    const e = this.tok.encode(`[${lang}]${text}`.toLowerCase().normalize('NFKD'));
    const ids = e.ids.map(BigInt);
    const SPECIAL = { EXAGGERATION: 6563n, BOS: 255n, EOS: 0n, START_SPEECH: 6561n };
    e.tokens.forEach((t, k) => {
      if (SPECIAL[t] !== undefined) ids[k] = SPECIAL[t];
    });
    return ids;
  }
  // the voice: worked out once per reference file
  async voice(refFile) {
    if (this.conds.has(refFile)) return this.conds.get(refFile);
    const wav = require('./wav');
    const r = wav.read(refFile);
    let audio = resample(r.samples, r.rate, SR);
    if (audio.length > SR * 12) audio = audio.subarray(0, SR * 12);
    const out = await this.enc.run({ audio_values: T('float32', Float32Array.from(audio), [1, audio.length]) });
    const [cond, prompt, spkEmb, spkFeat] = this.enc.outputNames.map((n) => out[n]);
    const v = { cond, prompt, spkEmb: raw(spkEmb), spkFeat: raw(spkFeat) };
    this.conds.set(refFile, v);
    return v;
  }
  async generate(ids, v, { exaggeration = 0.5, penalty = 1.2, maxTokens, isCancelled }) {
    const ex = T('float32', Float32Array.from([exaggeration]), [1]);
    const embIn = (input, pos) => {
      const f = { input_ids: input };
      if (this.emb.inputNames.includes('position_ids')) f.position_ids = pos;
      if (this.emb.inputNames.includes('exaggeration')) f.exaggeration = ex;
      return f;
    };
    let feed = embIn(T('int64', BigInt64Array.from(ids), [1, ids.length]), T('int64', BigInt64Array.from(ids, (id, k) => (id >= START ? 0n : BigInt(k - 1))), [1, ids.length]));
    const generated = [START];
    let past = null;
    let mask;
    let pos;
    for (let i = 0; i < maxTokens; i++) {
      if (isCancelled && isCancelled()) return null;
      let embeds = (await this.emb.run(feed))[this.emb.outputNames[0]];
      if (i === 0) {
        // the voice's conditioning goes before the text
        const D = embeds.dims[2];
        const total = v.cond.dims[1] + embeds.dims[1];
        const data = new embeds.data.constructor(total * D);
        data.set(v.cond.data, 0);
        data.set(embeds.data, v.cond.data.length);
        embeds = T(embeds.type, data, [1, total, D]);
        past = {};
        for (const n of this.kvNames) past[n] = T(this.kvType, this.kvType === 'float16' ? new Uint16Array(0) : new Float32Array(0), [1, KV_HEADS, 0, HEAD_DIM]);
        mask = new BigInt64Array(total).fill(1n);
        pos = BigInt64Array.from({ length: total }, (_, k) => BigInt(k));
      }
      const run = { inputs_embeds: raw(embeds), attention_mask: T('int64', mask, [1, mask.length]), ...past };
      if (this.lmTakesPositions) run.position_ids = T('int64', pos, [1, pos.length]);
      const res = await this.lm.run(run);
      const logits = res[this.lm.outputNames[0]];
      const V = logits.dims[2];
      const last = logits.data.subarray((logits.dims[1] - 1) * V, logits.dims[1] * V);
      const scores = logits.type === 'float16' ? Float32Array.from(last, half) : Float32Array.from(last, Number);
      for (const g of new Set(generated)) {
        const k = Number(g);
        scores[k] = scores[k] < 0 ? scores[k] * penalty : scores[k] / penalty;
      }
      let best = 0;
      for (let k = 1; k < V; k++) if (scores[k] > scores[best]) best = k;
      const next = BigInt(best);
      generated.push(next);
      if (next === STOP) return generated.slice(1, -1);
      feed = embIn(T('int64', BigInt64Array.from([next]), [1, 1]), T('int64', BigInt64Array.from([BigInt(i + 1)]), [1, 1]));
      mask = new BigInt64Array(mask.length + 1).fill(1n);
      pos = BigInt64Array.from([pos[pos.length - 1] + 1n]);
      this.lm.outputNames.slice(1).forEach((n, j) => (past[this.kvNames[j]] = raw(res[n])));
    }
    return undefined; // never stopped: the model is babbling
  }
  // one piece of text in this voice: 24 kHz samples
  async speak(text, { lang = 'en', refFile, exaggeration = 0.5, isCancelled } = {}) {
    await this.load();
    const v = await this.voice(refFile);
    const ids = this.ids(text, lang);
    // speech runs at 25 tokens a second, text at about two tokens a letter: far past that, it has lost its way
    const maxTokens = Math.min(1500, 80 + 4 * Array.from(text).length);
    let speech = await this.generate(ids, v, { exaggeration, maxTokens, isCancelled });
    if (speech === undefined) speech = await this.generate(ids, v, { exaggeration, penalty: 1.5, maxTokens, isCancelled });
    if (speech === null) return null;
    if (speech === undefined) throw new Error(`Expressive could not read this part: "${text.slice(0, 80)}". Try rewording it, or remove the tag in it.`);
    const tokens = BigInt64Array.from([...v.prompt.data, ...speech, SILENCE, SILENCE, SILENCE]);
    const d = await this.dec.run({ speech_tokens: T('int64', tokens, [1, tokens.length]), speaker_embeddings: v.spkEmb, speaker_features: v.spkFeat });
    return floats(d[this.dec.outputNames[0]]);
  }
}

const loaded = {};
const model = (kind) => (loaded[kind] = loaded[kind] || new Model(kind));
async function release() {
  for (const k of Object.keys(loaded)) {
    await loaded[k].release();
    delete loaded[k];
  }
}

// ---------- voices ----------
// Ready voices are Kokoro's (Heart, Michael...) reading a short passage, made once the first time they are used.
// Voices from a recording are kept in models/chatterbox/voices/own, with a small meta.json each.
const OWN = path.join(VOICES, 'own');
const readyFile = (id) => path.join(VOICES, 'ready', `${id}.wav`);
const defaultFile = () => path.join(DIR, 'multilingual', 'default_voice.wav');

function ownVoices() {
  let names = [];
  try { names = fs.readdirSync(OWN); } catch { return []; }
  return names
    .filter((n) => /^[\w-]+$/.test(n))
    .map((id) => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(OWN, id, 'meta.json'), 'utf8'));
        if (!fs.existsSync(path.join(OWN, id, 'voice.wav'))) return null;
        return { id, name: m.name, seconds: m.seconds, createdAt: m.createdAt, own: true };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function voices() {
  return [...CFG.readyVoices.map((v) => ({ id: v.id, name: v.name, about: v.about, own: false })), ...ownVoices()];
}

const findVoice = (want) => {
  const w = String(want || '').trim().toLowerCase();
  return voices().find((v) => v.id.toLowerCase() === w || String(v.name).toLowerCase() === w) || null;
};

// the reference recording for a voice; makeReady(kokoroId, file) makes a ready voice's when it is missing
async function referenceFor(voiceId, makeReady) {
  const v = findVoice(voiceId);
  if (!v) return null;
  if (v.own) return path.join(OWN, v.id, 'voice.wav');
  const f = readyFile(v.id);
  if (fs.existsSync(f)) return f;
  const ready = CFG.readyVoices.find((x) => x.id === v.id);
  if (makeReady && ready) {
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      await makeReady(ready.kokoro, f, CFG.referenceText);
      if (fs.existsSync(f)) return f;
    } catch {}
  }
  return defaultFile();
}

// a voice from a recording: any audio file ffmpeg reads, cut to 30 s, at least 5 s of it someone speaking
function addVoice({ input, name }) {
  const { spawnSync } = require('child_process');
  const ffmpeg = require('ffmpeg-static');
  const wav = require('./wav');
  const clean = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (!clean) throw new Error('Give the voice a name.');
  if (voices().some((v) => String(v.name).toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a voice called "${clean}".`);
  const id = 'own-' + Date.now().toString(36);
  const dir = path.join(OWN, id);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'voice.wav');
  // the quiet start and end are cut, the level evened out
  const af = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.2,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.3,areverse,loudnorm=I=-20:TP=-2';
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', '45', '-af', af, '-t', '30', '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_s16le', out], { windowsHide: true });
  const fail = (msg) => {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(msg);
  };
  if (r.status !== 0 || !fs.existsSync(out)) fail('That file could not be read as audio. Try a WAV, MP3 or M4A recording.');
  const w = wav.read(out);
  // speech, not just length: 20 ms frames above a low level
  const hop = Math.round(w.rate * 0.02);
  let voiced = 0;
  for (let i = 0; i + hop <= w.samples.length; i += hop) {
    let e = 0;
    for (let k = 0; k < hop; k++) e += w.samples[i + k] ** 2;
    if (e / hop > 1e-4) voiced++;
  }
  const seconds = w.samples.length / w.rate;
  if (voiced * 0.02 < 5) fail(`The recording has only ${Math.round(voiced * 0.02)} seconds of speech. Use 10 to 30 seconds of one person speaking clearly.`);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ name: clean, seconds: Math.round(seconds * 10) / 10, createdAt: new Date().toISOString(), consent: true }, null, 2));
  return { id, name: clean, seconds: Math.round(seconds * 10) / 10, own: true };
}

function removeVoice(id) {
  if (!/^own-[\w-]+$/.test(String(id))) throw new Error('Only voices made from a recording can be removed.');
  const dir = path.join(OWN, id);
  if (!fs.existsSync(dir)) throw new Error('There is no such voice.');
  fs.rmSync(dir, { recursive: true, force: true });
}

function status() {
  return {
    installed: installed(),
    downloadBytes: downloadBytes(),
    missingBytes: missingBytes(),
    languages: CFG.languages.map((l) => ({ ...l, sample: !!(CFG.samples && CFG.samples[l.code]) })),
    voices: voices(),
    defaults: CFG.defaults,
  };
}

module.exports = { CFG, DIR, SR, Download, installed, status, model, release, tidy, voices, findVoice, referenceFor, addVoice, removeVoice, downloadBytes };
