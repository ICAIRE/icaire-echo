// Japanese text to Kokoro's sounds, as misaki 0.9.4 does it (misaki/ja.py, JAG2P(version="pyopenjtalk"), the one
// the Python app used): OpenJTalk's front end finds each word's reading, accent and mora count, and misaki turns
// the moras into sounds with a pitch mark for each. pyopenjtalk is replaced by jpreprocess (a Rust port of
// OpenJTalk's front end) compiled to WebAssembly in @yomiscript/ja-accent, with the NAIST-JDIC dictionary built for
// it, downloaded from Hugging Face (receptron/yomiscript-ja-dict) by install() (lib/g2p.js).
// misaki's tables are in voice/ja-moras.json, generated from the Python module.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const T = require('../voice/ja-moras.json');
const M2P = T.M2P;
const TAILS = new Set(T.TAILS);
const PUNCT_MAP = T.PUNCT_MAP;
const PUNCT_VALUES = new Set(T.PUNCT_VALUES);
const PUNCT_STARTS = new Set(T.PUNCT_STARTS);
const PUNCT_STOPS = new Set(T.PUNCT_STOPS);
const UNK = '❓';
const cp = (s) => Array.from(s);

const DICT = 'https://huggingface.co/receptron/yomiscript-ja-dict/resolve/main/jpreprocess-0.15.0/';
const FILES = [
  ['metadata.json', 319, 'c51ecb56c18aa76239aec14964bdb02917b3a064606f261a1f26efcaecae6f3f'],
  ['char_def.bin', 763, '1db7114e3dfeda1680d51b368e7a4e0b8cab0ebbb692a7b1f209ef0dc087a37d'],
  ['matrix.mtx', 1835118, 'b9000e3ea5c1cdf5ef5c24c3bc06a60f38ab0bc52562d58790fd051f67c8ce1e'],
  ['dict.da', 16254415, '1eb60c43b9389100307805a3ea78ef663264d3e94e51739e4206cf25586fecb7'],
  ['dict.vals', 2966610, '8846bb8f01db8831661a1a5f943c68b8e6f692fc1a200292175f0c050badebbc'],
  ['dict.wordsidx', 1290654, '58b71b60e319583a43016471f86bcaa78f1bb1e18924f692197767092dd318ee'],
  ['dict.words', 6266840, '61376d2d9ba80d44d8550dad2e3c80b8846cdbea780976bb0bd07556a9518c4c'],
  ['unk.bin', 680, '3ef03ad5b8c44f8e0c8a72c69b78ed3ae8def4a5ae8ce11e9c38cb57e6ce07e7'],
];
const SOURCES = FILES.map(([n, bytes, sha256]) => ({ name: n + '.gz', bytes, sha256, url: DICT + n + '.gz' }));

function unpack(downloads, dir) {
  for (const s of SOURCES) fs.renameSync(path.join(downloads, s.name), path.join(dir, s.name));
}

// the package exports only its JavaScript API; its WebAssembly glue is loaded by file
function packageDir() {
  const dir = require.resolve.paths('@yomiscript/ja-accent').map((d) => path.join(d, '@yomiscript', 'ja-accent')).find((d) => fs.existsSync(d));
  if (!dir) throw new Error('The Japanese reader is not installed (npm install).');
  return dir;
}

// one NJD feature row (CSV, as pyopenjtalk's run_frontend gives them as dicts)
function njdRow(csv) {
  let f = csv.split(',');
  if (f.length > 13) f = [f.slice(0, f.length - 12).join(','), ...f.slice(f.length - 12)]; // a comma in the word itself
  const [acc, mora] = f[10].split('/').map(Number);
  return { string: f[0], pos: f[1], pron: f[9], acc, mora_size: mora, chain_rule: f[11], chain_flag: Number(f[12]) };
}

function pron2moras(pron) {
  const moras = [];
  for (const k of cp(pron)) {
    if (!(k in M2P)) continue;
    if (moras.length && moras[moras.length - 1] + k in M2P) moras[moras.length - 1] += k;
    else moras.push(k);
  }
  return moras;
}

class JA {
  constructor(fe) {
    this.fe = fe;
  }
  frontend(text) {
    const [njd] = JSON.parse(this.fe.analyze(text));
    return njd.map(njdRow);
  }
  // JAG2P.__call__: the sounds, then one pitch mark per sound (misaki returns them joined)
  phonemes(text) {
    const tokens = [];
    let lastA = 0;
    let acc = null;
    let mcount = 0;
    for (const word of this.frontend(text)) {
      const { pron, mora_size: moraSize } = word;
      let moras = [];
      if (moraSize > 0) {
        moras = pron2moras(pron);
        if (!(moras.length === moraSize || moras.length + (moras[0] === 'ー' ? 1 : 0) === moraSize)) throw new Error(`AssertionError: (${JSON.stringify(moras)}, ${moraSize})`);
      }
      const last = tokens[tokens.length - 1];
      const chainFlag = moraSize > 0 && !!last && last.mora_size > 0 && (word.chain_flag === 1 || moras[0] === 'ー');
      if (!chainFlag) {
        acc = null;
        mcount = 0;
      }
      acc = acc === null ? word.acc : acc;
      const accents = [];
      for (let i = 0; i < moras.length; i++) {
        mcount += 1;
        if (acc === 0) accents.push(mcount === 1 ? 0 : lastA === 0 ? 1 : 2);
        else if (acc === mcount) accents.push(3);
        else if (mcount > 1 && mcount < acc) accents.push(lastA === 0 ? 1 : 2);
        else accents.push(0);
        lastA = accents[accents.length - 1];
      }
      let surface = word.string;
      if (surface in PUNCT_MAP) surface = PUNCT_MAP[surface];
      let whitespace = '';
      let phonemes = null;
      let pitch = null;
      if (moras.length) {
        phonemes = '';
        pitch = '';
        moras.forEach((m, i) => {
          const ps = M2P[m];
          phonemes += ps;
          pitch += (accents[i] === 0 ? '_' : accents[i] === 3 ? '^' : '-').repeat(cp(ps).length);
        });
      } else if (surface && cp(surface).every((s) => PUNCT_VALUES.has(s))) {
        phonemes = surface;
        const end = cp(surface).pop();
        if (PUNCT_STOPS.has(end)) {
          whitespace = ' ';
          if (last) last.whitespace = '';
        } else if (PUNCT_STARTS.has(end) && last && !last.whitespace) last.whitespace = ' ';
      }
      if ((last && phonemes === null && surface === '・') || (surface && !surface.trim())) {
        if (!last) throw new Error('IndexError: list index out of range');
        last.whitespace = ' ';
        continue;
      }
      tokens.push({ text: surface, whitespace, phonemes, mora_size: moraSize, chain_flag: chainFlag, moras, pitch });
    }
    let result = '';
    let pitch = '';
    for (const tk of tokens) {
      if (tk.phonemes === null) {
        result += UNK + tk.whitespace;
        pitch += 'j'.repeat(cp(UNK + tk.whitespace).length);
        continue;
      }
      const tail = cp(result).pop();
      if (tk.mora_size && !tk.chain_flag && result && TAILS.has(tail) && tk.moras[0] !== 'ン') {
        result += ' ';
        pitch += 'j';
      }
      result += tk.phonemes + tk.whitespace;
      pitch += (tk.pitch === null ? 'j'.repeat(cp(tk.phonemes).length) : tk.pitch) + 'j'.repeat(cp(tk.whitespace).length);
    }
    const lastTk = tokens[tokens.length - 1];
    if (lastTk && lastTk.whitespace && result.endsWith(lastTk.whitespace)) {
      result = cp(result).slice(0, -cp(lastTk.whitespace).length).join('');
      pitch = cp(pitch).slice(0, cp(result).length).join('');
    }
    return result + pitch;
  }
}

// the reader, for lib/g2p.js
async function load(dir) {
  const pkg = packageDir();
  const { initSync, Frontend } = await import(pathToFileURL(path.join(pkg, 'wasm', 'pkg', 'frontend.js')).href);
  initSync({ module: fs.readFileSync(path.join(pkg, 'wasm', 'pkg', 'frontend_bg.wasm')) });
  const parts = SOURCES.map((s) => zlib.gunzipSync(fs.readFileSync(path.join(dir, s.name))));
  // no user dictionary: plain OpenJTalk readings, as pyopenjtalk gave them
  return new JA(new Frontend(Buffer.concat(parts), Uint32Array.from(parts.map((p) => p.length)), null));
}

module.exports = { SOURCES, unpack, load, njdRow, pron2moras };
