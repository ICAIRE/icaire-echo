// The Kokoro v1.0 voice model, run with onnxruntime-node: a port of kokoro-onnx 0.6.1 (MIT), the Python package
// the app used before, so the same text gives the same sound. Ported: Kokoro.create() with its tokenizer,
// phoneme batching (chunker.py), silence trimming (trim.py, librosa's trim) and the pause after each batch.
// The v1.0 model reports no phoneme durations, so kokoro-onnx's timed pauses (pauses.py) and its "continuous"
// mode never run with it; they are not ported.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const espeak = require('./espeak');

const SAMPLE_RATE = 24000;
const MAX_PHONEME_LENGTH = 510;
const VOCAB = require('../voice/vocab.json').vocab;
const cp = (s) => Array.from(s); // Python counts characters (code points), not UTF-16 units

// ---------- voices-v1.0.bin: a numpy .npz (a zip of .npy arrays) ----------
function readNpz(file) {
  const b = fs.readFileSync(file);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${path.basename(file)} is not a voices file`);
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < count; k++) {
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    let data = b.subarray(start, start + csize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error(`${name}: unsupported compression`);
    out[name.replace(/\.npy$/, '')] = readNpy(data, name);
  }
  return out;
}

function readNpy(buf, name) {
  if (buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY') throw new Error(`${name} is not a numpy array`);
  const major = buf[6];
  const hlen = major >= 2 ? buf.readUInt32LE(8) : buf.readUInt16LE(8);
  const hstart = major >= 2 ? 12 : 10;
  const header = buf.toString('latin1', hstart, hstart + hlen);
  if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error(`${name}: expected little-endian float32`);
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const off = hstart + hlen;
  const n = shape.reduce((a, x) => a * x, 1);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = buf.readFloatLE(off + i * 4);
  return { shape, data };
}

// ---------- chunker.py ----------
const SENTENCE_MARKS = '.!?…';
const CLAUSE_MARKS = ',;:';
const BOUNDARIES = [/(?<=[.!?…])\s+/u, /(?<=[,;:])\s+/u, /\s+/u];

function* atoms(ph, max, level = 0) {
  if (cp(ph).length <= max) {
    if (ph) yield ph;
    return;
  }
  for (let i = level; i < BOUNDARIES.length; i++) {
    const pieces = ph.split(BOUNDARIES[i]);
    if (pieces.length > 1) {
      for (const piece of pieces) yield* atoms(piece.trim(), max, i + 1);
      return;
    }
  }
  const chars = cp(ph);
  for (let s = 0; s < chars.length; s += max) yield chars.slice(s, s + max).join('');
}

function pack(lengths, limit) {
  const batches = [];
  let start = 0;
  let size = 0;
  lengths.forEach((len, i) => {
    const cand = i === start ? len : size + 1 + len;
    if (cand > limit && i > start) {
      batches.push([start, i]);
      start = i;
      size = len;
    } else size = cand;
  });
  if (lengths.length) batches.push([start, lengths.length]);
  return batches;
}

function splitPhonemes(ph, max = MAX_PHONEME_LENGTH) {
  const a = [...atoms(ph.trim(), max)];
  if (!a.length) return [];
  const lengths = a.map((x) => cp(x).length);
  const fewest = pack(lengths, max).length;
  let low = Math.max(...lengths);
  let high = max;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (pack(lengths, mid).length <= fewest) high = mid;
    else low = mid + 1;
  }
  return pack(lengths, low).map(([s, e]) => a.slice(s, e).join(' '));
}

function pauseAfter(ph, sentence, clause) {
  const chars = cp(ph.trimEnd());
  const mark = chars[chars.length - 1] || '';
  if (mark && SENTENCE_MARKS.includes(mark)) return sentence;
  if (mark && CLAUSE_MARKS.includes(mark)) return clause;
  return 0;
}

// ---------- trim.py: librosa.effects.trim(y, top_db=60, frame_length=2048, hop_length=512) ----------
function trim(y, topDb = 60, frame = 2048, hop = 512) {
  const pad = frame >> 1;
  const nFrames = 1 + Math.floor((y.length + 2 * pad - frame) / hop);
  const rms = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let s = 0;
    for (let k = 0; k < frame; k++) {
      const i = f * hop + k - pad;
      if (i >= 0 && i < y.length) s += y[i] * y[i];
    }
    rms[f] = Math.sqrt(s / frame);
  }
  let ref = 0;
  for (const r of rms) if (r > ref) ref = r;
  const db = (x) => 10 * Math.log10(Math.max(1e-10, x * x));
  const refDb = db(ref);
  let first = -1;
  let last = -1;
  for (let f = 0; f < nFrames; f++) {
    if (db(rms[f]) - refDb > -topDb) {
      if (first < 0) first = f;
      last = f;
    }
  }
  if (first < 0) return { audio: y.subarray(0, 0), start: 0, end: 0 };
  const start = first * hop;
  const end = Math.min(y.length, (last + 1) * hop);
  return { audio: y.subarray(start, end), start, end };
}

// ---------- the model ----------
class Kokoro {
  constructor(session, voices) {
    this.sess = session;
    this.voices = voices;
  }

  static async load(modelDir) {
    const ort = require('onnxruntime-node');
    const session = await ort.InferenceSession.create(path.join(modelDir, 'kokoro-v1.0.onnx'), { executionProviders: ['cpu'] });
    return new Kokoro(session, readNpz(path.join(modelDir, 'voices-v1.0.bin')));
  }

  getVoices() {
    return Object.keys(this.voices).sort();
  }

  getVoiceStyle(name) {
    const v = this.voices[name];
    if (!v) throw new Error(`Voice ${name} not found in available voices`);
    return v;
  }

  // Tokenizer.phonemize: eSpeak's sounds, only those the model knows, stripped
  async phonemize(text, lang = 'en-us') {
    const ph = await espeak.phonemize(text.trim(), lang);
    return cp(ph).filter((c) => c in VOCAB).join('').trim();
  }

  tokenize(ph) {
    if (cp(ph).length > MAX_PHONEME_LENGTH) throw new Error(`text is too long, must be less than ${MAX_PHONEME_LENGTH} phonemes`);
    return cp(ph).map((c) => VOCAB[c]).filter((i) => i !== undefined);
  }

  async infer(tokens, voice, speed) {
    const ort = require('onnxruntime-node');
    const rows = voice.shape[0];
    const width = voice.data.length / rows; // 1 x 256
    const row = Math.min(tokens.length, rows) - 1; // one style per phoneme count
    const style = voice.data.slice(row * width, (row + 1) * width);
    const ids = BigInt64Array.from([0, ...tokens, 0].map(BigInt));
    const out = await this.sess.run({
      tokens: new ort.Tensor('int64', ids, [1, ids.length]),
      style: new ort.Tensor('float32', style, [1, width]),
      speed: new ort.Tensor('float32', Float32Array.from([speed]), [1]),
    });
    return out[this.sess.outputNames[0]].data;
  }

  // Kokoro.create(): audio (Float32Array, 24 kHz) for text, or for phonemes with isPhonemes
  async create(text, { voice, speed = 1.0, lang = 'en-us', isPhonemes = false, trim: doTrim = true, sentencePause = 0.25, clausePause = 0.1, continuous = false } = {}) {
    if (!(speed >= 0.5 && speed <= 2.0)) throw new Error(`Speed should be between 0.5 and 2.0, got ${speed}`);
    const style = typeof voice === 'string' ? this.getVoiceStyle(voice) : voice;
    let ph = isPhonemes ? text : await this.phonemize(text, lang);
    ph = ph.split(/\s+/u).filter(Boolean).join(' ');
    const batches = splitPhonemes(ph);
    if (!batches.length) throw new Error(`Nothing to synthesize, ${JSON.stringify(text)} produced no phonemes`);
    if (continuous) throw new Error('continuous synthesis needs a model that reports durations, export one with scripts/export.py');
    const parts = [];
    for (let i = 0; i < batches.length; i++) {
      const tokens = this.tokenize(batches[i]);
      if (!tokens.length) throw new Error(`No phonemes of ${JSON.stringify(batches[i])} are in the model vocabulary`);
      let audio = await this.infer(tokens, style, speed);
      if (doTrim) {
        audio = trim(audio).audio;
        const pause = i < batches.length - 1 ? pauseAfter(batches[i], sentencePause, clausePause) : 0;
        if (pause) {
          const withPause = new Float32Array(audio.length + Math.trunc(pause * SAMPLE_RATE));
          withPause.set(audio);
          audio = withPause;
        }
      }
      parts.push(audio);
    }
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

module.exports = { Kokoro, SAMPLE_RATE, splitPhonemes, pauseAfter, trim, readNpz };
