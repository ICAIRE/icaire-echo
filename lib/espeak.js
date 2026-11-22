// Text to sounds (IPA) with eSpeak NG, the way Kokoro's Python package did it: phonemizer 3.6
// (phonemize(text, lang, preserve_punctuation=True, with_stress=True)), with eSpeak NG compiled to WebAssembly
// (@echogarden/espeak-ng-emscripten) instead of the native library. Ported here:
//   phonemizer/punctuation.py   the text is cut at punctuation, each piece is read on its own, the marks are put back
//   phonemizer/backend/base.py  pieces split only by quotes or brackets are also read together, for context
//   phonemizer/backend/espeak   voice choice by language code, and the clean-up of eSpeak's output
let worker = null;
let voices = null;
let current = null;

async function load() {
  if (worker) return worker;
  const { default: Module } = await import('@echogarden/espeak-ng-emscripten');
  const m = await Module();
  worker = { m, w: new m.eSpeakNGWorker() };
  // language code -> voice identifier, the first voice of each code, skipping mbrola voices (wrapper.set_voice)
  voices = new Map();
  for (const v of worker.w.list_voices()) {
    if (String(v.identifier).startsWith('mb/')) continue;
    const lang = v.languages && v.languages[0] && v.languages[0].name;
    if (lang && !voices.has(lang)) voices.set(lang, v.identifier);
  }
  return worker;
}

function setVoice(code) {
  if (current === code) return;
  const id = voices.get(code);
  if (!id) throw new Error(`eSpeak has no voice for "${code}"`);
  worker.w.set_voice(id);
  current = code;
}

// espeak_TextToPhonemes over the whole text, clauses joined by a space (wrapper.text_to_phonemes)
const utf8 = new TextDecoder('utf-8');
function textToPhonemes(text) {
  const { m, w } = worker;
  const ptr = w.convert_to_phonemes(text, true).ptr;
  let end = ptr;
  while (m.HEAPU8[end] !== 0) end++;
  const s = utf8.decode(m.HEAPU8.subarray(ptr, end));
  m._free(ptr); // the glue copies the result into a new buffer for each call
  return s.split(' | ').filter(Boolean).join(' ');
}

// EspeakBackend._postprocess_line with separator(phone='', word=' '), strip=False, with_stress=True
function postprocess(line) {
  line = line.trim().replace(/\n/g, ' ').split('  ').join(' ');
  if (line.includes('__')) line = line.replace(/_+/g, '_');
  line = line.split('_ ').join(' ');
  if (!line) return '';
  const words = line.split(' ').map((w) => w.trim() + '_').map((w) => w.split('_').join(''));
  return words.join(' ') + ' ';
}

// ---------- punctuation (phonemizer/punctuation.py) ----------
const MARKS = ';:,.!?¡¿—…"«»“”(){}[]';
const DECIMALS = ',.';
const INLINE = '"«»“”‘’„‹›()[]{}';
const esc = (s) => s.replace(/[\\\]\[^-]/g, '\\$&');
const OTHERS = [...new Set(MARKS)].filter((c) => !DECIMALS.includes(c)).join('');
const MARKS_RE = new RegExp(`(\\s*(?:[${esc(OTHERS)}]|(?<![0-9])[${esc(DECIMALS)}]|[${esc(DECIMALS)}](?![0-9]))+\\s*)+`, 'gu');

const isInline = (mark) => {
  const m = mark.split(/\s+/).join('');
  return !!m && [...m].every((c) => INLINE.includes(c));
};

function preserve(lines) {
  const chunks = [];
  const out = [];
  for (const line of lines) {
    const parts = [];
    let cursor = 0;
    for (const match of line.matchAll(MARKS_RE)) {
      if (line.slice(cursor, match.index)) {
        parts.push(chunks.length);
        chunks.push(line.slice(cursor, match.index));
      }
      parts.push(match[0]);
      cursor = match.index + match[0].length;
    }
    if (line.slice(cursor)) {
      parts.push(chunks.length);
      chunks.push(line.slice(cursor));
    }
    out.push(parts);
  }
  return { chunks, lines: out };
}

function inlineGroups(lines) {
  const groups = [];
  for (const parts of lines) {
    let group = [];
    parts.forEach((part, num) => {
      if (typeof part !== 'number') return;
      if (group.length && num >= 2 && parts[num - 2] === group[group.length - 1] && isInline(parts[num - 1])) group.push(part);
      else {
        if (group.length > 1) groups.push(group);
        group = [part];
      }
    });
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

const wordsOf = (text) => text.split(' ').filter(Boolean);

function contextParts(text, group, phonemized) {
  const counts = group.map((c) => wordsOf(text[c]).length);
  if (!counts.every(Boolean) || wordsOf(phonemized).length !== counts.reduce((a, b) => a + b, 0)) return null;
  const starts = new Set();
  let acc = 0;
  for (const c of counts.slice(0, -1)) starts.add((acc += c));
  const pieces = phonemized.split(' ');
  const cuts = [0];
  let n = 0;
  pieces.forEach((piece, num) => {
    if (piece) {
      if (starts.has(n)) cuts.push(num);
      n++;
    }
  });
  cuts.push(pieces.length);
  return cuts.slice(0, -1).map((s, i) => pieces.slice(s, cuts[i + 1]).join(' '));
}

function restore(text, lines, context) {
  const position = new Map();
  lines.forEach((parts, num) => parts.forEach((part, pos) => typeof part === 'number' && position.set(part, [num, pos])));
  const inContext = new Map();
  for (const [group, phonemized] of context) {
    const places = group.map((c) => position.get(c));
    if (places.some((p) => !p)) continue;
    let ok = true;
    for (let i = 0; i + 1 < places.length; i++) {
      const [a, b] = [places[i], places[i + 1]];
      if (b[0] !== a[0] || b[1] !== a[1] + 2 || !isInline(lines[a[0]][a[1] + 1])) ok = false;
    }
    if (!ok) continue;
    const parts = contextParts(text, group, phonemized);
    if (parts) group.forEach((c, i) => inContext.set(c, parts[i]));
  }
  return lines.map((line) => {
    let out = '';
    let mark = null;
    for (const part of line) {
      if (typeof part === 'string') {
        if (out.endsWith(' ')) out = out.slice(0, -1);
        mark = part;
        out += mark;
      } else {
        const chunk = inContext.has(part) ? inContext.get(part) : text[part];
        if (chunk) {
          out += chunk;
          mark = null;
        }
      }
    }
    if (mark !== null && !mark.endsWith(' ')) out += ' ';
    return out;
  });
}

// phonemizer.phonemize(text, language, preserve_punctuation=True, with_stress=True) for one string
async function phonemize(text, language = 'en-us') {
  await load();
  setVoice(language);
  const lines = text.replace(/^[\r\n]+|[\r\n]+$/g, '').split('\n').map((l) => l.replace(/\r+$/, '')).map((l) => l.replace(/^[\r\n]+|[\r\n]+$/g, '')).filter((l) => l.trim());
  if (!lines.length) return '';
  const { chunks, lines: marks } = preserve(lines);
  const groups = inlineGroups(marks);
  const all = [...chunks, ...groups.map((g) => g.map((c) => chunks[c]).join(' '))];
  const phonemized = all.map((t) => postprocess(textToPhonemes(t)));
  const n = phonemized.length - groups.length;
  const context = groups.map((g, i) => [g, phonemized[n + i]]);
  return restore(phonemized.slice(0, n), marks, context).join('\n');
}

async function version() {
  await load();
  return [...voices.keys()].length;
}

module.exports = { phonemize, load, version, _internal: { preserve, inlineGroups, restore, postprocess, MARKS_RE } };
