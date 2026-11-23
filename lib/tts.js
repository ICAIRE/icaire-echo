// Voice-over with Kokoro: a script in, one sound out. A line-for-line port of the Python voice/tts.py, so its
// presets sound the same: the sound is made exactly as the Ideas City project made it (ideas-city-walkthrough):
//   * the presenter: src/walk_tts.py, src/walk_say.py (names put right as sounds), src/walk_music.py (music bed)
//   * the radio hosts: city-kits-demo/voice/radio.py (edge trim, close_gaps, breaths, rumble filter, room, level, peak)
// Every number those files hard-code is a setting here, with the same value by default (voice/presets.json).
// numpy's arithmetic is copied where it decides anything (float32 sums, percentile, random numbers: lib/npf.js,
// lib/np-random.js), and the per-line cache uses the Python version's file names, so its cached sound is reused.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wav = require('./wav');
const N = require('./npf');
const { defaultRng } = require('./np-random');
const { Kokoro, SAMPLE_RATE: SR } = require('./kokoro-engine');
const g2p = require('./g2p');

const f32 = Math.fround;

// ---------- Python's text forms, for the cache file names ----------
// repr() of a float: shortest round-trip digits, exponent below 1e-4 or from 1e16
function pyFloat(x) {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan';
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1);
  const a = Math.abs(x);
  if (a >= 1e-4 && a < 1e16) return String(x);
  const [m, e] = x.toExponential().split('e');
  const exp = Number(e);
  return `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
}
// a number as it was after a trip through JSON into Python: whole numbers were ints
const pyNum = (x) => (Number.isInteger(x) ? String(x) : pyFloat(x));
// json.dumps(obj, sort_keys=True)
function pyJson(v) {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return pyNum(v);
  if (typeof v === 'string') return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  return '{' + Object.keys(v).sort().map((k) => pyJson(k) + ': ' + pyJson(v[k])).join(', ') + '}';
}
// format(x, '.3f'), which rounds half to even on the exact binary value
function fixed3(x) {
  const s = x.toFixed(3);
  const t = x * 1000;
  if (Math.abs(t - Math.trunc(t)) === 0.5 && Number.isInteger(t * 2)) {
    const lo = Math.trunc(t);
    const even = lo % 2 === 0 ? lo : lo + Math.sign(t);
    return (even / 1000).toFixed(3);
  }
  return s;
}
// round(x, 2) for the line times
function round2(x) {
  const t = x * 100;
  if (Math.abs(t - Math.trunc(t)) === 0.5) {
    const lo = Math.trunc(t);
    return (lo % 2 === 0 ? lo : lo + Math.sign(t)) / 100;
  }
  return Number(x.toFixed(2));
}
const sha1 = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const replaceAll = (s, a, b) => s.split(a).join(b);
const cp = (s) => Array.from(s);

// ---------- names put right as sounds (src/walk_say.py) ----------
async function sounds(k, raws, text, lang, names) {
  let ph = await k.phonemize(text, lang);
  let changed = false;
  for (const [word, us, gb] of names) {
    if (!word || !text.includes(word)) continue;
    const key = word + '\u0000' + lang;
    if (!raws.has(key)) raws.set(key, (await k.phonemize(word, lang)).trim());
    const raw = raws.get(key);
    const want = lang === 'en-gb' ? gb : us;
    if (!want) continue;
    // inside a sentence the voice may weaken a stress or add a linking "r": try the plain form, then looser ones
    for (const cand of [raw, replaceAll(raw, 'ˈ', 'ˌ'), replaceAll(replaceAll(raw, 'ˈ', ''), 'ˌ', ''), raw.replace(/ɹ+$/u, '')]) {
      if (cand && ph.includes(cand)) {
        ph = replaceAll(ph, cand, want);
        changed = true;
        break;
      }
    }
  }
  return [ph, changed];
}

const keyOf = (text, lang, names) => names.filter(([w]) => w && text.includes(w)).map(([w, us, gb]) => `${w}=${lang === 'en-gb' ? gb : us}`).join('|');

// ---------- one sentence or line ----------
// the voice, or a blend of two: Kokoro keeps each voice as numbers, and a weighted average is a voice between
function styleOf(k, s) {
  const b = s.blend || {};
  if (!b.on || !b.voice) return [k.getVoiceStyle(s.voice), s.voice];
  const mix = Number(b.mix ?? 0.25);
  const name = voiceName(s);
  const A = k.getVoiceStyle(s.voice);
  const B = k.getVoiceStyle(b.voice);
  const wa = f32(1 - mix);
  const wb = f32(mix);
  const data = new Float32Array(A.data.length);
  for (let i = 0; i < data.length; i++) data[i] = f32(f32(A.data[i] * wa) + f32(B.data[i] * wb));
  return [{ shape: A.shape, data }, name];
}

// The cache file name of one piece: the Ideas City project's scheme, so its cache can be compared and reused.
function voiceName(s) {
  const b = s.blend || {};
  if (!b.on || !b.voice) return s.voice;
  const mix = Number(b.mix ?? 0.25);
  return `${s.voice}*${fixed3(1 - mix)}+${b.voice}*${fixed3(mix)}`;
}
function prepared(text, s, lang) {
  let t = text;
  for (const [a, b] of s.spellings || []) if (a) t = replaceAll(t, a, b);
  const names = lang === 'en-us' || lang === 'en-gb' ? (s.names || []).filter((n) => n.length >= 3) : [];
  return { t, names };
}
function cacheName(text, s, speed, lang) {
  const { t, names } = prepared(text, s, lang);
  const kk = s.kokoro || {};
  const plain = (kk.trim ?? true) && (kk.sentencePause ?? 0.25) === 0.25 && (kk.clausePause ?? 0.1) === 0.1 && !kk.continuous;
  const extra = plain ? '' : pyJson(kk);
  const misaki = lang === 'ja' || lang === 'cmn';
  return sha1(`${voiceName(s)}${pyFloat(speed)}${t}${keyOf(t, lang, names)}${extra}${lang === 'en-us' || lang === 'en-gb' ? '' : lang}${misaki ? 'misaki' : ''}`) + '.wav';
}

// speak one piece, cached like the Ideas City project
async function speak(ctx, text, s, speed, lang) {
  const { k, cache } = ctx;
  const { t, names } = prepared(text, s, lang);
  const [style] = styleOf(k, s);
  const kk = s.kokoro || {};
  const misaki = lang === 'ja' || lang === 'cmn';
  const f = path.join(cache, cacheName(text, s, speed, lang));
  if (!fs.existsSync(f)) {
    const opts = { voice: style, speed, lang, trim: kk.trim ?? true, sentencePause: kk.sentencePause ?? 0.25, clausePause: kk.clausePause ?? 0.1, continuous: kk.continuous ?? false };
    let ph = '';
    let changed = false;
    if (misaki) [ph, changed] = [await g2p.phonemes(t, lang), true];
    else if (names.length) [ph, changed] = await sounds(k, ctx.raws, t, lang, names);
    const a = changed ? await k.create(ph, { ...opts, isPhonemes: true }) : await k.create(t, opts);
    wav.write16(f, a, SR);
  }
  return wav.read(f).samples;
}

// only true silence is cut from the ends (radio.py speak)
function edges(a, e) {
  const th = f32(e.threshold);
  let first = -1;
  let last = -1;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > th) { if (first < 0) first = i; last = i; }
  if (first < 0) return a;
  const lo = Math.max(0, first - Math.trunc(e.before * SR));
  const out = a.slice(lo, Math.max(lo, Math.min(a.length, last + Math.trunc(e.after * SR))));
  const n = Math.trunc(e.fade * SR);
  if (n && out.length > 2 * n) {
    const up = N.linspace(0, 1, n);
    const down = N.linspace(1, 0, n);
    for (let i = 0; i < n; i++) out[i] = f32(out[i] * up[i]);
    for (let i = 0; i < n; i++) out[out.length - n + i] = f32(out[out.length - n + i] * down[i]);
  }
  return out;
}

// shorten the stops inside a line that people do not make when they talk (radio.py close_gaps)
function closeGaps(a, g) {
  const hop = Math.trunc(0.005 * SR);
  const n = Math.floor(a.length / hop);
  if (n < 4) return a;
  const rms = N.frameRms32(a, hop);
  const limit = f32(N.percentile32(rms, 95) * f32(0.045));
  const quiet = rms.map((r) => (r < limit ? 1 : 0));
  const keep = new Uint8Array(a.length).fill(1);
  let i = 0;
  while (i < n) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && quiet[j]) j++;
    if (i > 0 && j < n && N.median32(rms.subarray(i, j)) < f32(0.0025)) {
      const L = ((j - i) * hop) / SR;
      const want = L < g.keepBelow ? L : L < g.shortUpTo ? g.shortTo : Math.min(L, g.longest);
      const cut = Math.trunc((L - want) * SR);
      if (cut > 0) {
        const mid = Math.floor(((i + j) * hop) / 2);
        const from = mid - Math.floor(cut / 2);
        // a Python slice: negative ends count from the back, and both are clipped to the array
        const pyIdx = (x) => (x < 0 ? Math.max(0, a.length + x) : Math.min(a.length, x));
        const s0 = pyIdx(from);
        const s1 = pyIdx(from + cut);
        for (let x = s0; x < s1; x++) keep[x] = 0;
      }
    }
    i = j;
  }
  let m = 0;
  for (let x = 0; x < a.length; x++) if (keep[x]) m++;
  const out = new Float32Array(m);
  for (let x = 0, y = 0; x < a.length; x++) if (keep[x]) out[y++] = a[x];
  return out;
}

function loudness(a) {
  const frame = Math.trunc(0.02 * SR);
  const n = Math.floor(a.length / frame);
  if (n < 2) return 0.0;
  const rms = N.frameRms32(a, frame);
  let max = -Infinity;
  for (const r of rms) if (r > max) max = r;
  const lim = f32(max * f32(0.1));
  const sq = [];
  for (const r of rms) if (r > lim) sq.push(f32(r * r));
  return sq.length ? f32(Math.sqrt(N.mean32(Float32Array.from(sq)))) : 0.0;
}

function breath(seed, b) {
  const rng = defaultRng(seed);
  const n = Math.trunc(SR * b.length);
  const noise = rng.standardNormal(n);
  const [re, im] = N.rfft(noise);
  const f = N.rfftfreq(n, 1 / SR);
  for (let i = 0; i < re.length; i++) {
    const g = Math.exp(-(Math.log(Math.max(f[i], 1) / 2300) ** 2) / 0.9);
    re[i] *= g;
    im[i] *= g;
  }
  const a = N.irfft(re, im, n);
  const sq = a.map((x) => x * x);
  const norm = Math.max(1e-9, Math.sqrt(N.mean64(sq)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * Math.min(1, t / 0.72)) ** 1.5 * (t > 0.72 ? Math.max(0, 1 - (t - 0.72) / 0.28) ** 2 : 1);
    out[i] = ((a[i] / norm) * env) * b.level;
  }
  return out;
}

function rumble(a, hz) {
  const [re, im] = N.rfft(a);
  const f = N.rfftfreq(a.length, 1 / SR);
  for (let i = 0; i < re.length; i++) {
    const d = Math.sqrt(1 + (hz / Math.max(f[i], 1)) ** 4);
    re[i] /= d;
    im[i] /= d;
  }
  return Float32Array.from(N.irfft(re, im, a.length));
}

function roomIr(seed, decay, seconds = 0.26) {
  const rng = defaultRng(seed);
  const n = Math.trunc(SR * seconds);
  const noise = rng.standardNormal(n);
  const ir0 = new Float64Array(n);
  for (let i = 0; i < n; i++) ir0[i] = noise[i] * Math.exp(-(i / SR) / decay);
  const [re, im] = N.rfft(ir0);
  const f = N.rfftfreq(n, 1 / SR);
  for (let i = 0; i < re.length; i++) {
    const g = (1 / Math.sqrt(1 + (f[i] / 5200) ** 4)) * (1 / Math.sqrt(1 + (260 / Math.max(f[i], 1)) ** 4));
    re[i] *= g;
    im[i] *= g;
  }
  const ir = N.irfft(re, im, n);
  for (let i = 0; i < Math.trunc(SR * 0.004); i++) ir[i] = 0;
  const norm = Math.sqrt(N.sum64(ir.map((x) => x * x)));
  return Float32Array.from(ir, (x) => x / norm);
}

function inRoom(a, ir, wet, delay) {
  const n = a.length + ir.length;
  let size = 1;
  while (size < n) size <<= 1;
  const [ar, ai] = N.rfft(a, size);
  const [br, bi] = N.rfft(ir, size);
  for (let i = 0; i < ar.length; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const m = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = m;
  }
  const echo = N.irfft(ar, ai, size);
  const d = Math.max(1, Math.trunc(SR * delay));
  const out = Float32Array.from(a);
  for (let i = d; i < a.length; i++) out[i] = f32(out[i] + f32(echo[i - d] * wet));
  return out;
}

// the same "random" number for the same text, so a voice-over does not change from one run to the next (radio.py)
const rnd = (text, lo, hi) => lo + (hi - lo) * (parseInt(sha1(text).slice(0, 8), 16) / 0xffffffff);

// ---------- the script ----------
const SENT = /(?<=[.!?…])\s+|(?<=[。！？])/u;
const splitSentences = (s) => s.split(SENT).filter((x) => x && x.trim()).map((x) => x.trim());

// a very long line is cut into runs of whole sentences, so progress can be shown and one slip does not cost much
function chunks(line, longest) {
  if (cp(line).length <= longest) return [line];
  const out = [];
  let cur = '';
  for (const s of splitSentences(line)) {
    if (cur && cp(cur).length + 1 + cp(s).length > longest) {
      out.push(cur);
      cur = s;
    } else cur = (cur + ' ' + s).trim();
  }
  return cur ? [...out, cur] : out;
}

// [[text, endsParagraph, extraPause]]. Each line of the script is spoken in one go, so the voice can shape it; a
// blank line starts a new paragraph. "sentences" speaks each sentence alone. "[pause]" (1 s) or "[pause 2.5s]"
// anywhere adds that much silence there.
const PAUSE = /\[\s*pause(?:\s+(\d+(?:\.\d+)?)\s*s?)?\s*\]/giu;
function pieces(text, split, longest = 320) {
  const out = [];
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/u).filter((p) => p.trim());
  for (const p of paras) {
    const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
    const units = []; // [text, extraPause]
    let pending = 0; // a pause before anything was said in this paragraph
    for (const ln of split === 'sentences' ? [lines.join(' ')] : lines) {
      const segs = ln.split(PAUSE);
      for (let i = 0; i < segs.length; i += 2) {
        const seg = (segs[i] || '').trim();
        const parts = seg ? (split === 'sentences' ? splitSentences(seg) : chunks(seg, longest)) : [];
        for (const t of parts) units.push([t, 0]);
        if (i + 1 < segs.length) {
          const secs = segs[i + 1] === undefined ? 1 : Math.min(60, Number(segs[i + 1]) || 0);
          if (units.length) units[units.length - 1][1] += secs;
          else if (out.length) out[out.length - 1][2] += secs;
          else pending += secs;
        }
      }
    }
    if (!units.length) continue;
    units[0][2] = pending;
    units.forEach(([t, extra], i) => out.push([t, i === units.length - 1, extra]));
  }
  return out;
}

// the presentation's background music (src/walk_music.py): quiet under the voice, a little louder in the pauses
function musicBed(v, m) {
  const n = v.length + Math.trunc(m.tail * SR);
  const rng = defaultRng(7);
  const CH = [[130.81, 196.0, 246.94, 329.63], [110.0, 164.81, 196.0, 261.63], [87.31, 130.81, 164.81, 220.0], [98.0, 146.83, 220.0, 246.94]];
  const BAR = 8.0;
  const music = new Float64Array(n);
  const bars = Math.trunc(n / SR / BAR) + 2;
  for (let k = 0; k < bars; k++) {
    const chord = CH[k % 4];
    const t0 = k * BAR - 2.0;
    const t1 = t0 + BAR + 4.0;
    const i0 = Math.max(0, Math.trunc(t0 * SR));
    const i1 = Math.min(n, Math.trunc(t1 * SR));
    if (i0 >= i1) continue;
    for (let i = i0; i < i1; i++) {
      const tt = i / SR;
      const env = Math.sin((Math.PI * (tt - t0)) / (t1 - t0)) ** 2;
      let seg = 0;
      for (const f of chord) for (const det of [0.9985, 1.0015]) seg += Math.sin(2 * Math.PI * f * det * tt) + 0.25 * Math.sin(2 * Math.PI * 2 * f * det * tt);
      music[i] += seg * env * 0.06;
    }
  }
  const step = 0.75;
  for (let k = 0; k < Math.trunc(n / SR / step); k++) {
    if (rng.random() < 0.62) continue;
    const tk = k * step;
    const chord = CH[Math.trunc(Math.floor(tk / BAR)) % 4];
    const f = chord[1 + ((k * 2 + rng.integers(0, 2)) % 3)] * 2;
    const i0 = Math.trunc(tk * SR);
    const i1 = Math.min(n, i0 + Math.trunc(1.6 * SR));
    const len = i1 - i0;
    const note = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      const tt = i / SR;
      note[i] = (Math.sin(2 * Math.PI * f * tt) + 0.2 * Math.sin(2 * Math.PI * 2 * f * tt)) * Math.exp(-tt * 2.4) * (1 - Math.exp(-tt * 60));
    }
    for (const [dl, g] of [[0, 1.0], [0.31, 0.35], [0.62, 0.15]]) {
      const j0 = i0 + Math.trunc(dl * SR);
      const j1 = Math.min(n, j0 + len);
      if (j0 < n) for (let i = j0; i < j1; i++) music[i] += note[i - j0] * g * 0.032;
    }
  }
  let peak = 0;
  for (const x of music) if (Math.abs(x) > peak) peak = Math.abs(x);
  peak = Math.max(1e-9, peak);
  for (let i = 0; i < n; i++) music[i] /= peak;
  const F = Math.floor(SR / 100);
  const vv = new Float32Array(n);
  vv.set(v);
  const fr = N.frameRms32(vv.subarray(0, Math.floor(n / F) * F), F);
  const active = fr.map((x) => (x > f32(0.01) ? 1 : 0));
  // np.convolve(active, ones(45), mode="same") > 0: any active frame within 22 frames either side
  const act = new Uint8Array(fr.length);
  for (let i = 0; i < fr.length; i++) for (let d = -22; d <= 22; d++) if (active[i + d]) { act[i] = 1; break; }
  const actSq = [];
  for (let i = 0; i < fr.length; i++) if (active[i]) actSq.push(f32(fr[i] * fr[i]));
  const vr = actSq.length ? f32(Math.sqrt(N.mean32(Float32Array.from(actSq)))) : 0.05;
  const mrms = Math.sqrt(N.mean64(music.map((x) => x * x)));
  const under = (vr * 10 ** (m.under / 20)) / mrms;
  const pause = (vr * 10 ** (m.pause / 20)) / mrms;
  const g = new Float64Array(fr.length);
  let cur = act[0] ? under : pause;
  for (let i = 0; i < fr.length; i++) {
    const x = act[i] ? under : pause;
    cur += (x - cur) * (x < cur ? 0.25 : 0.025);
    g[i] = cur;
  }
  const tLast = (n - 1) / SR;
  const mix = new Float64Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const gain = i < g.length * F ? g[Math.floor(i / F)] : g[g.length - 1];
    const fade = Math.min(1, Math.min(t / 3.0, (tLast - t) / Math.max(0.1, m.tail)));
    mix[i] = vv[i] + music[i] * gain * fade;
    if (Math.abs(mix[i]) > top) top = Math.abs(mix[i]);
  }
  const div = Math.max(1.0, top / 0.98);
  return Float32Array.from(mix, (x) => x / div);
}

function langOf(s, langs) {
  if (s.lang && s.lang !== 'auto') return s.lang;
  const p = s.voice[0];
  return (langs.find((l) => l.prefix === p) || { code: 'en-us' }).code;
}

// ---------- making a voice-over ----------
let engine = null; // { dir, k }: the model stays loaded between voice-overs
async function kokoroFor(modelDir) {
  if (!engine || engine.dir !== modelDir) engine = { dir: modelDir, k: await Kokoro.load(modelDir) };
  return engine.k;
}

// job: { text, settings, out, modelDir, cacheDir, languages }. emit({type: start|progress|...}).
// Returns { duration, lines, lang } and writes job.out (32-bit float WAV, 24 kHz, mono).
async function make(job, emit = () => {}, isCancelled = () => false) {
  const s = job.settings;
  const k = await kokoroFor(job.modelDir);
  fs.mkdirSync(job.cacheDir, { recursive: true });
  const lang = langOf(s, job.languages || []);
  const items = pieces(job.text, s.split || 'lines');
  if (!items.length) throw new Error('There is nothing to read.');
  emit({ type: 'start', total: items.length, lang });
  const ctx = { k, cache: job.cacheDir, raws: new Map() };
  const P = s.pauses;
  const parts = [];
  const marks = [];
  let prevEnd = null;
  let t = s.music.on ? Number(s.music.intro) : 0.0;
  for (let i = 0; i < items.length; i++) {
    if (isCancelled()) return null;
    const [text, paraEnd, extra] = items[i];
    let speed = Number(s.speed);
    if (s.pace.on && /[?!]$/.test(text.trimEnd())) speed *= Number(s.pace.question);
    let a = await speak(ctx, text, s, speed, lang);
    if (s.edges.on) a = edges(a, s.edges);
    if (s.closeGaps.on) a = closeGaps(a, s.closeGaps);
    const words = text.split(/\s+/u).filter(Boolean).length;
    if (i > 0 && s.breaths.on && words >= Math.trunc(Number(s.breaths.minWords))) {
      const gapBefore = Math.max(parts[parts.length - 1][2], 0.34); // room to take the breath in
      t = prevEnd + gapBefore;
      const br = breath(i * 7 + cp(text).length, s.breaths);
      parts.push([t - br.length / SR - 0.03, br, 0.0, 'breath']);
    } else if (prevEnd !== null) t = prevEnd + parts[parts.length - 1][2];
    const d = a.length / SR;
    // the pause after this piece (walk_tts: gap, +0.6 s for numbers, +0.3 s for questions; a new paragraph waits longer)
    // (Python's \d is any digit, Hindi and Arabic-Indic ones too)
    let g = P.lineVary ? rnd(text, 0.2, 0.3) : P.sentence + (/\p{Nd}/u.test(text) ? P.number : 0) + (/[?？]$/u.test(text.trimEnd()) ? P.question : 0);
    if (paraEnd && i < items.length - 1) g += P.paragraph;
    g += extra || 0; // [pause] in the script
    parts.push([t, a, g, 'voice']);
    marks.push({ t0: round2(t), t1: round2(t + d), text });
    prevEnd = t + d;
    emit({ type: 'progress', done: i + 1, total: items.length, text: cp(text).slice(0, 80).join('') });
  }
  const total = Math.trunc(SR * (Math.max(...parts.map((p) => p[0] + p[1].length / SR)) + Number(P.end || 0)));
  let mix = new Float32Array(total);
  const voice = parts.filter((p) => p[3] === 'voice');
  if (s.level.on) {
    // one loudness for the whole voice-over, never line by line (radio.py build)
    let long = voice.map((p) => p[1]).filter((x) => x.length > SR * 0.4);
    if (!long.length) long = voice.map((p) => p[1]);
    const all = new Float32Array(long.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of long) {
      all.set(x, at);
      at += x.length;
    }
    const gain = Number(s.level.target) / Math.max(1e-6, loudness(all));
    const g32 = f32(gain);
    for (const p of voice) p[1] = p[1].map((x) => f32(x * g32));
  }
  for (const p of parts) {
    const i0 = Math.max(0, Math.trunc(p[0] * SR));
    const seg = p[1].subarray(0, Math.max(0, total - i0));
    for (let i = 0; i < seg.length; i++) mix[i0 + i] = f32(mix[i0 + i] + seg[i]);
  }
  if (s.rumble.on) mix = rumble(mix, Number(s.rumble.hz));
  if (s.room.on) mix = inRoom(mix, roomIr(5, Number(s.room.decay)), Number(s.room.wet), Number(s.room.delay));
  if (s.peak.on) {
    let peak = 0;
    for (const x of mix) if (Math.abs(x) > peak) peak = Math.abs(x);
    if (peak > s.peak.limit) {
      const r = f32(Number(s.peak.limit) / peak);
      mix = mix.map((x) => f32(x * r));
    }
  }
  if (s.music.on) mix = musicBed(mix, s.music);
  if (isCancelled()) return null;
  wav.writeFloat(job.out, mix, SR);
  return { duration: round2(mix.length / SR), lines: marks, lang };
}

// free the model (the worker running a voice-over calls this before it ends)
async function release() {
  if (!engine) return;
  const e = engine;
  engine = null;
  try { await e.k.sess.release(); } catch {}
}

async function voices(modelDir) {
  return (await kokoroFor(modelDir)).getVoices();
}

// one piece as the voice-over speaks it (before the line effects), with its cache file
async function speakLine({ text, settings, speed, lang, modelDir, cacheDir }) {
  const k = await kokoroFor(modelDir);
  fs.mkdirSync(cacheDir, { recursive: true });
  return speak({ k, cache: cacheDir, raws: new Map() }, text, settings, speed, lang);
}

module.exports = { make, release, voices, speakLine, cacheName, pieces, pyFloat, pyJson, fixed3, langOf, _internal: { edges, closeGaps, loudness, breath, rumble, roomIr, inRoom, musicBed, speak } };
