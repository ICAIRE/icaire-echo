// Japanese and Chinese pronunciation, Kokoro's own rules (misaki 0.9.4), ported to Node: an optional download.
// eSpeak reads these two badly (Japanese kanji come out as "Chinese letter"); misaki reads them properly
// (measured with Whisper on 20 Nov: Japanese from about 30% of words right to 88%, Chinese from 50% to 100%),
// but needs dictionaries, so each pack is downloaded only when someone picks such a voice.
//   zh: jieba's dictionary and pypinyin's, from PyPI (lib/g2p-zh.js)
//   ja: OpenJTalk's dictionary (NAIST-JDIC) for its front end in WebAssembly (lib/g2p-ja.js)
const fs = require('fs');
const path = require('path');
const { Download } = require('./download');

const DIR = require('./paths').models('voice-extras');
const PACKS = {
  zh: () => require('./g2p-zh'),
  ja: () => require('./g2p-ja'),
};
const EXTRA = {
  ja: { name: 'Japanese', mb: 29, langs: ['ja'] },
  zh: { name: 'Chinese', mb: 20, langs: ['cmn'] },
};
const keyOf = (lang) => (lang === 'ja' ? 'ja' : 'zh');
const hasExtra = (k) => fs.existsSync(path.join(DIR, k, '.ok'));

// download and unpack a pack; onStep(text) reports what it is doing
async function install(key, { signal, onStep = () => {} } = {}) {
  const pack = PACKS[key]();
  const dir = path.join(DIR, key);
  const downloads = path.join(DIR, 'downloads', key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const d = new Download(EXTRA[key].name);
  d.on('update', (s) => s.status === 'running' && onStep(`Downloading… ${Math.floor(s.percent)}%`));
  if (signal) signal.addEventListener('abort', () => d.cancel());
  const status = await d.run(pack.SOURCES, downloads);
  if (status !== 'done') throw new Error(d.error || 'The download stopped.');
  onStep('Installing…');
  await pack.unpack(downloads, dir);
  fs.rmSync(downloads, { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, '.ok'), new Date().toISOString());
}

const loaded = {};
async function reader(key) {
  if (!hasExtra(key)) throw new Error(`needs-extra:${key}`);
  if (!loaded[key]) loaded[key] = PACKS[key]().load(path.join(DIR, key));
  return loaded[key];
}

// the sounds of a piece of text, as misaki makes them (what its G2P returns first)
async function phonemes(text, lang) {
  return (await reader(keyOf(lang))).phonemes(text);
}

module.exports = { EXTRA, hasExtra, install, phonemes, DIR };
