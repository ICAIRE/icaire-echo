'use strict';
// Voice-overs: a script in the middle, the voice and its settings on the left, the ones you made on the right.
// Uses the helpers from app.js ($, el, api, mmss, length, bytes, plural), which share the page's global scope.

const VO = {
  info: null, // /api/voice
  preset: 'presenter',
  changes: {}, // flat "a.b" -> value, on top of the preset
  job: null,
  engine: 'standard',
  expressive: { lang: 'en', voice: 'heart', intensity: 0.5 },
  catalog: null, // /api/expressive
  setup: null,
  audio: null, // the sample player
};

// the router in app.js calls this when the Voice-overs page opens
window.voiceShown = () => {
  if (!VO.info) loadVoice();
};

window.voiceHidden = () => {
  sampleRequest++;
  VO.audio?.pause();
  playing?.pause();
  closeTags();
};

// ---------- settings ----------
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
function nest(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let o = out;
    parts.slice(0, -1).forEach((p) => (o = o[p] = o[p] || {}));
    o[parts[parts.length - 1]] = v;
  }
  return out;
}
const presetOf = (id) => VO.info.presets.find((p) => p.id === id) || VO.info.presets[0];
const base = (k) => get(presetOf(VO.preset).settings, k);
const val = (k) => (k in VO.changes ? VO.changes[k] : base(k));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function setVal(k, v) {
  if (same(v, base(k))) delete VO.changes[k];
  else VO.changes[k] = v;
  save();
  renderAll();
}
function save() {
  try { localStorage.setItem('mrb.vo', JSON.stringify({ engine: VO.engine, expressive: VO.expressive, preset: VO.preset, changes: VO.changes, text: $('voText').value })); } catch {}
}

// ---------- voices ----------
const langOf = (voiceId) => VO.info.languages.find((l) => l.prefix === voiceId[0]) || VO.info.languages[0];
const voiceOf = (id) => VO.info.voices.find((v) => v.id === id);
function voiceLabel(id) {
  const v = voiceOf(id);
  const l = langOf(id);
  return `${v ? v.name : id} · ${l.name} · ${id[1] === 'f' ? 'female' : 'male'}`;
}
// "Heart · Calm narrator pacing": the Kokoro voice by its own name, and the pacing it reads with
function chosenName(presetId, voiceId) {
  const p = (VO.info && VO.info.presets.find((x) => x.id === presetId)) || null;
  const id = voiceId || (p && p.settings.voice);
  if (!id) return p ? p.name : '';
  const v = voiceOf(id);
  return `${v ? v.name : id}${p ? ` · ${p.name} pacing` : ''}`;
}
function effectiveLang() {
  const l = val('lang');
  return l && l !== 'auto' ? l : langOf(val('voice')).code;
}

async function playSample(btn, body, endpoint) {
  if (VO.audio && !VO.audio.paused && btn.hasAttribute('data-playing')) {
    VO.audio.pause();
    return;
  }
  if (btn.hasAttribute('data-loading')) return;
  const request = ++sampleRequest;
  VO.audio?.pause();
  document.querySelectorAll('.voice-row [data-playing]').forEach((b) => { delete b.dataset.playing; b.setAttribute('aria-label', b.dataset.label); });
  btn.dataset.loading = '';
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-label', 'Preparing the sample');
  $('voError').textContent = '';
  try {
    const r = await api(endpoint, body);
    if (request !== sampleRequest || !btn.isConnected) return;
    if (!VO.audio) VO.audio = new Audio();
    playing?.pause();
    VO.audio.src = r.url;
    VO.audio.onended = VO.audio.onpause = () => { delete btn.dataset.playing; btn.setAttribute('aria-label', btn.dataset.label); };
    await VO.audio.play();
    btn.dataset.playing = '';
    btn.setAttribute('aria-label', 'Pause the sample');
  } catch (e) {
    $('voError').textContent = e.message;
  } finally {
    delete btn.dataset.loading;
    btn.removeAttribute('aria-busy');
    if (!btn.hasAttribute('data-playing')) btn.setAttribute('aria-label', btn.dataset.label);
  }
}
let sampleRequest = 0;
function playButton(label, body, endpoint = '/api/voice/sample') {
  const b = el('button', { class: 'play', type: 'button', 'aria-label': label, 'data-label': label, title: label });
  b.append(icon('play'), icon('pause'));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    playSample(b, body(), endpoint);
  });
  return b;
}

// One list for the language chosen on top: the recommended voices first. Search narrows it.
function voiceRow({ on, name, tag, about, sample, pick, key, endpoint }) {
  const row = el('li', { class: 'voice-row' + (on ? ' on' : ''), role: 'radio', title: name + ' · ' + about, 'aria-checked': String(on), tabindex: on ? '0' : '-1', 'data-key': key });
  row.append(
    icon('waves'),
    el('span', { class: 'voice-text' }, el('span', { class: 'voice-name' }, el('bdi', {}, name), tag ? el('span', { class: 'voice-tag', title: tag, 'aria-label': tag }, icon('check')) : null), el('span', { class: 'voice-about' }, about)),
    ...(sample ? [playButton('Play a sample of ' + name, sample, endpoint)] : [])
  );
  row.addEventListener('click', pick);
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), pick());
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...document.querySelectorAll('#voVoices .voice-row:not([hidden])')];
      const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
    }
  });
  return row;
}

function renderVoiceList() {
  // the pacing: how the chosen voice reads (pauses, speed, line by line or sentence by sentence)
  const pace = $('voPacing');
  if (!pace.options.length) pace.replaceChildren(...VO.info.presets.map((p) => el('option', { value: p.id }, p.name)));
  pace.value = VO.preset;
  $('voPacingAbout').textContent = presetOf(VO.preset).about;
  // the language menu: starts at the chosen voice's language
  languageOptions(VO.info.languages.filter((l) => VO.info.voices.some((v) => v.id[0] === l.prefix)), langOf(val('voice')).code);
  const lang = langOf(val('voice'));
  const rows = [];
  // Kokoro's voices by their own names, the clearest first
  const list = VO.info.voices.filter((v) => v.id[0] === lang.prefix).sort((x, y) => (y.best ? 1 : 0) - (x.best ? 1 : 0));
  for (const v of list) {
    const sex = v.id[1] === 'f' ? 'Female' : 'Male';
    rows.push(voiceRow({
      key: [v.name, v.id, sex, v.best ? 'recommended clearest' : ''].join(' '),
      on: val('voice') === v.id,
      name: v.name,
      tag: v.best ? 'Recommended' : '',
      about: `${sex} · ${v.id}`,
      sample: () => ({ preset: VO.preset, changes: nest({ ...VO.changes, voice: v.id, lang: 'auto' }) }),
      pick: () => {
        delete VO.changes.lang;
        setVal('voice', v.id);
        $('voVoices').querySelector('.on')?.focus({ preventScroll: true });
      },
    }));
  }
  $('voVoices').replaceChildren(...rows);
  filterVoices();
  const on = document.querySelector('#voVoices .voice-row.on');
  if (on && !VO.listShown) {
    VO.listShown = true;
    on.scrollIntoView({ block: 'nearest' });
  }

}
function filterVoices() {
  const q = $('voSearch').value.trim().toLowerCase();
  const rows = [...$('voVoices').children];
  for (const row of rows) row.hidden = !!q && !row.dataset.key.toLowerCase().includes(q);
  const first = rows.find(row => !row.hidden && row.classList.contains('on')) || rows.find(row => !row.hidden);
  $('voNone').hidden = !!first;
  for (const row of rows) row.tabIndex = row === first ? 0 : -1;
}

// ---------- advanced ----------
// [key, label, kind, options]. kind: range (min,max,step,unit) | num | toggle | select | voice
const SECS = { unit: 's', step: 0.01, min: 0, max: 10 };
const ADV = [
  ['Voice', [
    ['speed', 'Speed', 'range', { min: 0.5, max: 2, step: 0.01, unit: '×' }],
    ['lang', 'Pronounce words as', 'select', () => [['auto', "the voice's own language"], ...VO.info.languages.map((l) => [l.code, l.name])]],
    ['blend.on', 'Blend in a second voice', 'toggle'],
    ['blend.voice', 'Second voice', 'voice', { when: 'blend.on' }],
    ['blend.mix', 'Share of the second voice', 'range', { min: 0, max: 1, step: 0.05, unit: '%', when: 'blend.on' }],
  ]],
  ['Reading and pauses', [
    ['split', 'Read the script', 'select', () => [['lines', 'line by line'], ['sentences', 'sentence by sentence']]],
    ['pauses.sentence', 'Pause after each sentence (or line)', 'num', SECS],
    ['pauses.number', 'Extra pause after a line with a number', 'num', SECS],
    ['pauses.question', 'Extra pause after a question', 'num', SECS],
    ['pauses.paragraph', 'Extra pause between paragraphs (an empty line)', 'num', SECS],
    ['pauses.end', 'Silence at the very end', 'num', SECS],
    ['pauses.lineVary', 'Vary the pause a little (0.20 to 0.30 s), like a radio host', 'toggle'],
    ['pace.on', 'Say questions and exclamations a little faster', 'toggle'],
    ['pace.question', 'How much faster', 'range', { min: 1, max: 1.2, step: 0.005, unit: '×', when: 'pace.on' }],
    ['kokoro.trim', 'Let the voice cut its own silence at the ends', 'toggle'],
    ['kokoro.sentencePause', 'Pause between sentences inside a line', 'num', SECS],
    ['kokoro.clausePause', 'Pause at commas inside a line', 'num', SECS],
    ['kokoro.continuous', 'Smooth joins across long lines (slower)', 'toggle'],
  ]],
  ['Pronunciation', 'pron'],
  ['Sound', [
    ['edges.on', 'Tidy the start and end of every line', 'toggle'],
    ['edges.threshold', 'Counts as sound above', 'num', { step: 0.001, min: 0, max: 0.1, when: 'edges.on' }],
    ['edges.before', 'Keep before the first sound', 'num', { ...SECS, step: 0.005, when: 'edges.on' }],
    ['edges.after', 'Keep after the last sound', 'num', { ...SECS, step: 0.005, when: 'edges.on' }],
    ['edges.fade', 'Fade in and out', 'num', { ...SECS, step: 0.001, when: 'edges.on' }],
    ['closeGaps.on', 'Close the small stops between words', 'toggle'],
    ['closeGaps.keepBelow', 'Leave stops shorter than', 'num', { ...SECS, step: 0.005, when: 'closeGaps.on' }],
    ['closeGaps.shortUpTo', 'Shorten stops up to', 'num', { ...SECS, step: 0.005, when: 'closeGaps.on' }],
    ['closeGaps.shortTo', '…down to', 'num', { ...SECS, step: 0.005, when: 'closeGaps.on' }],
    ['closeGaps.longest', 'Longest pause inside a line', 'num', { ...SECS, step: 0.01, when: 'closeGaps.on' }],
    ['breaths.on', 'Breathe in before long lines', 'toggle'],
    ['breaths.minWords', 'Lines of at least (words)', 'num', { step: 1, min: 1, max: 100, when: 'breaths.on' }],
    ['breaths.length', 'Breath length', 'num', { ...SECS, when: 'breaths.on' }],
    ['breaths.level', 'Breath loudness', 'num', { step: 0.0001, min: 0, max: 0.05, when: 'breaths.on' }],
    ['rumble.on', 'Take away low rumble', 'toggle'],
    ['rumble.hz', 'Below (Hz)', 'num', { step: 5, min: 20, max: 400, when: 'rumble.on' }],
    ['room.on', 'Small room echo', 'toggle'],
    ['room.wet', 'Echo amount', 'num', { step: 0.01, min: 0, max: 1, when: 'room.on' }],
    ['room.delay', 'Echo delay', 'num', { ...SECS, step: 0.001, when: 'room.on' }],
    ['room.decay', 'Echo fade', 'num', { ...SECS, step: 0.001, when: 'room.on' }],
    ['level.on', 'Even out the loudness', 'toggle'],
    ['level.target', 'Speech level', 'num', { step: 0.005, min: 0.01, max: 0.5, when: 'level.on' }],
    ['peak.on', 'Limit the loudest peaks', 'toggle'],
    ['peak.limit', 'Peak limit', 'num', { step: 0.01, min: 0.1, max: 1, when: 'peak.on' }],
  ]],
  ['Background music', [
    ['music.on', 'Add the presentation music under the voice', 'toggle'],
    ['music.under', 'Music level under speech (dB)', 'num', { step: 1, min: -60, max: 0, when: 'music.on' }],
    ['music.pause', 'Music level in pauses (dB)', 'num', { step: 1, min: -60, max: 0, when: 'music.on' }],
    ['music.intro', 'Music before the voice starts', 'num', { ...SECS, step: 0.5, max: 60, when: 'music.on' }],
    ['music.tail', 'Music after the voice ends', 'num', { ...SECS, step: 0.5, max: 60, when: 'music.on' }],
  ]],
  ['File', [
    ['export.format', 'Download as', 'select', () => [['mp3', 'MP3 (and WAV)'], ['m4a', 'M4A (and WAV)'], ['wav', 'WAV only']]],
    ['export.highpass', 'Cut below (Hz, 0 = off)', 'num', { step: 5, min: 0, max: 400 }],
    ['export.loudnorm', 'Make it the standard loudness', 'toggle'],
    ['export.I', 'Loudness (LUFS)', 'num', { step: 1, min: -40, max: -5, when: 'export.loudnorm' }],
    ['export.TP', 'True peak (dB)', 'num', { step: 0.5, min: -9, max: 0, when: 'export.loudnorm' }],
    ['export.LRA', 'Loudness range', 'num', { step: 1, min: 1, max: 20, when: 'export.loudnorm' }],
  ]],
];

const fmtNum = (v, o) => (o && o.unit === '%' ? Math.round(v * 100) + '%' : o && o.unit === '×' ? Number(v).toFixed(2) + '×' : String(v));

function control([k, label, kind, o]) {
  const changed = k in VO.changes;
  const off = o && o.when && !val(o.when);
  const row = el('div', { class: 'adv-row' + (changed ? ' changed' : '') + (off ? ' off' : '') + (kind === 'toggle' ? ' is-toggle' : '') });
  const id = 'adv-' + k.replace(/\./g, '-');
  const v = val(k);
  let input;
  if (kind === 'toggle') {
    input = el('input', { type: 'checkbox', id, role: 'switch' });
    input.checked = !!v;
    input.addEventListener('change', () => setVal(k, input.checked));
  } else if (kind === 'select' || kind === 'voice') {
    const opts = kind === 'voice' ? VO.info.voices.map((x) => [x.id, voiceLabel(x.id)]) : o();
    input = el('select', { id }, ...opts.map(([value, text]) => el('option', { value }, text)));
    input.value = v;
    input.addEventListener('change', () => setVal(k, input.value));
  } else if (kind === 'range') {
    const r = el('input', { type: 'range', id, min: o.min, max: o.max, step: o.step });
    r.value = v;
    const out = el('output', { for: id }, fmtNum(v, o));
    r.addEventListener('input', () => (out.textContent = fmtNum(Number(r.value), o)));
    r.addEventListener('change', () => setVal(k, Number(r.value)));
    input = el('span', { class: 'range' }, r, out);
  } else {
    const n = el('input', { type: 'number', id, min: o.min, max: o.max, step: o.step, inputmode: 'decimal' });
    n.value = v;
    n.addEventListener('change', () => n.value !== '' && !isNaN(Number(n.value)) && setVal(k, Number(n.value)));
    input = el('span', { class: 'num' }, n, el('span', { class: 'unit', 'aria-hidden': 'true' }, o.unit === 's' ? 's' : ''));
  }
  if (off) {
    const target = input.matches && input.matches('input,select') ? input : input.querySelector('input,select');
    if (target) target.disabled = true;
  }
  row.append(el('label', { for: id }, label), input);
  const reset = el('button', { class: 'reset', type: 'button', title: `Back to ${fmtNum(base(k), o)}`, 'aria-label': `Reset ${label}` }, icon('refresh'));
  reset.hidden = !changed;
  reset.addEventListener('click', () => setVal(k, base(k)));
  row.append(reset);
  return row;
}

function pronEditor() {
  const box = el('div', { class: 'pron' });
  const lists = [
    ['spellings', 'Say a word differently', ['Written', 'Say it as'], 2],
    ['names', 'Names, as sounds (English voices)', ['Name', 'American sounds', 'British sounds'], 3],
  ];
  for (const [k, title, heads, n] of lists) {
    const rows = val(k) || [];
    const changed = k in VO.changes;
    const t = el('div', { class: 'pron-list' + (changed ? ' changed' : '') });
    t.append(el('div', { class: 'pron-title' }, title, changed ? el('button', { class: 'reset', type: 'button', 'aria-label': 'Reset ' + title, onclick: () => setVal(k, base(k)) }, icon('refresh')) : null));
    const grid = el('div', { class: 'pron-grid', style: `--cols:${n}` }, ...heads.map((h) => el('span', { class: 'pron-h' }, h)), el('span'));
    rows.forEach((r, i) => {
      for (let c = 0; c < n; c++) {
        const inp = el('input', { type: 'text', value: r[c] || '', 'aria-label': heads[c], spellcheck: 'false' });
        inp.addEventListener('change', () => {
          const copy = rows.map((x) => [...x]);
          copy[i][c] = inp.value;
          setVal(k, copy);
        });
        grid.append(inp);
      }
      grid.append(el('button', { class: 'reset', type: 'button', 'aria-label': 'Remove', onclick: () => setVal(k, rows.filter((_, j) => j !== i)) }, icon('close')));
    });
    t.append(grid, el('button', { class: 'small', type: 'button', onclick: () => setVal(k, [...rows.map((x) => [...x]), Array(n).fill('')]) }, 'Add one'));
    box.append(t);
  }
  return box;
}

// a switch and the settings it controls stay together
function clusters(items) {
  const out = [];
  for (const it of items) {
    const parent = it[3] && typeof it[3] === 'object' && it[3].when;
    const last = out[out.length - 1];
    if (parent && last && last.some((x) => x[0] === parent)) last.push(it);
    else out.push([it]);
  }
  return out;
}

function renderAdvanced() {
  const body = $('voAdvBody');
  const open = new Set([...body.querySelectorAll('details[open]')].map((d) => d.dataset.group));
  const focus = document.activeElement && document.activeElement.id;
  body.replaceChildren(
    ...ADV.map(([group, items]) => {
      const keys = items === 'pron' ? ['spellings', 'names'] : items.map((x) => x[0]);
      const n = keys.filter((k) => k in VO.changes).length;
      const d = el('details', { class: 'adv-group', 'data-group': group });
      // speed and pauses are what people tune most: open from the start
      if (open.has(group) || (!body.dataset.ready && (group === 'Voice' || group === 'Reading and pauses'))) d.open = true;
      d.append(el('summary', {}, group, n ? el('span', { class: 'adv-count' }, `${n} changed`) : null));
      d.append(items === 'pron' ? pronEditor() : el('div', { class: 'adv-rows' }, ...clusters(items).map((c) => el('div', { class: 'adv-cluster' + (c.length > 1 ? ' many' : '') }, ...c.map(control)))));
      return d;
    })
  );
  body.dataset.ready = '1';
  if (focus && $(focus)) $(focus).focus();
  const n = Object.keys(VO.changes).filter((k) => k !== 'voice').length;
  $('voAdvNote').textContent = n ? `${plural(n, 'change')} from ${presetOf(VO.preset).name}` : '';
  $('voResetAll').disabled = !Object.keys(VO.changes).length;
}

function renderCount() {
  const t = $('voText').value.trim();
  const said = t.replace(/\[[^\]]*\]/g, ' ').trim(); // tags are not words
  const words = said ? said.split(/\s+/).length : 0;
  const speed = VO.info && !isExpressive() ? Number(val('speed')) || 1 : 1;
  const sec = (words / (150 * (speed / 0.94))) * 60; // the presentation runs about 140-150 words a minute at 0.94
  $('voCount').textContent = words ? `${plural(words, 'word')} · about ${length(Math.max(1, sec))}` : '0 words';
  updateCreateButton();

}

// Japanese and Chinese need a language pack once (Kokoro's own pronunciation rules)
function extraKeyFor(lang) {
  const e = VO.info && VO.info.extras;
  if (!e) return null;
  return Object.keys(e).find((k) => e[k].langs.includes(lang) && !e[k].installed) || null;
}
function renderExtra(state) {
  const box = $('voExtra');
  if (isExpressive()) { box.hidden = true; return; }
  const key = extraKeyFor(effectiveLang());
  const s = state || VO.extraState;
  const busy = !!(s && s.status === 'running');
  box.hidden = !key && !busy;
  updateCreateButton();
  if (box.hidden) return;
  const k = busy ? s.key : key;
  const x = VO.info.extras[k];
  const kids = [el('p', { class: 'module-text' }, busy ? `Adding ${x.name}: ${s.step || 'starting…'}` : `${x.name} voices need one more download (about ${x.mb} MB), once, so they pronounce words properly.`)];
  if (s && s.status === 'error' && !busy) kids.push(el('p', { class: 'tx-error' }, s.error));
  if (busy) kids.push(el('div', { class: 'tx-progress', 'data-phase': 'loading' }, el('div', { class: 'tx-track', role: 'progressbar', 'aria-label': 'Adding ' + x.name }, el('span'))));
  else
    kids.push(
      el('button', {
        class: 'small primary',
        type: 'button',
        onclick: () =>
          api('/api/voice/extra', { key: k })
            .then((r) => { VO.extraState = r; renderExtra(r); })
            .catch((e) => ($('voError').textContent = e.message)),
      }, `Add ${x.name}`)
    );
  box.replaceChildren(...kids);
}

function renderAll() {
  if (!VO.info || !VO.info.presets) return;
  const expressive = isExpressive();
  document.querySelectorAll('#voPanel [data-engine]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.engine === VO.engine)));
  $('voEngineText').textContent = expressive ? 'Expressive' : 'Standard';
  $('voStandard').hidden = expressive;
  $('voInstall').hidden = !expressive || !!VO.catalog?.installed;
  $('voPicker').hidden = expressive && !VO.catalog?.installed;
  $('voAdd').hidden = !expressive;
  $('voStrength').hidden = !expressive || !expressiveLanguage()?.intensity;
  $('voSearch').parentElement.hidden = expressive && (VO.catalog?.voices.length || 0) <= 6;
  $('voVoiceCaption').textContent = expressive ? 'Available voices' : 'Ready voices';
  $('voInsert').disabled = expressive && !VO.catalog?.installed;
  $('voGo').hidden = expressive && !VO.catalog?.installed;
  renderSetup(VO.standardSetup);
  renderExtra();
  if (expressive) {
    renderDownload();
    if (VO.catalog?.installed) renderExpressiveVoices();
    $('voText').dir = expressiveLanguage()?.rtl ? 'rtl' : 'ltr';
    $('voText').lang = VO.expressive.lang;
    $('voSummary').textContent = VO.catalog?.installed
      ? [VO.catalog.voices.find(v => v.id === VO.expressive.voice)?.name, expressiveLanguage()?.name].filter(Boolean).join(' · ')
      : VO.catalog ? 'Expressive needs a download' : '';
  } else {
    renderVoiceList();
    renderAdvanced();
    $('voSummary').textContent = chosenName(VO.preset, val('voice'));
    $('voText').dir = 'auto';
    $('voText').removeAttribute('lang');
  }
  renderCount();
}

// ---------- setup (first run) ----------
function renderSetup(setup) {
  const box = $('voSetup');
  const i = VO.info;
  const needsModel = i && i.needs && i.needs.includes('model');
  const needsEngine = i && i.needs && i.needs.includes('engine');
  box.hidden = isExpressive() || !(needsModel || needsEngine);
  document.body.toggleAttribute('data-vo-locked', !box.hidden);
  if (box.hidden) return;
  const [n, u] = bytes(i.downloadBytes);
  $('voSetupTitle').textContent = needsEngine ? 'One more step to set up' : 'Get the voices';
  $('voSetupText').textContent = needsEngine
    ? 'The voice engine is not installed on this computer yet. Close this window and open the app again with "ICAIRE Echo"; it installs it for you.'
    : `The voices are one download of ${n} ${u}, once. After that everything works without the internet.`;
  $('voSetupBtn').hidden = needsEngine || (setup && setup.status === 'running');
  const prog = $('voSetupProg');
  prog.hidden = !setup || setup.status !== 'running';
  if (setup && setup.status === 'running') {
    const [g, gu] = bytes(setup.got);
    $('voSetupBar').parentElement.setAttribute('aria-valuenow', Math.floor(setup.percent));
    $('voSetupPct').textContent = Math.floor(setup.percent) + '%';
    $('voSetupLabel').textContent = `Downloading the voices: ${g} ${gu} of ${n} ${u}`;
    $('voSetupBar').style.transform = `scaleX(${(setup.percent / 100).toFixed(4)})`;
  }
  if (setup && setup.status === 'error') $('voSetupText').textContent = 'The download stopped: ' + setup.error + ' Press the button to try again.';
}

// ---------- making it ----------
function renderJob(j) {
  const prog = $('voProg');
  const active = j && !j.sample && ['loading', 'running', 'encoding'].includes(j.status);
  prog.hidden = !active;
  $('voSummary').hidden = !!active;
  if (active) {
    $('voPct').textContent = j.status === 'loading' ? '…' : Math.floor(j.percent) + '%';
    const phase = j.status === 'loading' ? 'Starting the voice…'
      : j.status === 'encoding' ? 'Saving the file…' : `Reading line ${j.done} of ${j.total}`;
    $('voLabel').textContent = phase + (j.etaSec != null ? ` · about ${mmss(j.etaSec)} left` : '');
    if (j.status === 'loading') $('voBar').parentElement.removeAttribute('aria-valuenow');
    else $('voBar').parentElement.setAttribute('aria-valuenow', Math.floor(j.percent || 0));
    $('voBar').style.transform = j.status === 'loading' ? '' : `scaleX(${(j.percent / 100).toFixed(4)})`;
    prog.dataset.phase = j.status;
  }
  const prev = VO.job;
  VO.job = j;
  updateCreateButton();
  if (!j || j.sample) return;
  if (j.status === 'done' && (!prev || prev.status !== 'done' || prev.id !== j.id)) {
    if (VO.info) loadVoiceovers(j.id);
  }
  if (j.status === 'error' && (!prev || prev.status !== 'error')) showError(j.error);
}

function downloads(id, files) {
  const order = ['voice.mp3', 'voice.m4a', 'voice.wav'];
  return files
    .slice()
    .sort((a, b) => order.indexOf(a.name || a) - order.indexOf(b.name || b))
    .map((f) => {
      const name = f.name || f;
      const ext = name.split('.').pop().toUpperCase();
      return el('a', { class: 'small dl', href: `/vo/${id}/${name}?download`, download: '', title: `Download the ${ext} file` + (f.bytes ? ` (${bytes(f.bytes).join(' ')})` : '') }, icon('download'), ext);
    });
}

function showResult(j) {
  const box = $('voResult');
  playing?.pause();
  const files = j.files.map(f => f.name);
  const main = files.find(f => f !== 'voice.wav') || 'voice.wav';
  $('voPlayer').replaceChildren(meterPlayer(`/vo/${j.id}/${main}`, j.duration));
  $('voResultMeta').textContent = `${length(j.duration)} · ${takeVoice(j)}`;
  $('voResultAct').replaceChildren(...downloads(j.id, j.files),
    el('button', { class: 'small', type: 'button', title: SHOW_IN, 'aria-label': SHOW_IN, onclick: () => api('/api/vo-open/' + j.id).catch(e => toast(e.message)) }, icon('files')),
    el('button', { class: 'small quiet-danger', type: 'button', title: 'Delete', 'aria-label': 'Delete this voice-over', onclick: async () => {
      if (!await confirmBox({ title: 'Delete this voice-over?', text: 'Its sound files and script are removed from this computer.', ok: 'Delete' })) return;
      try {
        await api('/api/vo-delete/' + j.id);
        playing?.pause();
        box.hidden = true;
        loadVoiceovers();
      } catch (e) { toast(e.message); }
    } }, icon('trash')));
  box.title = j.preview;
  box.dataset.id = j.id;
  box.hidden = false;
}

function showError(raw) {
  const box = $('voError');
  const plain = /needs one more download/.test(raw || '')
    ? raw
    : /not downloaded/.test(raw || '')
      ? 'The voices are not on this computer yet. Press "Download the voices" in the voice panel, then try again.'
      : /not installed/.test(raw || '')
        ? 'The voice engine is not installed on this computer yet. Close this window, open the app again with "ICAIRE Echo" (it installs it), then try again.'
        : 'The voice-over could not be made. Try again; if it keeps happening, try a shorter script or another voice.';
  box.replaceChildren(plain);
  if (raw && plain !== raw) box.append(el('details', { class: 'err-details' }, el('summary', {}, 'Details'), el('code', {}, raw)));
}

async function create() {
  $('voError').textContent = '';
  const text = $('voText').value.trim();
  if (!text) {
    $('voError').textContent = 'Type or paste the script first.';
    $('voText').focus();
    return;
  }
  VO.audio?.pause();
  playing?.pause();
  $('voResult').hidden = true;
  highlightTake();
  ++sampleRequest;
  VO.submitting = true;
  updateCreateButton();
  try {
    const changes = nest(VO.changes);
    if (isExpressive()) Object.assign(changes, { engine: VO.engine, expressive: { ...VO.expressive } });
    const j = await api('/api/voice/generate', { text, preset: VO.preset, changes });
    renderJob(j);
  } catch (e) {
    if (isExpressive() && /not downloaded/.test(e.message)) await refreshExpressive();
    $('voError').textContent = e.message;
  } finally {
    VO.submitting = false;
    updateCreateButton();
  }
}

// ---------- player: the console's meter window instead of the browser's grey audio bar ----------
let playing = null;
const waveformCache = new Map();
function takePeaks(url) {
  if (!waveformCache.has(url)) {
    const decode = async () => {
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 1, 24000);
      const data = (await ctx.decodeAudioData(buf)).getChannelData(0);
      const n = 400;
      const step = Math.max(1, Math.floor(data.length / n));
      const peaks = Array.from({ length: n }, (_, i) => {
        let s = 0;
        for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) s += data[j] * data[j];
        return Math.sqrt(s / step);
      });
      const top = Math.max(...peaks) || 1;
      return peaks.map((x) => x / top);
    };
    waveformCache.set(url, decode().catch(() => []));
  }
  return waveformCache.get(url);
}
const takeObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const button = entry.target;
    takeObserver.unobserve(button);
    takePeaks(button.dataset.audio).then(peaks => {
      if (button.isConnected) {
        button.querySelector('.wave-graphic').replaceWith(waveGraphic({ peaks: peaks.filter((_, i) => i % 6 === 0) }));
      }
    });
  }
});

function meterPlayer(url, duration) {
  const audio = new Audio();
  audio.preload = 'none';
  audio.src = url;
  const btn = el('button', { class: 'play', type: 'button', 'aria-label': 'Play' }, icon('play'), icon('pause'));
  const canvas = el('canvas', { class: 'meter-canvas', tabindex: '0', role: 'slider', 'aria-label': 'Position', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(duration)), 'aria-valuenow': '0' });
  const time = el('span', { class: 'meter-time' }, `0:00 / ${mmss(duration)}`);
  const box = el('div', { class: 'meter-player' }, btn, el('div', { class: 'meter-window' }, canvas), time);
  let peaks = null;
  let loading = false;
  async function load() {
    if (peaks || loading) return;
    loading = true;
    try {
      peaks = await takePeaks(url);
    } catch {
      peaks = [];
    }
    draw();
  }
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W) return;
    if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const at = duration ? audio.currentTime / duration : 0;
    const bars = Math.max(20, Math.floor(W / 4));
    const mid = H / 2;
    const dim = css('--meter-off');
    const on = css('--meter-on');
    for (let i = 0; i < bars; i++) {
      const p = peaks && peaks.length ? peaks[Math.floor((i / bars) * peaks.length)] : 0.04;
      const h = Math.max(1, Math.sqrt(p) * (H / 2 - 3));
      c.fillStyle = i / bars < at ? on : dim;
      c.fillRect(i * 4 + 1, mid - h, 2, h * 2);
    }
    if (at > 0) {
      c.fillStyle = on;
      c.fillRect(Math.min(W - 2, at * W), 2, 2, H - 4);
    }
  }
  const tick = () => {
    time.textContent = `${mmss(audio.currentTime)} / ${mmss(duration)}`;
    canvas.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
    draw();
  };
  const setIcon = () => {
    btn.toggleAttribute('data-playing', !audio.paused);
    btn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    highlightTake();
  };
  btn.addEventListener('click', () => {
    if (audio.paused) {
      if (playing && playing !== audio) playing.pause();
      VO.audio?.pause();
      playing = audio;
      load();
      audio.play().catch(() => {});
    } else audio.pause();
  });
  audio.addEventListener('play', setIcon);
  audio.addEventListener('timeupdate', tick);
  audio.addEventListener('pause', setIcon);
  audio.addEventListener('ended', () => (setIcon(), tick()));
  const seekTo = (sec) => {
    audio.currentTime = Math.max(0, Math.min(duration, sec));
    load();
    tick();
  };
  canvas.addEventListener('click', (e) => seekTo(((e.offsetX || 0) / canvas.clientWidth) * duration));
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') seekTo(audio.currentTime + 5);
    else if (e.key === 'ArrowLeft') seekTo(audio.currentTime - 5);
    else if (e.key === ' ' || e.key === 'Enter') btn.click();
    else return;
    e.preventDefault();
  });
  // draw the shape when it comes into view, and again when the width changes
  new IntersectionObserver((es, o) => es.some((x) => x.isIntersecting) && (o.disconnect(), load())).observe(box);
  new ResizeObserver(draw).observe(canvas);
  return box;
}

// ---------- history ----------
async function loadVoiceovers(resultId) {
  let list;
  try {
    const r = await fetch('/api/voiceovers');
    if (!r.ok) throw new Error('Could not load your voice-overs.');
    list = await r.json();
  } catch (e) {
    $('voError').textContent = e.message;
    return;
  }
  takeObserver.disconnect();
  const result = list.find(v => v.id === resultId);
  if (result) showResult(result);
  $('voEmpty').hidden = list.length > 0;
  $('voList').replaceChildren(
    ...list.map((v) => {
      const when = new Date(v.id.replace(/^(\d{4}-\d\d-\d\d)-(\d\d)-(\d\d)-(\d\d)(?:-\d+)?$/, '$1T$2:$3:$4Z'));
      const title = v.preview.replace(/\[[^\]]*\]/g, '').trim() || v.id;
      const file = v.files.find(f => f.name !== 'voice.wav') || v.files[0];
      const facts = `${takeVoice(v)} · ${mmss(v.duration)}`;
      const btn = el('button', { class: 'vo-take', type: 'button', title: `${when.toLocaleString()} · ${facts} · ${plural(v.words, 'word')}\n${v.preview}`, 'data-id': v.id, 'data-audio': `/vo/${v.id}/${file.name}` },
        el('strong', { dir: 'auto' }, title), icon('play'), el('small', {}, facts), waveGraphic(null));
      takeObserver.observe(btn);
      btn.onclick = () => {
        if ($('voResult').hidden || $('voResult').dataset.id !== v.id) showResult(v);
        $('voPlayer').querySelector('button').click();
        highlightTake();
      };
      const li = el('li', {}, btn);
      return li;
    })
  );
  highlightTake();
}

function takeVoice(v) {
  return v.engine === 'expressive' ? v.voiceName : chosenName(v.preset, v.voice);
}
function highlightTake() {
  for (const button of $('voList').querySelectorAll('.vo-take')) {
    const selected = !$('voResult').hidden && button.dataset.id === $('voResult').dataset.id;
    const action = selected && playing && !playing.paused ? 'pause' : 'play';
    const glyph = button.querySelector('svg.i');
    if (!glyph.classList.contains('i-' + action)) glyph.replaceWith(icon(action));
    button.setAttribute('aria-current', String(selected));
    button.setAttribute('aria-label', (action === 'play' ? 'Play ' : 'Pause ') + button.querySelector('strong').textContent);
  }
}

// ---------- start ----------
async function loadVoice() {
  try {
    const response = await fetch('/api/voice');
    if (!response.ok) throw new Error();
    VO.info = await response.json();
  } catch {
    $('voError').replaceChildren('Could not load voices. ', el('button', { type: 'button', class: 'small', onclick: loadVoice }, 'Try again'));
    return;
  }
  try {
    const s = JSON.parse(localStorage.getItem('mrb.vo') || 'null');
    if (s) {
      if (VO.info.presets.some((p) => p.id === s.preset)) VO.preset = s.preset;
      VO.changes = s.changes || {};
      VO.engine = s.engine === 'expressive' ? 'expressive' : 'standard';
      Object.assign(VO.expressive, s.expressive);
      if (s.text && !$('voText').value) $('voText').value = s.text;
    }
  } catch {}
  $('voError').replaceChildren();
  renderSetup(null);
  renderAll();
  loadVoiceovers(VO.job?.status === 'done' && VO.job.id);
  refreshExpressive();
}

$('voText').addEventListener('input', () => {
  $('voError').textContent = '';
  renderCount();
  save();
});
$('voGo').addEventListener('click', create);
$('voSearch').addEventListener('input', filterVoices);
// a new pacing keeps the voice you chose
$('voPacing').addEventListener('change', () => {
  const voice = val('voice');
  VO.preset = $('voPacing').value;
  VO.changes = {};
  if (voice !== base('voice')) VO.changes.voice = voice;
  save();
  renderAll();
});
$('voLangPick').addEventListener('change', () => {
  $('voSearch').value = '';
  closeTags();
  VO.audio?.pause();
  if (isExpressive()) {
    VO.expressive.lang = $('voLangPick').value;
    save();
    renderAll();
  } else {
    const lang = VO.info.languages.find(l => l.code === $('voLangPick').value);
    const voices = VO.info.voices.filter(v => v.id[0] === lang.prefix);
    delete VO.changes.lang;
    setVal('voice', (voices.find(v => v.best) || voices[0]).id);
  }
  $('voVoices').scrollTop = 0;
});
$('voCancel').addEventListener('click', () => api('/api/voice/cancel').catch(() => {}));
$('voResetAll').addEventListener('click', () => {
  VO.changes = {};
  save();
  renderAll();
});
$('voSetupBtn').addEventListener('click', async () => {
  $('voSetupBtn').hidden = true;
  try {
    VO.standardSetup = await api('/api/voice/setup');
    renderSetup(VO.standardSetup);
  } catch (e) {
    $('voSetupText').textContent = e.message;
    $('voSetupBtn').hidden = false;
  }
});

// live updates come through app.js's event stream
window.onVoiceState = (data) => {
  if (data.voiceSetup && !same(data.voiceSetup, VO.standardSetup)) {
    VO.standardSetup = data.voiceSetup;
    renderSetup(data.voiceSetup);
    if (data.voiceSetup.status === 'done' && VO.info && VO.info.needs && VO.info.needs.length) {
      fetch('/api/voice?refresh').then((r) => r.json()).then((i) => { VO.info = i; renderSetup(null); renderAll(); });
    }
  }
  if (data.voiceExtra && !same(data.voiceExtra, VO.extraState)) {
    const was = VO.extraState && VO.extraState.status;
    VO.extraState = data.voiceExtra;
    if (VO.info && data.voiceExtra.status === 'done' && was !== 'done') fetch('/api/voice').then((r) => r.json()).then((i) => { VO.info = i; renderAll(); });
    else if (VO.info) renderExtra();
  }
  if (data.expressiveSetup && !same(data.expressiveSetup, VO.setup)) applyDownload(data.expressiveSetup);
  if (data.voice && !same(data.voice, VO.job)) renderJob(data.voice);
};


// The setup snapshot and the voice job arrive independently on the same event stream.
const isExpressive = () => VO.engine === 'expressive';
const expressiveLanguage = () => VO.catalog?.languages.find(l => l.code === VO.expressive.lang);
const jobActive = () => VO.job && !VO.job.sample && ['loading', 'running', 'encoding'].includes(VO.job.status);

function updateCreateButton() {
  const available = VO.info && (isExpressive() ? VO.catalog?.installed
    : !document.body.hasAttribute('data-vo-locked') && !extraKeyFor(effectiveLang()));
  $('voGo').disabled = !available || VO.submitting || jobActive() || !$('voText').value.trim();
}

function languageOptions(languages, selected) {
  const select = $('voLangPick');
  if (select.dataset.engine !== VO.engine) {
    select.replaceChildren(...languages.map(l => el('option', { value: l.code }, l.name)));
    select.dataset.engine = VO.engine;
  }
  select.value = selected;
}

async function refreshExpressive() {
  try {
    const response = await fetch('/api/expressive');
    if (!response.ok) throw new Error('Could not load the Expressive voices.');
    VO.catalog = await response.json();
    VO.catalogError = null;
    VO.setup = VO.catalog.setup;
    const { defaults, voices } = VO.catalog;
    if (!expressiveLanguage()) VO.expressive.lang = defaults.lang;
    if (!voices.some(v => v.id === VO.expressive.voice)) VO.expressive.voice = defaults.voice;
    if (!Number.isFinite(VO.expressive.intensity)) VO.expressive.intensity = defaults.intensity;
    renderAll();
  } catch (e) {
    VO.catalogError = e.message;
    if (isExpressive()) renderDownload();
  }
}

function renderDownload() {
  if ($('voInstall').hidden) return;
  const s = VO.setup;
  const running = s?.status === 'running';
  const btn = $('voDownload');
  btn.disabled = !!VO.transferPending || (!VO.catalog && !VO.catalogError);
  btn.classList.toggle('primary', !running);
  btn.textContent = !VO.catalog && VO.catalogError ? 'Retry' : running ? 'Cancel download'
    : ['cancelled', 'error'].includes(s?.status) ? 'Resume download' : 'Download Expressive';
  $('voTransfer').hidden = !running;
  $('voTransfer').value = s?.percent || 0;
  $('voTransferText').textContent = !VO.catalog ? VO.catalogError || 'Checking Expressive…'
    : running ? `${Math.floor(s.percent)}% of ${bytes(s.total).join(' ')}`
    : s?.error || (s?.status === 'cancelled' ? 'Download cancelled.' : '');
}

function applyDownload(snapshot) {
  const previous = VO.setup?.status;
  VO.setup = snapshot;
  if (snapshot.status === 'done' && previous !== 'done' && VO.info) refreshExpressive();
  else renderDownload();
}

$('voDownload').onclick = async () => {
  if (!VO.catalog) return refreshExpressive();
  VO.transferPending = true;
  renderDownload();
  try {
    const before = VO.setup;
    const cancel = before?.status === 'running';
    const response = await api('/api/expressive/setup' + (cancel ? '/cancel' : ''));
    // A live update can arrive before the response to this button.
    if (VO.setup === before) applyDownload(response);
  } catch (e) {
    $('voError').textContent = e.message;
  } finally {
    VO.transferPending = false;
    renderDownload();
  }
};

document.querySelectorAll('#voPanel [data-engine]').forEach(b => {
  b.onclick = () => {
    if (!VO.info || VO.engine === b.dataset.engine) return;
    closeTags();
    VO.engine = b.dataset.engine;
    VO.audio?.pause();
    $('voSearch').value = '';
    $('voError').textContent = '';
    save();
    renderAll();
  };
});

// Languages with sample text in voice/expressive.json.
const sampleLanguages = new Set('en ar fr es de it pt hi tr ru zh ja'.split(' '));
function renderExpressiveVoices() {
  languageOptions(VO.catalog.languages, VO.expressive.lang);
  $('voIntensity').value = VO.expressive.intensity;
  const hasSample = expressiveLanguage()?.sample ?? sampleLanguages.has(VO.expressive.lang);
  const rows = VO.catalog.voices.map(v => {
    const about = v.own ? 'From a recording' : v.about || 'Ready voice';
    const sample = hasSample ? () => ({ voice: v.id, lang: VO.expressive.lang }) : null;
    const row = voiceRow({ on: v.id === VO.expressive.voice, name: v.name, key: v.name + ' ' + about, about,
      sample, endpoint: '/api/expressive/sample', pick: () => {
        VO.expressive.voice = v.id;
        save();
        renderAll();
        $('voVoices').querySelector('.on')?.focus({ preventScroll: true });
      } });
    if (v.own) {
      row.classList.add('own');
      row.append(el('button', { type: 'button', class: 'vo-remove', 'aria-label': 'Delete ' + v.name, onclick: async e => {
        e.stopPropagation();
        if (!await confirmBox({ title: 'Delete ' + v.name + '?', text: 'This removes the voice from this computer.', ok: 'Delete' })) return;
        try {
          const r = await api('/api/expressive/voices/remove', { id: v.id });
          VO.catalog.voices = r.voices;
          if (VO.expressive.voice === v.id) VO.expressive.voice = VO.catalog.defaults.voice;
          save();
          renderAll();
          $('voAdd').focus();
        } catch (error) { $('voError').textContent = error.message; }
      } }, icon('trash')));
    }
    return row;
  });
  $('voVoices').replaceChildren(...rows);
  filterVoices();
}
$('voIntensity').oninput = () => {
  VO.expressive.intensity = Number($('voIntensity').value);
  save();
};

// Keep the completed take with the history and playback controls in the rail.
$('voList').parentElement.append($('voResult'));
const closeResult = el('button', { type: 'button', class: 'small', 'aria-label': 'Close player', onclick: () => {
  playing?.pause();
  $('voResult').hidden = true;
  highlightTake();
  [...$('voList').querySelectorAll('button')].find(b => b.dataset.id === $('voResult').dataset.id)?.focus();
} }, icon('close'));
$('voResultMeta').after(closeResult);

const sounds = ['Laugh', 'Chuckle', 'Sigh', 'Gasp', 'Cough', 'Groan', 'Sniff', 'Shush', 'Clear throat'];
const moods = ['Angry', 'Happy', 'Sad', 'Excited', 'Surprised', 'Calm', 'Serious', 'Whisper', 'Shouting', 'Normal'];
const draft = $('voText');
const panel = $('voTags');
let queryStart = null;
function closeTags() {
  panel.hidden = true;
  queryStart = null;
  $('voInsert').setAttribute('aria-expanded','false');
}
function insertTag(group, item) {
  const start = queryStart ?? draft.selectionStart;
  const end = draft.selectionEnd;
  const selected = queryStart === null ? draft.value.slice(start,end) : '';
  let tag = item.toLowerCase();
  if (group === 'Pause') tag = 'pause '+item.replace('½','0.5').replace(' ','');
  if (group === 'Voice') tag = 'voice '+item;
  const mark = '['+tag+']';
  const wraps = group === 'Voice' || (selected && group === 'Mood');
  const text = wraps ? mark+selected+'[/'+tag.split(' ')[0]+']' : mark;
  closeTags();
  draft.focus({preventScroll:true});
  // A point cue goes before highlighted words. A mood or voice surrounds them.
  const replaceEnd = selected && !wraps ? start : end;
  const before = draft.value[start-1] || '';
  const after = draft.value[replaceEnd] || '';
  const leading = /\S/.test(before) ? ' ' : '';
  const trailing = /\s/.test(after) ? '' : ' ';
  draft.setRangeText(leading+text+trailing,start,replaceEnd,'end');
  if (after===' ') {
    const caret = draft.selectionEnd+1;
    draft.setSelectionRange(caret,caret);
  }
  if (group === 'Voice' && !selected) {
    const caret = start + leading.length + mark.length;
    draft.setSelectionRange(caret, caret);
  }
  draft.dispatchEvent(new Event('input',{bubbles:true}));
}
function positionTags() {
  if (panel.hidden) return;
  const anchor = $('voInsert').getBoundingClientRect();
  const card = document.querySelector('#viewVoice .script-card').getBoundingClientRect();
  const width = Math.min(480, card.width-16, innerWidth-16);
  panel.style.width = width+'px';
  panel.style.left = Math.max(8,Math.min(innerWidth-width-8,anchor.right-width))+'px';
  const below = innerHeight-anchor.bottom-12;
  const above = anchor.top-12;
  const up = below < panel.scrollHeight+2 && above > below;
  panel.style.maxHeight = Math.max(80,up ? above : below)+'px';
  panel.style.top = (up ? anchor.top-panel.offsetHeight-4 : anchor.bottom+4)+'px';
}
function openTags(query='') {
  const soundItems = isExpressive() ? (expressiveLanguage()?.sounds ? sounds : []) : ['Laugh','Sigh','Breath'];
  const groups = {Pause:['½ s','1 s','2 s','4 s'], Mood:isExpressive() ? [...moods, 'Scared', 'Sarcastic', 'Dramatic', 'Crying'] : moods, Sound:soundItems, Voice:(isExpressive() ? VO.catalog.voices : VO.info.voices).map(v => v.name)};
  const container = $('voTagGroups');
  container.replaceChildren();
  for (const [group,items] of Object.entries(groups)) {
    const matches = items.filter(item=>(group+' '+item).toLowerCase().includes(query.toLowerCase()));
    if (!matches.length) continue;
    const section = document.createElement('section');
    section.className = 'tag-group';
    const heading = document.createElement('h3');
    heading.textContent = group;
    section.append(heading);
    for (const item of matches) {
      const button = document.createElement('button');
      button.textContent = item;
      button.onclick = ()=>insertTag(group,item);
      section.append(button);
    }
    container.append(section);
  }
  $('voTagHint').textContent = !container.childElementCount ? 'No matching tags' :
    isExpressive() ? '' : 'Standard approximates moods and sounds.';
  panel.hidden = false;
  $('voInsert').setAttribute('aria-expanded','true');
  positionTags();
}
$('voInsert').onclick = ()=>{
  if (!panel.hidden) { closeTags(); draft.focus(); return; }
  if (!VO.info) return;
  openTags();
  panel.querySelector('button').focus({preventScroll:true});
};
draft.addEventListener('input',event=>{
  if ($('voInsert').disabled || !VO.info || event.isComposing) return;
  const at = draft.selectionStart-1;
  if (event.data==='[') queryStart = at;
  if (queryStart===null) return;
  const typed = draft.value.slice(queryStart,draft.selectionStart);
  if (/^\[[^\[\]\n/]*$/.test(typed)) openTags(typed.slice(1));
  else closeTags();
});
document.addEventListener('keydown',event=>{
  if (panel.hidden || event.isComposing) return;
  const buttons = [...panel.querySelectorAll('button')];
  if (event.key==='Escape') {
    event.preventDefault(); closeTags(); draft.focus({preventScroll:true}); return;
  }
  if (event.target===draft) {
    if (event.key==='Enter' && buttons.length) {
      event.preventDefault(); buttons[0].click();
    } else if (event.key==='ArrowDown' && buttons.length) {
      event.preventDefault(); buttons[0].focus();
    } else if (['ArrowLeft','ArrowRight','ArrowUp','Home','End','Tab'].includes(event.key)) closeTags();
    return;
  }
  if (!buttons.includes(event.target) || !event.key.startsWith('Arrow')) return;
  const column = event.target.parentElement;
  const items = [...column.querySelectorAll('button')];
  const row = items.indexOf(event.target);
  const adjacent = event.key==='ArrowRight' ? column.nextElementSibling : column.previousElementSibling;
  event.preventDefault();
  if (['ArrowRight','ArrowLeft'].includes(event.key)) {
    if (adjacent) adjacent.querySelectorAll('button')[Math.min(row,adjacent.childElementCount-2)].focus();
  } else items[(row+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
});
document.addEventListener('pointerdown',event=>{
  if (!panel.contains(event.target) && !$('voInsert').contains(event.target)) closeTags();
});
document.addEventListener('focusin',event=>{
  if (event.target===draft && queryStart!==null) return;
  if (!panel.contains(event.target) && event.target!==$('voInsert')) closeTags();
});
window.addEventListener('resize',positionTags);
document.addEventListener('scroll',positionTags,true);

// Each dialog opening owns its microphone request, tracks and recording.
const voiceDialog = $('voDialog');
let clipSession;
function releaseClip(session) {
  if (session.recorder?.state === 'recording') session.recorder.stop();
  session.stream?.getTracks().forEach(track => track.stop());
  clearInterval(session.timer);
}
function clipControls(session) {
  const busy = session.requesting || session.saving;
  const recording = session.recorder?.state === 'recording';
  $('voFile').disabled = busy || recording;
  const tooShort = recording && Date.now() - session.started < 10000;
  $('voRecord').disabled = busy || tooShort || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  $('voRecord').querySelector('span').textContent = recording ? 'Stop recording' : session.requesting ? 'Opening microphone…' : 'Record with microphone';
  $('voStore').disabled = busy || recording;
  $('voDismiss').disabled = !!session.saving;
}
function chooseClip(file, description) {
  clipSession.blob = file;
  $('voClip').textContent = description;
  $('voRecordError').textContent = '';
}
$('voAdd').onclick = () => {
  clipSession = {};
  $('voRecordForm').reset();
  chooseClip(null, '');
  $('voTimer').value = '';
  clipControls(clipSession);
  voiceDialog.showModal();
  $('voName').focus();
};
voiceDialog.addEventListener('cancel', e => { if (clipSession?.saving) e.preventDefault(); });
voiceDialog.addEventListener('close', () => {
  if (clipSession) releaseClip(clipSession);
  clipSession = null;
});
$('voDismiss').onclick = () => voiceDialog.close();
$('voFile').onchange = e => {
  const file = e.target.files[0];
  if (file) chooseClip(file, file.name);
  $('voTimer').value = '';
};
$('voDrop').ondragover = e => e.preventDefault();
$('voDrop').ondrop = e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || $('voFile').disabled) return;
  $('voFile').value = '';
  $('voTimer').value = '';
  chooseClip(file, file.name);
};
$('voRecord').onclick = async () => {
  const session = clipSession;
  if (session.recorder?.state === 'recording') {
    session.recorder.stop();
    return;
  }
  session.requesting = true;
  clipControls(session);
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (session !== clipSession || !voiceDialog.open) { releaseClip(session); return; }
    const recorder = new MediaRecorder(session.stream);
    const chunks = [];
    session.recorder = recorder;
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      releaseClip(session);
      if (session !== clipSession || !voiceDialog.open) return;
      const seconds = Math.min(30, Math.round((Date.now() - session.started) / 1000));
      chooseClip(new Blob(chunks, { type: recorder.mimeType }), 'Microphone recording · ' + mmss(seconds));
      $('voTimer').value = '';
      clipControls(session);
    };
    recorder.onerror = e => {
      releaseClip(session);
      if (session === clipSession) $('voRecordError').textContent = e.error?.message || 'The microphone stopped recording.';
    };
    $('voFile').value = '';
    chooseClip(null, '');
    session.started = Date.now();
    recorder.start();
    $('voTimer').value = '0:00';
    session.timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - session.started) / 1000);
      if (seconds >= 10 && $('voRecord').disabled) clipControls(session);
      $('voTimer').value = mmss(seconds);
      if (seconds >= 30 && recorder.state === 'recording') recorder.stop();
    }, 200);
  } catch (e) {
    releaseClip(session);
    if (session === clipSession) $('voRecordError').textContent = e.message;
  } finally {
    session.requesting = false;
    if (session === clipSession) clipControls(session);
  }
};
$('voRecordForm').onsubmit = async e => {
  e.preventDefault();
  const session = clipSession;
  if (!session.blob) {
    $('voRecordError').textContent = 'Choose a file or record your voice first.';
    return;
  }
  session.saving = true;
  clipControls(session);
  try {
    const query = new URLSearchParams({ name: $('voName').value.trim(), consent: $('voConsent').checked ? '1' : '0' });
    const response = await fetch('/api/expressive/voices?' + query, { method: 'POST', headers: { 'x-mrb': '1' }, body: session.blob });
    const voice = await response.json();
    if (!response.ok) throw new Error(voice.error);
    VO.catalog.voices.push(voice);
    VO.expressive.voice = voice.id;
    $('voSearch').value = '';
    save();
    renderAll();
    voiceDialog.close();
    $('voVoices').querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    $('voRecordError').textContent = error.message;
  } finally {
    session.saving = false;
    clipControls(session);
  }
};
