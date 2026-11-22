// Chinese text to Kokoro's sounds, as misaki 0.9.4 does it (misaki/zh.py, ZHG2P() without a version: its
// "legacy" path, the one the Python app used). Ported:
//   cn2an.transform(text, 'an2cn')   Arabic numerals to Chinese ones (cn2an 0.5.24, MIT)
//   jieba.lcut(text)                 word splitting with jieba 0.42.1's dictionary and HMM (MIT)
//   pypinyin.lazy_pinyin(word, TONE3, neutral_tone_with_five=True)   readings (pypinyin 0.55.0, MIT)
//   ZHG2P.py2ipa                     reading -> sounds: precomputed for every reading pypinyin has, in
//                                    voice/zh-syllables.json (generated from the Python packages)
// The dictionaries are the packages' own files, downloaded from PyPI by install() (lib/g2p.js).
const fs = require('fs');
const path = require('path');
const { unzip, untargz } = require('./archive');

const SYLLABLES = require('../voice/zh-syllables.json').table;

const SOURCES = [
  { name: 'jieba-0.42.1.tar.gz', bytes: 19214172, sha256: '055ca12f62674fafed09427f176506079bc135638a14e23e25be909131928db2', url: 'https://files.pythonhosted.org/packages/c6/cb/18eeb235f833b726522d7ebed54f2278ce28ba9438e3135ab0278d9792a2/jieba-0.42.1.tar.gz' },
  { name: 'pypinyin-0.55.0-py2.py3-none-any.whl', bytes: 840203, sha256: 'd53b1e8ad2cdb815fb2cb604ed3123372f5a28c6f447571244aca36fc62a286f', url: 'https://files.pythonhosted.org/packages/b9/7b/4cabc76fcc21c3c7d5c671d8783984d30ac9d3bb387c4ba784fca3cdfa3a/pypinyin-0.55.0-py2.py3-none-any.whl' },
];

// ---------- unpacking the downloads (install time) ----------
// jieba's HMM tables are Python files: P={'B': {'一': -3.65, ...}, 'E': {...}, ...}
function parseProb(src) {
  const unq = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const body = src.slice(src.indexOf('P=') + 2);
  if (!/^\s*\{\s*'[BEMS]'\s*:\s*\{/.test(body)) {
    const flat = {};
    for (const m of body.matchAll(/'([BEMS])'\s*:\s*(-?[\d.]+(?:e[+-]?\d+)?)/g)) flat[m[1]] = parseFloat(m[2]);
    return flat;
  }
  const out = {};
  const parts = body.split(/'([BEMS])'\s*:\s*\{/).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    const table = {};
    for (const m of parts[i + 1].matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*(-?[\d.]+(?:e[+-]?\d+)?)/g)) table[unq(m[1])] = parseFloat(m[2]);
    out[parts[i]] = table;
  }
  return out;
}

function unpack(downloads, dir) {
  const jieba = untargz(fs.readFileSync(path.join(downloads, SOURCES[0].name)), (n) => /jieba\/dict\.txt$|jieba\/finalseg\/prob_(start|trans|emit)\.py$/.test(n));
  const get = (re) => Object.entries(jieba).find(([n]) => re.test(n))[1];
  fs.writeFileSync(path.join(dir, 'jieba-dict.txt'), get(/dict\.txt$/));
  const prob = {};
  for (const k of ['start', 'trans', 'emit']) prob[k] = parseProb(get(new RegExp(`prob_${k}\\.py$`)).toString('utf8'));
  fs.writeFileSync(path.join(dir, 'jieba-hmm.json'), JSON.stringify(prob));
  const py = unzip(fs.readFileSync(path.join(downloads, SOURCES[1].name)), (n) => /^pypinyin\/(pinyin_dict|phrases_dict)\.json$/.test(n));
  fs.writeFileSync(path.join(dir, 'pinyin_dict.json'), py['pypinyin/pinyin_dict.json']);
  fs.writeFileSync(path.join(dir, 'phrases_dict.json'), py['pypinyin/phrases_dict.json']);
}

// ---------- cn2an.transform(text, 'an2cn') ----------
const DIGITS = '零一二三四五六七八九';
const UNITS = ['', '十', '百', '千', '万', '十', '百', '千', '亿', '十', '百', '千', '万', '十', '百', '千'];
const MEASURE = '斤|克|千克|公斤|吨|米|厘米|毫米|公里|升|毫升|元|角|分|个|只|条|张|块|瓶|杯|份|本|辆|台|匹|头|位|亩|小时|分钟|秒|天|半';
const D = '\\p{Nd}'; // Python's \d is any Unicode digit

function intConvert(s) {
  s = String(BigInt(s)); // str(int(s)): no leading zeros
  const n = s.length;
  if (n > UNITS.length) throw new Error('too long');
  let out = '';
  for (let i = 0; i < n; i++) {
    const d = +s[i];
    if (d) out += DIGITS[d] + UNITS[n - i - 1];
    else {
      if (!((n - i - 1) % 4)) out += DIGITS[d] + UNITS[n - i - 1];
      if (i > 0 && out[out.length - 1] !== '零') out += DIGITS[d];
    }
  }
  out = out.split('零零').join('零').split('零万').join('万').split('零亿').join('亿').split('亿万').join('亿').replace(/^零+|零+$/g, '');
  out = out.replace(/([万亿])零([一二三四五六七八九壹贰叁肆伍陆柒捌玖][千仟])/gu, '$1$2');
  if (out.slice(0, 2) === '一十') out = out.slice(1);
  return out || '零';
}

// An2Cn().an2cn(s, mode) for mode low / direct; throws where cn2an does (the caller then keeps the text)
function an2cn(s, mode = 'low') {
  if (!s) throw new Error('empty');
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48)).replace(/．/g, '.').replace(/－/g, '-');
  if (!/^[0-9.-]*$/.test(s)) throw new Error('out of range');
  let sign = '';
  if (s[0] === '-') {
    sign = '负';
    s = s.slice(1);
  }
  if (mode === 'direct') return sign + [...s].map((d) => (d === '.' ? '点' : DIGITS[+d])).join('');
  const parts = s.split('.');
  if (parts.length === 1) return sign + intConvert(parts[0]);
  if (parts.length === 2) return sign + intConvert(parts[0]) + (parts[1].length ? '点' : '') + [...parts[1].slice(0, 16)].map((d) => DIGITS[+d]).join('');
  throw new Error('bad format');
}

const safe = (s, f) => {
  if (!s) return s;
  try { return f(s); } catch { return s; }
};

function cn2an(text) {
  text = text.replace(new RegExp(`${D}+(\\.${D}+)?-${D}+(\\.${D}+)?(?=(${MEASURE}))`, 'gu'), (m) => safe(m, (x) => { const [a, b] = x.split('-'); return `${an2cn(a)}到${an2cn(b)}`; }));
  text = text.replace(new RegExp(`(${D}{2,4}年)?(${D}{1,2}月)?(${D}{1,2}日)?`, 'gu'), (m) => safe(m, (x) => x.replace(new RegExp(`${D}+(?=年)`, 'gu'), (y) => an2cn(y, 'direct')).replace(new RegExp(`${D}+`, 'gu'), (y) => an2cn(y))));
  text = text.replace(new RegExp(`${D}+/${D}+`, 'gu'), (m) => safe(m, (x) => { const [a, b] = x.replace(new RegExp(`${D}+`, 'gu'), (y) => an2cn(y)).split('/'); return `${b}分之${a}`; }));
  text = text.replace(new RegExp(`-?(${D}+\\.)?${D}+%`, 'gu'), (m) => safe(m, (x) => '百分之' + an2cn(x.slice(0, -1))));
  text = text.replace(new RegExp(`${D}+℃`, 'gu'), (m) => safe(m, (x) => an2cn(x.slice(0, -1)) + '摄氏度'));
  return text.replace(new RegExp(`-?(${D}+\\.)?${D}+`, 'gu'), (m) => safe(m, (x) => an2cn(x)));
}

// ---------- jieba ----------
const MIN_FLOAT = -3.14e100;
const PREV = { B: 'ES', M: 'MB', S: 'SE', E: 'BM' };
const RE_HAN = /([一-鿕a-zA-Z0-9+#&._%-]+)/u;
const RE_SKIP = /(\r\n|\s)/u;
const HAN_START = /^[\u4E00-\u9FD5a-zA-Z0-9+#&._%-]/u;
const RE_HAN_HMM = /([一-鿕]+)/u;
const RE_SKIP_HMM = /([a-zA-Z0-9]+(?:\.\d+)?%?)/u;
// Python's max() over (score, key) tuples: the higher score, then the higher key
const better = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

class Jieba {
  constructor(dictText, hmm) {
    this.freq = new Map();
    this.total = 0;
    for (const line of dictText.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const [word, f] = t.split(' ');
      const n = parseInt(f, 10);
      this.freq.set(word, n);
      this.total += n;
      for (let i = 1; i < word.length; i++) {
        const frag = word.slice(0, i);
        if (!this.freq.has(frag)) this.freq.set(frag, 0);
      }
    }
    this.logTotal = Math.log(this.total);
    this.hmm = hmm;
  }
  dag(s) {
    const dag = [];
    for (let k = 0; k < s.length; k++) {
      const list = [];
      let i = k;
      let frag = s[k];
      while (i < s.length && this.freq.has(frag)) {
        if (this.freq.get(frag)) list.push(i);
        i++;
        frag = s.slice(k, i + 1);
      }
      dag.push(list.length ? list : [k]);
    }
    return dag;
  }
  route(s, dag) {
    const n = s.length;
    const route = new Array(n + 1);
    route[n] = [0, 0];
    for (let i = n - 1; i >= 0; i--) {
      let best = null;
      for (const x of dag[i]) {
        const c = [Math.log(this.freq.get(s.slice(i, x + 1)) || 1) - this.logTotal + route[x + 1][0], x];
        if (!best || better(c, best)) best = c;
      }
      route[i] = best;
    }
    return route;
  }
  viterbi(obs) {
    const { start, trans, emit } = this.hmm;
    const states = 'BMES';
    let V = {};
    let path = {};
    for (const y of states) {
      V[y] = start[y] + (emit[y][obs[0]] ?? MIN_FLOAT);
      path[y] = [y];
    }
    for (let t = 1; t < obs.length; t++) {
      const NV = {};
      const np = {};
      for (const y of states) {
        const em = emit[y][obs[t]] ?? MIN_FLOAT;
        let best = null;
        for (const y0 of PREV[y]) {
          const c = [V[y0] + (trans[y0][y] ?? MIN_FLOAT) + em, y0];
          if (!best || better(c, best)) best = c;
        }
        NV[y] = best[0];
        np[y] = [...path[best[1]], y];
      }
      V = NV;
      path = np;
    }
    const last = better([V.S, 'S'], [V.E, 'E']) ? 'S' : 'E';
    return path[last];
  }
  *hmmCut(s) {
    for (const blk of s.split(RE_HAN_HMM)) {
      if (RE_HAN_HMM.test(blk) && blk.match(/^[一-鿕]/u)) {
        const pos = this.viterbi(blk);
        let begin = 0;
        let next = 0;
        for (let i = 0; i < blk.length; i++) {
          if (pos[i] === 'B') begin = i;
          else if (pos[i] === 'E') {
            yield blk.slice(begin, i + 1);
            next = i + 1;
          } else if (pos[i] === 'S') {
            yield blk[i];
            next = i + 1;
          }
        }
        if (next < blk.length) yield blk.slice(next);
      } else {
        for (const x of blk.split(RE_SKIP_HMM)) if (x) yield x;
      }
    }
  }
  *cutDag(s) {
    const route = this.route(s, this.dag(s));
    let x = 0;
    let buf = '';
    const flush = function* (self) {
      if (buf.length === 1) yield buf;
      else if (!self.freq.get(buf)) yield* self.hmmCut(buf);
      else yield* buf;
      buf = '';
    };
    while (x < s.length) {
      const y = route[x][1] + 1;
      const w = s.slice(x, y);
      if (y - x === 1) buf += w;
      else {
        if (buf) yield* flush(this);
        yield w;
      }
      x = y;
    }
    if (buf) yield* flush(this);
  }
  lcut(sentence) {
    const out = [];
    for (const blk of sentence.split(RE_HAN)) {
      if (!blk) continue;
      if (HAN_START.test(blk)) out.push(...this.cutDag(blk));
      else for (const x of blk.split(RE_SKIP)) {
        if (/^(\r\n|\s)/u.test(x)) out.push(x);
        else out.push(...x);
      }
    }
    return out;
  }
}

// ---------- pypinyin.lazy_pinyin(word, Style.TONE3, neutral_tone_with_five=True) -> misaki sounds ----------
class Pinyin {
  constructor(pinyinDict, phrasesDict) {
    this.single = pinyinDict;
    this.phrases = phrasesDict;
    this.prefix = new Set();
    for (const w of Object.keys(phrasesDict)) {
      const cs = Array.from(w);
      for (let i = 1; i <= cs.length; i++) this.prefix.add(cs.slice(0, i).join(''));
    }
  }
  // pypinyin's mmseg with no_non_phrases=True
  *mmseg(text) {
    let remain = Array.from(text);
    while (remain.length) {
      let lastWord = '';
      let lastIndex = 0;
      let done = false;
      for (let i = 0; i < remain.length; i++) {
        const word = remain.slice(0, i + 1).join('');
        if (this.prefix.has(word)) {
          if (word in this.phrases) {
            lastWord = word;
            lastIndex = i + 1;
          }
        } else {
          if (lastWord) {
            yield lastWord;
            remain = remain.slice(lastIndex);
          } else {
            yield remain[0];
            remain = remain.slice(1);
          }
          done = true;
          break;
        }
      }
      if (!done) {
        if (lastWord) {
          yield lastWord;
          remain = remain.slice(lastIndex);
        } else {
          const rest = remain.join('');
          if (!(rest in this.phrases)) yield* remain;
          else yield rest;
          break;
        }
      }
    }
  }
  // the readings of one han word, as raw pypinyin syllables (first reading of each character)
  readings(word) {
    const out = [];
    for (const w of this.mmseg(word)) {
      if (w in this.phrases) for (const item of this.phrases[w]) out.push(item[0]);
      else for (const c of Array.from(w)) {
        const r = this.single[String(c.codePointAt(0))];
        out.push(r ? r.split(',')[0] : c);
      }
    }
    return out;
  }
}

// ---------- ZHG2P ----------
function mapPunctuation(text) {
  const R = [['、', ', '], ['，', ', '], ['。', '. '], ['．', '. '], ['！', '! '], ['：', ': '], ['；', '; '], ['？', '? '], ['«', ' “'], ['»', '” '], ['《', ' “'], ['》', '” '], ['「', ' “'], ['」', '” '], ['【', ' “'], ['】', '” '], ['（', ' ('], ['）', ') ']];
  for (const [a, b] of R) text = text.split(a).join(b);
  return text.trim();
}

class ZH {
  constructor(dir) {
    this.jieba = new Jieba(fs.readFileSync(path.join(dir, 'jieba-dict.txt'), 'utf8'), JSON.parse(fs.readFileSync(path.join(dir, 'jieba-hmm.json'), 'utf8')));
    this.pinyin = new Pinyin(JSON.parse(fs.readFileSync(path.join(dir, 'pinyin_dict.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, 'phrases_dict.json'), 'utf8')));
  }
  wordToIpa(w) {
    return this.pinyin
      .readings(w)
      .map((r) => {
        const s = SYLLABLES[r];
        if (!s || s[1] == null) throw new Error(`Parameter 'pinyin': Tone couldn't be detected! (${r})`);
        return s[1];
      })
      .join('');
  }
  legacy(text) {
    let isZh = /^[一-鿿]/u.test(text);
    let result = '';
    for (const m of text.matchAll(/[一-鿿]+|[^一-鿿]+/gu)) {
      let seg = m[0];
      if (isZh) seg = this.jieba.lcut(seg).map((w) => this.wordToIpa(w)).join(' ');
      result += seg;
      isZh = !isZh;
    }
    return result.split('̯').join('');
  }
  phonemes(text) {
    if (!text.trim()) return '';
    return this.legacy(mapPunctuation(cn2an(text)));
  }
}

module.exports = { ZH, SOURCES, unpack, cn2an, Jieba, Pinyin, mapPunctuation };

// the reader, for lib/g2p.js
module.exports.load = async (dir) => new ZH(dir);
