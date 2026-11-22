'use strict';
// The Voice-over tab: a script, a voice, one button. Every setting is under "Advanced settings".
// Uses the helpers from app.js ($, el, api, mmss, length, bytes, plural), which share the page's global scope.

const VO = {
  info: null, // /api/voice
  preset: 'presenter',
  changes: {}, // flat "a.b" -> value, on top of the preset
  job: null,
  lastDone: null,
  audio: null, // the sample player
};

// ---------- tabs ----------
function showTab() {
  const voice = location.hash === '#voice';
  $('tabTranscribe').hidden = voice;
  $('tabVoice').hidden = !voice;
  for (const [id, on] of [['tabBtnTranscribe', !voice], ['tabBtnVoice', voice]]) {
    $(id).setAttribute('aria-selected', String(on));
    $(id).tabIndex = on ? 0 : -1;
  }
  document.body.dataset.tab = voice ? 'voice' : 'transcribe';
  if (voice && !VO.info) loadVoice();
}
window.addEventListener('hashchange', showTab);
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  location.hash = location.hash === '#voice' ? '#transcribe' : '#voice';
  $(location.hash === '#voice' ? 'tabBtnVoice' : 'tabBtnTranscribe').focus();
});

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
  try { localStorage.setItem('mrb.vo', JSON.stringify({ preset: VO.preset, changes: VO.changes, text: $('voText').value })); } catch {}
}

// ---------- voices ----------
const langOf = (voiceId) => VO.info.languages.find((l) => l.prefix === voiceId[0]) || VO.info.languages[0];
const voiceOf = (id) => VO.info.voices.find((v) => v.id === id);
function voiceLabel(id) {
  const v = voiceOf(id);
  const l = langOf(id);
  return `${v ? v.name : id} · ${l.name} · ${id[1] === 'f' ? 'female' : 'male'}`;
}
function chosenName(presetId, voiceId) {
  const p = (VO.info && VO.info.presets.find((x) => x.id === presetId)) || null;
  if (!p) return voiceId ? voiceLabel(voiceId) : '';
  if (!voiceId || voiceId === p.settings.voice) return p.name;
  const v = voiceOf(voiceId);
  return `${v ? v.name : voiceId} (${langOf(voiceId).name}), ${p.name} settings`;
}
function effectiveLang() {
  const l = val('lang');
  return l && l !== 'auto' ? l : langOf(val('voice')).code;
}

async function playSample(btn, body) {
  if (VO.audio && !VO.audio.paused && btn.dataset.playing) {
    VO.audio.pause();
    return;
  }
  document.querySelectorAll('[data-playing]').forEach((b) => { delete b.dataset.playing; b.setAttribute('aria-label', b.dataset.label); });
  btn.dataset.loading = '';
  try {
    const r = await api('/api/voice/sample', body);
    if (!VO.audio) VO.audio = new Audio();
    VO.audio.src = r.url;
    VO.audio.onended = VO.audio.onpause = () => { delete btn.dataset.playing; btn.setAttribute('aria-label', btn.dataset.label); };
    await VO.audio.play();
    btn.dataset.playing = '';
    btn.setAttribute('aria-label', 'Stop the sample');
  } catch (e) {
    $('voError').textContent = e.message;
  } finally {
    delete btn.dataset.loading;
  }
}
function playButton(label, body) {
  const b = el('button', { class: 'play', type: 'button', 'aria-label': label, 'data-label': label, title: label });
  b.append(el('span', { class: 'play-icon', 'aria-hidden': 'true' }));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    playSample(b, body());
  });
  return b;
}

function renderPresets() {
  const box = $('voPresets');
  const custom = 'voice' in VO.changes;
  box.replaceChildren(
    ...VO.info.presets.map((p) => {
      const on = p.id === VO.preset && !custom;
      const card = el('div', { class: 'vo-preset' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), tabindex: on || (!custom ? p.id === VO.preset : p.recommended) ? '0' : '-1' });
      card.append(
        el('span', { class: 'key-top', 'aria-hidden': 'true' }, el('span', { class: 'led' }), p.recommended ? el('span', { class: 'ch' }, 'Recommended') : null),
        el('span', { class: 'vo-preset-name' }, p.name),
        el('span', { class: 'vo-preset-about' }, p.about),
        playButton(`Play a sample of ${p.name}`, () => ({ preset: p.id }))
      );
      const pick = () => {
        VO.preset = p.id;
        VO.changes = {};
        save();
        renderAll();
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      return card;
    })
  );
  const c = $('voCustom');
  c.hidden = !custom;
  if (custom) {
    c.replaceChildren(
      el('span', { class: 'led on', 'aria-hidden': 'true' }),
      el('span', {}, el('b', {}, voiceLabel(val('voice'))), el('span', { class: 'meta' }, ` with ${presetOf(VO.preset).name}'s settings`)),
      playButton('Play a sample of this voice', () => ({ preset: VO.preset, changes: nest(VO.changes) })),
      el('button', { class: 'key key-quiet key-sm', type: 'button', onclick: () => setVal('voice', base('voice')) }, `Back to ${presetOf(VO.preset).name}`)
    );
  }
}

function renderVoices() {
  const sel = $('voLang');
  const cur = langOf(val('voice')).code;
  if (!sel.options.length) {
    sel.replaceChildren(...VO.info.languages.map((l) => el('option', { value: l.code }, `${l.name}, ${plural(VO.info.voices.filter((v) => v.id[0] === l.prefix).length, 'voice')}`)));
    sel.value = cur;
    sel.addEventListener('change', () => {
      renderVoices();
      renderExtra();
    });
  }
  const lang = VO.info.languages.find((l) => l.code === sel.value) || langOf(val('voice'));
  const list = VO.info.voices.filter((v) => v.id[0] === lang.prefix).sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0));
  $('voVoices').replaceChildren(
    ...list.map((v) => {
      const on = val('voice') === v.id;
      const li = el('li', { class: 'vo-v' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), tabindex: '0' });
      li.append(
        el('span', { class: 'led', 'aria-hidden': 'true' }),
        el('span', { class: 'vo-v-name' }, v.name, v.best ? el('span', { class: 'best' }, 'clearest') : null),
        el('span', { class: 'meta' }, v.id[1] === 'f' ? 'female' : 'male'),
        playButton(`Play a sample of ${v.name}`, () => ({ preset: VO.preset, changes: nest({ ...VO.changes, voice: v.id, lang: 'auto' }) }))
      );
      const pick = () => {
        delete VO.changes.lang;
        setVal('voice', v.id);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      return li;
    })
  );
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
    ['pauses.sentence', 'Pause after each line', 'num', SECS],
    ['pauses.number', 'Extra pause after a line with a number', 'num', SECS],
    ['pauses.question', 'Extra pause after a question', 'num', SECS],
    ['pauses.paragraph', 'Extra pause at an empty line', 'num', SECS],
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
  const reset = el('button', { class: 'reset', type: 'button', title: `Back to ${fmtNum(base(k), o)}`, 'aria-label': `Reset ${label}` }, '↺');
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
    t.append(el('div', { class: 'pron-title' }, title, changed ? el('button', { class: 'reset', type: 'button', 'aria-label': 'Reset ' + title, onclick: () => setVal(k, base(k)) }, '↺') : null));
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
      grid.append(el('button', { class: 'reset', type: 'button', 'aria-label': 'Remove', onclick: () => setVal(k, rows.filter((_, j) => j !== i)) }, '×'));
    });
    t.append(grid, el('button', { class: 'key key-quiet key-sm', type: 'button', onclick: () => setVal(k, [...rows.map((x) => [...x]), Array(n).fill('')]) }, 'Add one'));
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
      if (open.has(group)) d.open = true;
      d.append(el('summary', {}, group, n ? el('span', { class: 'adv-count' }, `${n} changed`) : null));
      d.append(items === 'pron' ? pronEditor() : el('div', { class: 'adv-rows' }, ...clusters(items).map((c) => el('div', { class: 'adv-cluster' + (c.length > 1 ? ' many' : '') }, ...c.map(control)))));
      return d;
    })
  );
  if (focus && $(focus)) $(focus).focus();
  const n = Object.keys(VO.changes).filter((k) => k !== 'voice').length;
  $('voAdvNote').textContent = n ? `${plural(n, 'change')} from ${presetOf(VO.preset).name}` : '';
  $('voResetAll').disabled = !Object.keys(VO.changes).length;
}

function renderCount() {
  const t = $('voText').value.trim();
  const words = t ? t.split(/\s+/).length : 0;
  const speed = Number(val('speed')) || 1;
  const sec = (words / (150 * (speed / 0.94))) * 60; // the presentation runs about 140-150 words a minute at 0.94
  $('voCount').textContent = words ? `${plural(words, 'word')} · about ${length(Math.max(1, sec))}` : '';
  if (VO.info && VO.info.presets) $('voSummary').textContent = `${chosenName(VO.preset, val('voice'))}${words ? ` · about ${length(Math.max(1, sec))}` : ''}`;
}

// Japanese and Chinese need a language pack once (Kokoro's own pronunciation rules)
function extraKeyFor(lang) {
  const e = VO.info && VO.info.extras;
  if (!e) return null;
  return Object.keys(e).find((k) => e[k].langs.includes(lang) && !e[k].installed) || null;
}
function renderExtra(state) {
  const box = $('voExtra');
  const browsing = $('voMore').open ? $('voLang').value : null;
  const key = extraKeyFor(effectiveLang()) || (browsing && extraKeyFor(browsing));
  const s = state || VO.extraState;
  const busy = !!(s && s.status === 'running');
  box.hidden = !key && !busy;
  const blocking = !!extraKeyFor(effectiveLang());
  if (blocking && !$('voMore').open) $('voMore').open = true;
  $('voGo').disabled = blocking || !!(VO.job && ['loading', 'running', 'encoding'].includes(VO.job.status)) || document.body.hasAttribute('data-vo-locked');
  if (box.hidden) return;
  const k = busy ? s.key : key;
  const x = VO.info.extras[k];
  const kids = [el('p', { class: 'module-text' }, busy ? `Adding ${x.name}: ${s.step || 'starting…'}` : `${x.name} voices need one more download (about ${x.mb} MB), once, so they pronounce words properly.`)];
  if (s && s.status === 'error' && !busy) kids.push(el('p', { class: 'tx-error' }, s.error));
  if (busy) kids.push(el('div', { class: 'tx-progress', 'data-phase': 'loading' }, el('div', { class: 'tx-track', role: 'progressbar', 'aria-label': 'Adding ' + x.name }, el('span'))));
  else
    kids.push(
      el('button', {
        class: 'key key-primary key-sm',
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
  renderPresets();
  renderVoices();
  renderExtra();
  renderAdvanced();
  renderCount();
}

// ---------- setup (first run) ----------
function renderSetup(setup) {
  const box = $('voSetup');
  const i = VO.info;
  const needsModel = i && i.needs && i.needs.includes('model');
  const needsEngine = i && i.needs && i.needs.includes('engine');
  box.hidden = !(needsModel || needsEngine);
  document.body.toggleAttribute('data-vo-locked', !box.hidden);
  if (box.hidden) return;
  const [n, u] = bytes(i.downloadBytes);
  $('voSetupTitle').textContent = needsEngine ? 'One more step to set up' : 'Get the voices';
  $('voSetupText').textContent = needsEngine
    ? 'The voice engine is not installed on this computer yet. Close this window and open the app again with "Start Meet Recorder"; it installs it for you.'
    : `The voices are one download of ${n} ${u}, once. After that everything works without the internet.`;
  $('voSetupBtn').hidden = needsEngine || (setup && setup.status === 'running');
  const prog = $('voSetupProg');
  prog.hidden = !setup || setup.status !== 'running';
  if (setup && setup.status === 'running') {
    const [g, gu] = bytes(setup.got);
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
  $('voGo').disabled = !!active || document.body.hasAttribute('data-vo-locked') || !!extraKeyFor(effectiveLang());
  if (active) {
    $('voPct').textContent = j.status === 'loading' ? '…' : Math.floor(j.percent) + '%';
    $('voLabel').textContent =
      j.status === 'loading' ? 'Starting the voice…' : j.status === 'encoding' ? 'Saving the file…' : `Reading line ${j.done} of ${j.total}` + (j.etaSec != null ? ` · about ${mmss(j.etaSec)} left` : '');
    $('voBar').style.transform = j.status === 'loading' ? '' : `scaleX(${(j.percent / 100).toFixed(4)})`;
    prog.dataset.phase = j.status;
  }
  const prev = VO.job;
  VO.job = j;
  if (!j || j.sample) return;
  if (j.status === 'done' && (!prev || prev.status !== 'done' || prev.id !== j.id)) {
    showResult(j);
    loadVoiceovers();
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
      return el('a', { class: 'key key-quiet key-sm', href: `/vo/${id}/${name}?download`, download: '' }, `Download ${ext}`, f.bytes ? el('span', { class: 'meta' }, ` ${bytes(f.bytes).join(' ')}`) : null);
    });
}

function showResult(j) {
  const box = $('voResult');
  const main = j.result.files.find((f) => f !== 'voice.wav') || 'voice.wav';
  $('voPlayer').replaceChildren(meterPlayer(`/vo/${j.id}/${main}`, j.result.duration));
  $('voResultMeta').textContent = `${length(j.result.duration)} · ${chosenName(j.preset || VO.preset, j.voice || val('voice'))}`;
  $('voResultAct').replaceChildren(...downloads(j.id, j.result.files), el('button', { class: 'key key-quiet key-sm', type: 'button', 'data-open-folder': '', onclick: () => api('/api/vo-open/' + j.id).catch(() => {}) }, typeof SHOW_IN !== 'undefined' ? SHOW_IN : 'Open folder'));
  box.hidden = false;
}

function showError(raw) {
  const box = $('voError');
  const plain = /needs one more download/.test(raw || '')
    ? raw
    : /not downloaded/.test(raw || '')
      ? 'The voices are not on this computer yet. Press "Download the voices" at the top of this page, then try again.'
      : /not installed/.test(raw || '')
        ? 'The voice engine is not installed on this computer yet. Close this window, open the app again with "Start Meet Recorder" (it installs it), then try again.'
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
  $('voResult').hidden = true;
  $('voGo').disabled = true;
  try {
    const j = await api('/api/voice/generate', { text, preset: VO.preset, changes: nest(VO.changes) });
    j.voice = val('voice');
    renderJob(j);
  } catch (e) {
    showError(e.message);
    $('voGo').disabled = false;
  }
}

// ---------- player: the console's meter window instead of the browser's grey audio bar ----------
let playing = null;
function meterPlayer(url, duration) {
  const audio = new Audio();
  audio.preload = 'none';
  audio.src = url;
  const btn = el('button', { class: 'play', type: 'button', 'aria-label': 'Play' }, el('span', { class: 'play-icon', 'aria-hidden': 'true' }));
  const canvas = el('canvas', { class: 'meter-canvas', tabindex: '0', role: 'slider', 'aria-label': 'Position', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(duration)), 'aria-valuenow': '0' });
  const time = el('span', { class: 'meter-time' }, `0:00 / ${mmss(duration)}`);
  const box = el('div', { class: 'meter-player' }, btn, el('div', { class: 'meter-window' }, canvas), time);
  let peaks = null;
  let loading = false;
  async function load() {
    if (peaks || loading) return;
    loading = true;
    try {
      const buf = await fetch(url).then((r) => r.arrayBuffer());
      const ctx = new (window.OfflineAudioContext || window.AudioContext)(1, 1, 24000);
      const data = (await ctx.decodeAudioData(buf)).getChannelData(0);
      const n = 400;
      const step = Math.max(1, Math.floor(data.length / n));
      peaks = Array.from({ length: n }, (_, i) => {
        let s = 0;
        for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) s += data[j] * data[j];
        return Math.sqrt(s / step);
      });
      const top = Math.max(...peaks) || 1;
      peaks = peaks.map((x) => x / top);
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
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
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
    if (!audio.paused) requestAnimationFrame(tick);
  };
  const setIcon = () => {
    btn.toggleAttribute('data-playing', !audio.paused);
    btn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  };
  btn.addEventListener('click', () => {
    if (audio.paused) {
      if (playing && playing !== audio) playing.pause();
      playing = audio;
      load();
      audio.play().catch(() => {});
    } else audio.pause();
  });
  audio.addEventListener('play', () => (setIcon(), requestAnimationFrame(tick)));
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
async function loadVoiceovers() {
  const list = await fetch('/api/voiceovers').then((r) => r.json()).catch(() => []);
  $('voEmpty').hidden = list.length > 0;
  $('voList').replaceChildren(
    ...list.map((v) => {
      const when = new Date(v.id.replace(/^(\d{4}-\d\d-\d\d)-(\d\d)-(\d\d)-(\d\d)$/, '$1T$2:$3:$4Z'));
      const main = (v.files.find((f) => f.name !== 'voice.wav') || v.files[0]).name;
      const li = el('li', { class: 'vo-item' });
      li.append(
        el(
          'div',
          { class: 'vo-item-top' },
          el('div', { class: 'vo-item-title' }, el('h3', {}, isNaN(when) ? v.id : when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), el('div', { class: 'rec-facts' }, [length(v.duration), chosenName(v.preset, v.voice), plural(v.words, 'word')].filter(Boolean).join(' · '))),
          meterPlayer(`/vo/${v.id}/${main}`, v.duration)
        ),
        el('p', { class: 'vo-item-text', dir: 'auto' }, v.preview + (v.preview.length >= 240 ? '…' : '')),
        el(
          'div',
          { class: 'rec-actions' },
          ...downloads(v.id, v.files),
          el('button', { class: 'key key-quiet key-sm', type: 'button', 'data-open-folder': '', onclick: () => api('/api/vo-open/' + v.id).catch(() => {}) }, typeof SHOW_IN !== 'undefined' ? SHOW_IN : 'Open folder'),
          el('button', {
            class: 'key key-quiet key-sm vo-del',
            type: 'button',
            onclick: async (e) => {
              const b = e.currentTarget;
              if (!b.dataset.sure) {
                b.dataset.sure = '';
                b.textContent = 'Delete for good?';
                setTimeout(() => { delete b.dataset.sure; b.textContent = 'Delete'; }, 4000);
                return;
              }
              await api('/api/vo-delete/' + v.id).catch(() => {});
              loadVoiceovers();
            },
          }, 'Delete')
        )
      );
      return li;
    })
  );
}

// ---------- start ----------
async function loadVoice() {
  try {
    VO.info = await fetch('/api/voice').then((r) => r.json());
  } catch {
    $('voError').textContent = 'Could not reach the voice engine.';
    return;
  }
  try {
    const s = JSON.parse(localStorage.getItem('mrb.vo') || 'null');
    if (s) {
      if (VO.info.presets.some((p) => p.id === s.preset)) VO.preset = s.preset;
      VO.changes = s.changes || {};
      if (s.text && !$('voText').value) $('voText').value = s.text;
    }
  } catch {}
  renderSetup(null);
  renderAll();
  loadVoiceovers();
}

$('voText').addEventListener('input', () => {
  renderCount();
  clearTimeout(VO.saveT);
  VO.saveT = setTimeout(save, 400);
});
$('voGo').addEventListener('click', create);
$('voMore').addEventListener('toggle', () => VO.info && renderExtra());
$('voCancel').addEventListener('click', () => api('/api/voice/cancel').catch(() => {}));
$('voResetAll').addEventListener('click', () => {
  VO.changes = {};
  save();
  renderAll();
});
$('voSetupBtn').addEventListener('click', async () => {
  $('voSetupBtn').hidden = true;
  try {
    renderSetup(await api('/api/voice/setup'));
  } catch (e) {
    $('voSetupText').textContent = e.message;
    $('voSetupBtn').hidden = false;
  }
});

// live updates come through app.js's event stream
window.onVoiceState = (data) => {
  if (data.voiceSetup) {
    renderSetup(data.voiceSetup);
    if (data.voiceSetup.status === 'done' && VO.info && VO.info.needs && VO.info.needs.length) {
      fetch('/api/voice?refresh').then((r) => r.json()).then((i) => { VO.info = i; renderSetup(null); renderAll(); });
    }
  }
  if (data.voiceExtra) {
    const was = VO.extraState && VO.extraState.status;
    VO.extraState = data.voiceExtra;
    if (data.voiceExtra.status === 'done' && was !== 'done') fetch('/api/voice').then((r) => r.json()).then((i) => { VO.info = i; renderAll(); });
    else if (VO.info) renderExtra();
  }
  if (data.voice) renderJob({ ...data.voice, voice: (VO.job && VO.job.voice) || undefined });
};

if (!location.hash) history.replaceState(null, '', '#transcribe');
showTab();
