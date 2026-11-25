'use strict';
// ICAIRE Echo: the panel. Three columns: details on the left, the work in the middle, the list on the right.
// Live state (the bot, the transcriber, downloads, updates) arrives over Server-Sent Events from /api/stream.
// "On this computer" records the microphone, plus the call's sound when it is shared through the browser's
// share picker, mixed into one track and streamed to the server in chunks.

const $ = (id) => document.getElementById(id);
const STATUS = {
  starting: ['Starting the bot', 'Opening its own browser'],
  joining: ['Joining the meeting', ''],
  waiting: ['Waiting to be let in', 'Someone in the meeting needs to click "Admit"'],
  recording: ['Recording', ''],
  stopping: ['Stopping', 'Leaving the meeting'],
  processing: ['Saving', 'Making the audio and the speaker list'],
  done: ['Saved', ''],
  error: ["Couldn't record", ''],
  cancelled: ['Cancelled', ''],
};
// speaker colours, the same order everywhere: on the dark list, and on the white pages
const WAVE = ['#A8D66D', '#6FC6CF', '#C3A0E8', '#EDB677', '#E6899C', '#82A5E8', '#D4CC7B', '#81C7A9'];
// the same colours on every surface (all of them dark)
const INK = WAVE;
const MAC = /Mac/.test(navigator.platform || navigator.userAgent);
const WIN = /Win/.test(navigator.platform || navigator.userAgent);
const SHOW_IN = MAC ? 'Show in Finder' : WIN ? 'Show in File Explorer' : 'Open folder';

let snap = null; // the bot's run
let receivedAt = 0;
let lastStatus = null;
let lastPreviewAt = 0;
let lastElapsed = -1;
let lastElapsedAt = 0;
let local = null; // a recording on this computer, in progress
let recordings = [];
let whisper = null;
let tx = null; // the transcription in progress (or the last one)
let update = null;
let mode = 'local';
let current = null; // the open recording: { id, rec, turns, speakers, text }

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${m}:${pad(sec % 60)}`;
}
function length(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min${sec % 60 && m < 10 ? ` ${sec % 60} s` : ''}`;
}
function bytes(n) {
  if (n < 1024 * 1024) return [(n / 1024).toFixed(0), 'KB'];
  if (n < 1024 ** 3) return [(n / 1048576).toFixed(1), 'MB'];
  return [(n / 1024 ** 3).toFixed(2), 'GB'];
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null && k !== false) e.append(k);
  return e;
}
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mrb': '1' }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('visible');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('visible'), 2600);
}
const when = (iso, long) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleString([], long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const titleOf = (r) => r.title || (r.kind === 'local' ? 'Recording' : 'Google Meet') + (r.startedAt ? ', ' + new Date(r.startedAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '');
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
// recorded time of a recording on this computer: wall time since it started, less the time it spent paused
const localElapsedMs = (me) => (me.pausedAt || performance.now()) - me.t0 - (me.pausedMs || 0);
const nowSec = () => {
  if (local) return localElapsedMs(local) / 1000;
  return snap ? (snap.elapsedMs + (snap.status === 'recording' ? performance.now() - receivedAt : 0)) / 1000 : 0;
};
const isLive = () => !!local || !!(snap && snap.active);
const txBusy = () => !!(tx && ['loading', 'separating', 'running', 'merging'].includes(tx.status));
function fitCanvas(canvas, H) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || canvas.parentElement.clientWidth;
  if (H != null) canvas.style.height = H + 'px';
  const h = H != null ? H : canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, h);
  return [c, W, h];
}
for (const n of document.querySelectorAll('.show-in')) n.textContent = n.closest('#openRecordings') ? (MAC ? 'Open recordings in Finder' : WIN ? 'Open recordings in File Explorer' : 'Open recordings folder') : SHOW_IN;

// ---------- where we are ----------
function where() {
  const [view, id] = (location.hash.slice(1) || 'record').split('/');
  if (view === 'rec' && id) return { family: 'record', page: 'rec', id: decodeURIComponent(id) };
  if (view === 'voice') return { family: 'voice', page: 'voice' };
  if (view === 'settings') return { family: 'settings', page: 'settings' };
  return { family: 'record', page: isLive() ? 'live' : 'home' };
}

function route() {
  const w = where();
  document.getElementById('app').dataset.view = w.page;
  $('viewHome').hidden = w.page !== 'home';
  $('viewLive').hidden = w.page !== 'live';
  $('viewRec').hidden = w.page !== 'rec';
  $('viewVoice').hidden = w.page !== 'voice';
  $('viewSettings').hidden = w.page !== 'settings';
  for (const p of document.querySelectorAll('.inspector .panel')) p.hidden = p.dataset.for !== w.family;
  for (const s of document.querySelectorAll('.rail-section')) s.hidden = !s.dataset.for.split(' ').includes(w.family);
  for (const a of document.querySelectorAll('.view-link')) {
    const on = a.dataset.view === (w.family === 'voice' ? 'voice' : w.family === 'record' ? 'record' : '');
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $('appMenu').open = false;
  // the left card: setup before a recording, the recording's details when one is open
  const open = w.page === 'rec';
  $('recTabs').hidden = !open;
  $('setupBody').hidden = open;
  if (!open) {
    $('infoBody').hidden = true;
    $('peopleBody').hidden = true;
    $('recCardTitle').textContent = w.page === 'live' ? 'This recording' : 'Recording details';
    setupLocked(w.page === 'live');
  } else showRecTab(currentRecTab);
  markSelected();
  if (w.page === 'rec') openRecording(w.id);
  else closeRecording();
  if (w.page === 'voice' && window.voiceShown) window.voiceShown();
  if (w.page === 'settings') loadStorage();
  if (w.page === 'home') renderReadiness();
}
window.addEventListener('hashchange', route);

// ---------- recording mode: on this computer, or the bot ----------
function setMode(m) {
  mode = m === 'bot' ? 'bot' : 'local';
  try { localStorage.setItem('echo.mode', mode); } catch {}
  for (const b of document.querySelectorAll('.mode [data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  for (const s of document.querySelectorAll('#setupBody [data-mode]')) s.hidden = s.dataset.mode !== mode;
  // the link box keeps its place in both modes, so nothing below it moves
  $('joinForm').toggleAttribute('inert', mode !== 'bot');
  document.body.dataset.mode = mode;
  $('bigBtn').setAttribute('aria-label', mode === 'bot' ? 'Send the bot to the meeting' : 'Start recording');
  $('bigCaption').textContent = mode === 'bot' ? 'Tap to send the bot' : 'Tap to start recording';
  $('bigHint').textContent = mode === 'bot' ? 'It joins as a guest; let it in from Meet.' : `${MAC ? '⌘' : 'Ctrl+'}⇧R to record`;
  $('startError').textContent = '';
  renderReadiness();
}
for (const b of document.querySelectorAll('.mode [data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
function setupLocked(live) {
  for (const n of document.querySelectorAll('#setupBody input, #setupBody select')) n.disabled = live && n.id !== 'newTitle';
  $('setupNote').textContent = live ? 'The title is saved with the recording when it ends.' : 'Set these before you start, or leave them as they are.';
}

// ---------- home: readiness under the button ----------
async function renderReadiness() {
  const items = [];
  const item = (ok, text, warn) => el('span', { class: ok ? 'ok' : warn ? 'warn' : '' }, icon(ok ? 'check' : 'info'), text);
  if (mode === 'local') {
    let mic = null;
    try { mic = (await navigator.permissions.query({ name: 'microphone' })).state; } catch {}
    items.push(item(mic === 'granted', mic === 'granted' ? 'Microphone allowed' : mic === 'denied' ? 'Microphone blocked in this browser' : 'Asks for the microphone', mic === 'denied'));
    items.push(item($('localCall').checked, $('localCall').checked ? 'Call sound: on' : 'Call sound: off'));
  } else {
    items.push(item($('show').checked || $('talk').checked, $('talk').checked ? 'You talk through the bot' : $('show').checked ? "The bot's window shows" : 'The bot works out of sight'));
    items.push(item(true, `Joins as "${$('name').value.trim() || 'Recorder'}"`));
    if (account) items.push(item(account.signedIn, account.signedIn ? 'Signed in to Google' : 'Not signed in to Google: More, then Sign the bot in', !account.signedIn));
  }
  if (whisper) items.push(item(whisper.available, whisper.available ? 'Transcriber ready' : 'Transcriber needs its model', !whisper.available));
  $('readiness').replaceChildren(...items);
}
$('setupLink').addEventListener('click', () => {
  $('recCard').open = true;
  const first = $(mode === 'bot' ? 'name' : 'newTitle');
  first.focus();
});

// ---------- the live view ----------
function render() {
  const s = snap;
  const meetingLive = !!(s && s.active);
  const live = !!local || meetingLive;
  let status = 'idle';
  if (local) status = local.stopping ? 'processing' : local.pausedAt ? 'paused' : 'recording';
  else if (meetingLive) status = s.status;
  document.body.dataset.status = status;
  $('livePill').hidden = !live;

  // the home page and the live page swap by themselves
  const w = where();
  if (w.family === 'record' && w.page !== 'rec' && $(live ? 'viewLive' : 'viewHome').hidden) route();

  if (s && s.status !== lastStatus) {
    const was = lastStatus;
    lastStatus = s.status;
    if (was && !s.active) meetingEnded(s);
  }
  if (!live) return;

  const title = $('newTitle').value.trim();
  const state = local ? (local.stopping ? 'Saving' : local.pausedAt ? 'Paused' : 'Recording') : (STATUS[s.status] || [s.status])[0];
  $('pillTitle').textContent = title || (local ? 'Recording' : 'Google Meet');
  $('pillState').textContent = state;
  $('livePill').classList.toggle('paused', !!(local && local.pausedAt));
  $('liveHeading').textContent = title || (local ? 'Recording on this computer' : 'Recording a Google Meet');
  $('liveLabel').textContent = state;
  $('botCard').hidden = !!local;
  const cap = $('captureBtn');
  cap.classList.toggle('is-paused', !!(local && local.pausedAt));

  if (local) {
    $('captureLabel').textContent = local.stopping ? 'Saving…' : local.pausedAt ? 'Tap to continue' : 'Tap to pause';
    cap.disabled = !!local.stopping;
    cap.setAttribute('aria-label', local.pausedAt ? 'Continue recording' : 'Pause recording');
    $('liveSub').textContent = local.stopping
      ? 'Then the transcript starts by itself'
      : local.pausedAt
        ? 'Nothing is being recorded. Tap the button to carry on in the same recording.'
        : local.call === 'ended'
          ? 'Sound sharing was stopped, so only your microphone is recording now'
          : '';
    $('stopBtn').disabled = !!local.stopping;
    $('stopText').textContent = local.stopping ? 'Saving…' : 'End';
    $('captureStatus').replaceChildren(
      el('span', {}, icon('mic'), local.device),
      el('span', { class: local.call === true ? 'on' : '' }, icon('audio'), local.call === true ? 'Call sound on' : 'Microphone only'),
      $('people').value ? el('span', {}, icon('people'), $('people').value === '1' ? 'Just you' : `${$('people').value} people`) : null
    );
    return;
  }

  const [, sub] = STATUS[s.status] || [s.status, ''];
  // the bot's recording cannot pause: its speaker log would drift out of line with the sound
  $('captureLabel').textContent = s.status === 'recording' ? 'The bot is recording' : state;
  cap.disabled = true;
  cap.removeAttribute('aria-label');
  $('liveSub').textContent = sub;
  const stop = $('stopBtn');
  stop.disabled = s.status === 'stopping' || s.status === 'processing' || !!s.stopReason;
  $('stopText').textContent = s.status === 'recording' ? 'End' : ['joining', 'waiting', 'starting'].includes(s.status) ? 'Cancel' : 'Stopping…';
  if (s.elapsedMs !== lastElapsed) {
    lastElapsed = s.elapsedMs;
    lastElapsedAt = performance.now();
  }
  $('captureStatus').replaceChildren(
    el('span', {}, icon('link'), s.url.replace(/^https?:\/\//, '')),
    el('span', { class: 'on' }, icon('screen'), $('talk').checked ? 'You talk in its window' : $('show').checked ? 'Window shown' : 'Out of sight')
  );
  renderPeople(s);
  renderStats(s);
  renderLog(s);
  if (s.previewAt && s.previewAt !== lastPreviewAt) {
    lastPreviewAt = s.previewAt;
    const img = $('preview');
    img.onload = () => {
      img.hidden = false;
      $('previewEmpty').hidden = true;
    };
    img.src = '/api/preview.jpg?t=' + s.previewAt;
  }
}

function meetingEnded(s) {
  loadRecordings().then(() => {
    const w = where();
    if (s.status === 'done') {
      $('newTitle').value = '';
      if (w.family === 'record' && w.page !== 'rec') location.hash = '#rec/' + encodeURIComponent(s.id);
    } else {
      showNotice(STATUS[s.status] ? STATUS[s.status][0] : s.status, [s.error || (s.stopReason ? `Stopped: ${s.stopReason}` : ''), ...(s.notes || [])].filter(Boolean).join(' '));
      route();
    }
  });
}
function showNotice(title, text) {
  $('noticeTitle').textContent = title;
  $('noticeText').textContent = text;
  $('notice').hidden = false;
}
$('noticeClose').addEventListener('click', () => ($('notice').hidden = true));

const colorFor = (list, name) => Math.max(0, list.indexOf(name)) % WAVE.length;
function renderPeople(s) {
  const people = [...(s.people || [])];
  const talking = people.filter((p) => p.speaking).length;
  $('peopleMeta').textContent = people.length ? `${plural(people.length, 'person', 'people')}${talking ? ` · ${talking} talking` : ''}` : '';
  const names = people.map((p) => p.name);
  if (!people.length) {
    $('peopleLive').replaceChildren(el('li', { class: 'muted' }, s.status === 'recording' ? 'Nobody has been seen yet.' : 'People show up here once the bot is in the meeting.'));
    return;
  }
  $('peopleLive').replaceChildren(
    ...people.map((p) =>
      el('li', { class: 'person' + (p.speaking ? ' speaking' : ''), style: `--c:${INK[colorFor(names, p.name)]}` },
        el('span', { class: 'dot', 'aria-hidden': 'true' }),
        el('span', { class: 'person-name', title: p.name }, p.name),
        el('span', { class: 'person-num' }, `${mmss(p.talkMs / 1000)} · ${plural(p.turns, 'turn')}`, p.speaking ? el('span', { class: 'sr-only' }, ', talking now') : null)
      )
    )
  );
}
function renderStats(s) {
  const v = bytes(s.stats.audioBytes);
  const stat = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, value));
  $('stats').replaceChildren(stat('Sound written', `${v[0]} ${v[1]}`), stat('Speaking turns', String(s.totalSegments)), stat('People on screen', String(s.stats.visible)));
}
function renderLog(s) {
  const log = $('log');
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(...(s.logs || []).map((l) => el('li', {}, el('time', {}, new Date(l.t).toLocaleTimeString([], { hour12: false })), el('span', {}, l.msg))));
  if (nearBottom) log.scrollTop = log.scrollHeight;
}
for (const b of document.querySelectorAll('.live-tabs [data-live]')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.live-tabs [data-live]')) x.setAttribute('aria-selected', String(x === b));
    for (const p of document.querySelectorAll('.live-pane')) p.hidden = p.dataset.live !== b.dataset.live;
  });
}

// who spoke when, the last two minutes (the bot)
function drawLanes(canvas, lanes, segments, { start, end }) {
  const laneH = 18;
  const gap = 8;
  const H = lanes.length ? lanes.length * (laneH + gap) + 18 : 0;
  const [c, W] = fitCanvas(canvas, H);
  if (!lanes.length) return;
  const labelW = Math.min(140, Math.max(80, W * 0.2));
  const x0 = labelW + 8;
  const x1 = W - 2;
  const X = (t) => x0 + ((t - start) / Math.max(1, end - start)) * (x1 - x0);
  const font = getComputedStyle(document.body).fontFamily;
  lanes.forEach((lane, i) => {
    const y = i * (laneH + gap);
    c.fillStyle = '#0d2430';
    c.fillRect(x0, y, x1 - x0, laneH);
    c.fillStyle = '#edf3f2';
    c.font = (lane.speaking ? '600 ' : '') + `12px ${font}`;
    c.textBaseline = 'middle';
    c.fillText(lane.name.length > 18 ? lane.name.slice(0, 17) + '…' : lane.name, 0, y + laneH / 2);
    c.fillStyle = lane.color;
    for (const g of segments) {
      if (g.key !== lane.key) continue;
      const s = Math.max(g.start, start);
      const e = Math.min(g.end, end);
      if (e > s) c.fillRect(X(s), y + 3, Math.max(2, X(e) - X(s)), laneH - 6);
    }
  });
  c.fillStyle = '#9db4bd';
  c.textBaseline = 'top';
  c.font = `11px ${font}`;
  c.fillText('2 min ago', x0, H - 13);
  const nowW = c.measureText('now').width;
  c.fillText('now', x1 - nowW, H - 13);
}

// the sound, drawn as bars inside the main button
const BARS = 24;
function drawCapture(levels) {
  const box = $('captureWave');
  if (box.children.length !== BARS) box.replaceChildren(...Array.from({ length: BARS }, () => el('i')));
  const recent = levels.slice(-BARS);
  [...box.children].forEach((b, i) => {
    const v = recent[i - (BARS - recent.length)] || 0;
    const db = v > 0 ? 20 * Math.log10(v / 1000) : -120;
    const mag = Math.max(0.05, Math.min(1, (db + 54) / 48));
    b.style.transform = `scaleY(${((3 + mag * 58) / 61).toFixed(3)})`;
  });
  const last = recent[recent.length - 1] || 0;
  const db = last > 0 ? 20 * Math.log10(last / 1000) : -120;
  $('meterBar').style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 54) / 48)).toFixed(3)})`;
}
function waveNote(values, peopleTalking) {
  const recent = values.slice(-60); // last 6 s
  const peak = recent.length ? Math.max(...recent) : 0;
  let text = 'Listening…';
  let tone = '';
  if (local && local.pausedAt) text = 'Paused';
  else if (peak >= 4) (text = 'Sound is coming through'), (tone = 'ok');
  else if (nowSec() > 15) {
    text = peopleTalking ? 'People are talking but no sound is reaching the recording' : 'Quiet: no sound right now';
    tone = peopleTalking ? 'warn' : '';
  }
  const note = $('waveNote');
  if (note.textContent !== text) note.textContent = text;
  if ((note.dataset.tone || '') !== tone) note.dataset.tone = tone;
}

function frame() {
  if (isLive()) {
    const t = mmss(nowSec());
    if ($('clock').textContent !== t) $('clock').textContent = t;
    if ($('pillTime').textContent !== t) $('pillTime').textContent = t;
    if (local) {
      if (!local.pausedAt) drawCapture(local.levels);
      waveNote(local.levels, false);
    } else {
      drawCapture(snap.levels || []);
      waveNote(snap.levels || [], (snap.people || []).some((p) => p.speaking));
      if (!$('botCard').hidden && !$('lanes').closest('[hidden]')) {
        const people = snap.people || [];
        const names = people.map((p) => p.name);
        const lanes = people.map((p) => ({ key: p.pid, name: p.name, color: INK[colorFor(names, p.name)], speaking: p.speaking }));
        const now = nowSec();
        const segments = (snap.segments || []).map((g) => {
          const speaking = people.find((p) => p.pid === g.pid)?.speaking;
          const open = speaking && g.end >= snap.elapsedMs / 1000 - 0.4;
          return { key: g.pid, start: g.start, end: open ? Math.max(g.end, now) : g.end };
        });
        drawLanes($('lanes'), lanes, segments, { start: now - 120, end: now });
        $('lanesEmpty').hidden = lanes.length > 0;
      }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- recording on this computer ----------
function callHelp(failed) {
  const how = MAC ? 'choose the tab your meeting is in and keep "Also share tab audio" on' : 'choose "Entire screen" and switch on "Also share system audio"';
  return failed ? `The call's sound wasn't shared, so recording didn't start. Press the microphone again, then ${how}.` : `When the browser asks what to share, ${how}.`;
}
// Inside the desktop app, recording is native: the microphone and the computer's sound are recorded by the app
// itself (no share picker), into the recording's folder, and mixed into audio.wav when it ends.
const NATIVE = window.__TAURI__ && window.__TAURI__.core;
async function startNative() {
  const err = $('startError');
  const btn = $('bigBtn');
  btn.disabled = true;
  let id;
  let dir;
  try {
    ({ id, dir } = await api('/api/local/start', { native: true, title: $('newTitle').value, source: $('localCall').checked ? 'microphone+computer' : 'microphone', people: Number($('people').value) || null }));
    const r = await NATIVE.invoke('record_start', { dir, system: $('localCall').checked });
    local = { id, native: true, call: r.system, t0: performance.now(), levels: [], device: r.device || 'Microphone', pausedMs: 0 };
    if (r.system_error) toast('Recording your microphone only: ' + r.system_error);
  } catch (e) {
    btn.disabled = false;
    err.textContent = String((e && e.message) || e);
    if (id) api(`/api/local/${id}/finish`, { durationMs: 0 }).catch(() => {}); // nothing was recorded: the empty folder goes
    return;
  }
  local.timer = setInterval(async () => {
    const me = local;
    if (!me || me.pausedAt || me.stopping) return;
    try {
      const l = await NATIVE.invoke('record_level');
      me.levels.push(Math.min(1000, Math.round(Math.max(l.mic, l.system) * 1000)));
      if (me.levels.length > 600) me.levels.shift();
    } catch {}
  }, 100);
  btn.disabled = false;
  $('notice').hidden = true;
  if (where().family !== 'record' || where().page === 'rec') location.hash = '#record';
  render();
  route();
}

async function startLocal() {
  const err = $('startError');
  err.textContent = '';
  if (snap && snap.active) return void (err.textContent = 'The bot is in a meeting right now. End it first.');
  if (NATIVE) return startNative();
  const btn = $('bigBtn');
  btn.disabled = true;
  // the other people's voices only come out of the speakers, and the microphone's echo cancelling removes
  // them on purpose, so the call is taken from the computer's own sound instead
  let shared = null;
  if ($('localCall').checked) {
    try {
      shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude' });
    } catch (e) {
      btn.disabled = false;
      err.textContent = e && e.name === 'NotAllowedError'
        ? 'Nothing was shared, so recording didn\'t start. Press the microphone again and choose what to share, or turn "Call sound" off on the left to record only your microphone.'
        : "This browser could not share the computer's sound: " + (e && e.message);
      return;
    }
    if (!shared.getAudioTracks().length) {
      shared.getTracks().forEach((t) => t.stop());
      btn.disabled = false;
      err.textContent = callHelp(true);
      return;
    }
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    if (shared) shared.getTracks().forEach((t) => t.stop());
    btn.disabled = false;
    err.textContent = e && e.name === 'NotAllowedError'
      ? 'The browser was not allowed to use the microphone. Click the lock icon next to the address, allow the microphone, then try again.'
      : e && e.name === 'NotFoundError' ? 'No microphone was found on this computer.' : 'Could not open the microphone: ' + (e && e.message);
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', ''].find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));
  let id;
  try {
    ({ id } = await api('/api/local/start', { mime, title: $('newTitle').value, source: shared ? 'microphone+computer' : 'microphone', people: Number($('people').value) || null }));
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    if (shared) shared.getTracks().forEach((t) => t.stop());
    btn.disabled = false;
    err.textContent = e.message;
    return;
  }
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  // one track: the microphone and the call mixed together, so audio.wav stays a single file
  const mix = ctx.createMediaStreamDestination();
  // two voices at once can add up past full scale: a limiter that only touches the loudest peaks
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -8;
  limit.knee.value = 6;
  limit.ratio.value = 12;
  limit.attack.value = 0.003;
  limit.release.value = 0.25;
  // the browser's compressor adds make-up gain of its own, which brought peaks back to full scale: trim 3 dB after it
  const trim = ctx.createGain();
  trim.gain.value = 0.7;
  limit.connect(trim);
  trim.connect(mix);
  trim.connect(analyser);
  for (const s of [stream, shared && new MediaStream(shared.getAudioTracks())].filter(Boolean)) ctx.createMediaStreamSource(s).connect(shared ? limit : mix);
  if (!shared) ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const rec = new MediaRecorder(mix.stream, mime ? { mimeType: mime } : undefined);
  local = { id, stream, shared, call: !!shared, ctx, rec, t0: performance.now(), levels: [], uploads: Promise.resolve(), failed: null, device: stream.getAudioTracks()[0]?.label || 'Microphone' };
  if (shared) {
    const me = local;
    // "Stop sharing" in the browser's bar: keep recording the microphone and say so
    shared.getAudioTracks()[0].addEventListener('ended', () => {
      if (local === me && !me.stopping) (me.call = 'ended'), render();
    });
  }
  local.timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    if (local.pausedAt) return; // the sound stands still while paused
    local.levels.push(Math.min(1000, Math.round(Math.sqrt(sum / buf.length) * 1000)));
    if (local.levels.length > 600) local.levels.shift();
  }, 100);
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const me = local;
    me.uploads = me.uploads.then(() =>
      fetch(`/api/local/${me.id}/chunk`, { method: 'POST', headers: { 'x-mrb': '1', 'content-type': 'application/octet-stream' }, body: e.data })
        .then((r) => { if (!r.ok) throw new Error('upload failed (' + r.status + ')'); })
        .catch((x) => (me.failed = x))
    );
  };
  rec.start(2000);
  btn.disabled = false;
  $('notice').hidden = true;
  if (where().family !== 'record' || where().page === 'rec') location.hash = '#record';
  render();
  route();
}

function togglePause() {
  const me = local;
  if (!me || me.stopping) return;
  if (me.native) NATIVE.invoke('record_pause', { paused: !me.pausedAt }).catch((e) => toast(String(e)));
  if (me.pausedAt) {
    if (me.rec) me.rec.resume();
    me.pausedMs = (me.pausedMs || 0) + (performance.now() - me.pausedAt);
    me.pausedAt = null;
  } else {
    if (me.rec) me.rec.pause();
    me.pausedAt = performance.now();
  }
  render();
}

async function stopLocal() {
  const me = local;
  if (!me || me.stopping) return;
  me.stopping = true;
  render();
  let durationMs = Math.round(localElapsedMs(me));
  clearInterval(me.timer);
  if (me.native) {
    // the files are complete once the app has closed them; their own length is the true recorded time
    const sec = await NATIVE.invoke('record_stop').catch(() => 0);
    if (sec > 0) durationMs = Math.round(sec * 1000);
  } else {
    await new Promise((r) => {
      me.rec.onstop = r;
      me.rec.stop();
    });
    me.stream.getTracks().forEach((t) => t.stop());
    if (me.shared) me.shared.getTracks().forEach((t) => t.stop());
    me.ctx.close().catch(() => {});
    await me.uploads;
  }
  try {
    const r = await api(`/api/local/${me.id}/finish`, { durationMs });
    local = null;
    $('newTitle').value = '';
    await loadRecordings();
    if (r.transcribe && r.transcribe.error) toast("It's saved, but the transcript couldn't start: " + r.transcribe.error);
    else if (r.transcribe) showTx(r.transcribe, true);
    render();
    location.hash = '#rec/' + encodeURIComponent(r.id);
  } catch (e) {
    local = null;
    render();
    route();
    showNotice("Couldn't save the recording", e.message + (me.failed ? ` (${me.failed.message})` : ''));
    loadRecordings();
  }
}

async function join() {
  const err = $('startError');
  err.textContent = '';
  if (local) return void (err.textContent = 'A recording is running on this computer. End it first.');
  if (!$('url').value.trim()) {
    err.textContent = 'Paste the Google Meet link first.';
    $('url').focus();
    return;
  }
  $('bigBtn').disabled = true;
  try {
    const s = await api('/api/join', { url: $('url').value, name: $('name').value, title: $('newTitle').value, show: $('show').checked || $('talk').checked, talk: $('talk').checked });
    snap = s;
    receivedAt = performance.now();
    lastStatus = s.status;
    lastPreviewAt = 0;
    $('preview').hidden = true;
    $('previewEmpty').hidden = false;
    $('notice').hidden = true;
    render();
    route();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    $('bigBtn').disabled = false;
  }
}

$('bigBtn').addEventListener('click', () => (mode === 'bot' ? join() : startLocal()));
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  join();
});
$('captureBtn').addEventListener('click', togglePause);
$('stopBtn').addEventListener('click', async () => {
  if (local) return stopLocal();
  $('stopBtn').disabled = true;
  try {
    await api('/api/stop');
  } catch {
    $('stopBtn').disabled = false;
  }
});
window.addEventListener('beforeunload', (e) => {
  if (local) {
    e.preventDefault();
    e.returnValue = '';
  }
});
$('talk').addEventListener('change', () => {
  if ($('talk').checked) $('show').checked = true;
  renderReadiness();
});
$('show').addEventListener('change', () => {
  if (!$('show').checked) $('talk').checked = false;
  renderReadiness();
});
$('localCall').addEventListener('change', () => {
  $('localHint').textContent = $('localCall').checked
    ? 'Also records the other people in your call. ' + (NATIVE ? (MAC ? 'The first time, macOS asks to allow ICAIRE Echo under Screen & System Audio Recording (only the sound is recorded).' : 'Nothing to share or pick.') : callHelp(false))
    : 'Only your microphone is recorded.';
  try { localStorage.setItem('echo.call', $('localCall').checked ? '1' : '0'); } catch {}
  renderReadiness();
});
$('name').addEventListener('change', () => {
  try { localStorage.setItem('echo.name', $('name').value); } catch {}
  renderReadiness();
});
$('newTitle').addEventListener('input', () => isLive() && render());

// ---------- the list on the right ----------
const txCache = new Map(); // transcript text by recording, for the search
async function loadRecordings() {
  recordings = await fetch('/api/recordings').then((r) => r.json()).catch(() => recordings);
  renderRail();
  return recordings;
}
function statusOf(r) {
  if (tx && tx.id === r.id && txBusy()) return tx.status === 'separating' ? 'Telling the voices apart' : `Transcribing ${Math.floor(tx.percent || 0)}%`;
  return r.files.some((f) => f.name === 'transcript.txt') ? 'Transcribed' : 'No transcript yet';
}
function renderRail() {
  const q = $('recSearch').value.trim().toLowerCase();
  const list = recordings.filter((r) => {
    if (!q) return true;
    const hay = [titleOf(r), when(r.startedAt, true), ...r.speakers, txCache.get(r.id) || ''].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const box = $('recList');
  const keep = new Map([...box.children].map((n) => [n.dataset.id, n]));
  box.replaceChildren(
    ...list.map((r) => {
      let card = keep.get(r.id);
      const meta = [when(r.startedAt), mmss(r.durationSec), statusOf(r)].filter(Boolean).join(' · ');
      const sig = JSON.stringify([titleOf(r), meta, r.speakers]);
      if (card && card.dataset.sig === sig) return card;
      // keep a drawn waveform; a flat placeholder (no sound yet when it was first shown) is fetched again
      const wave = card && card.querySelector('.wave-graphic rect') ? card.querySelector('.wave-graphic') : null;
      card = el('a', { class: 'wave-card', href: '#rec/' + encodeURIComponent(r.id), 'data-id': r.id, 'data-sig': sig }, el('strong', { dir: 'auto' }, titleOf(r)), wave || waveGraphic(null), el('small', {}, meta));
      if (!wave) loadPeaks(card, r.id);
      return card;
    })
  );
  $('recEmpty').hidden = recordings.length > 0;
  $('recEmpty').textContent = recordings.length ? '' : 'No recordings yet. Press the microphone to make the first one.';
  if (recordings.length && !list.length) box.append(el('p', { class: 'rail-empty' }, 'Nothing matches that.'));
  markSelected();
}
function markSelected() {
  const w = where();
  for (const c of document.querySelectorAll('.wave-card')) c.classList.toggle('selected', w.page === 'rec' && c.dataset.id === w.id);
}
const peaksSeen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    peaksSeen.unobserve(e.target);
    const id = e.target.dataset.id;
    fetch('/api/peaks/' + encodeURIComponent(id))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && e.target.querySelector('.wave-graphic').replaceWith(waveGraphic(d)))
      .catch(() => {});
  }
});
const loadPeaks = (card) => peaksSeen.observe(card);
function waveGraphic(data) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 360 70');
  svg.setAttribute('class', 'wave-graphic');
  svg.setAttribute('aria-hidden', 'true');
  const peaks = (data && data.peaks) || [];
  if (!peaks.length) {
    const line = document.createElementNS(NS, 'path');
    line.setAttribute('d', 'M0 35H360');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('opacity', '.25');
    svg.append(line);
    return svg;
  }
  const many = (data.speakers || []).some((x) => x != null);
  peaks.forEach((v, i) => {
    const bar = document.createElementNS(NS, 'rect');
    const h = Math.max(2, Math.min(1, v) * 62);
    const who = many ? data.speakers[i] : 0;
    bar.setAttribute('x', String((i * 360) / peaks.length));
    bar.setAttribute('y', String((70 - h) / 2));
    bar.setAttribute('width', String(Math.max(1, 360 / peaks.length - 1.2)));
    bar.setAttribute('height', String(h));
    bar.setAttribute('rx', '1.4');
    bar.setAttribute('fill', who == null ? '#526773' : WAVE[who % WAVE.length]);
    svg.append(bar);
  });
  return svg;
}
let searchLoaded = false;
$('recSearch').addEventListener('input', async () => {
  renderRail();
  // words said in the meetings are searchable too: their transcripts are fetched once, on the first search
  if (searchLoaded) return;
  searchLoaded = true;
  await Promise.all(recordings.filter((r) => r.files.some((f) => f.name === 'transcript.txt')).map((r) =>
    fetch(`/rec/${r.id}/transcript.txt`).then((x) => (x.ok ? x.text() : '')).then((t) => txCache.set(r.id, t)).catch(() => {})
  ));
  renderRail();
});

// ---------- one recording ----------
let currentRecTab = 'details';
function showRecTab(name) {
  currentRecTab = name;
  for (const b of document.querySelectorAll('#recTabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  $('infoBody').hidden = name !== 'details';
  $('peopleBody').hidden = name !== 'people';
}
for (const b of document.querySelectorAll('#recTabs [data-tab]')) b.addEventListener('click', () => showRecTab(b.dataset.tab));

function closeRecording() {
  if (!current) return;
  $('audio').pause();
  current = null;
}

async function openRecording(id) {
  if (!recordings.some((r) => r.id === id)) await loadRecordings();
  const r = recordings.find((x) => x.id === id);
  if (!r) {
    location.hash = '#record';
    return;
  }
  const fresh = !current || current.id !== id;
  current = { ...(fresh ? {} : current), id, rec: r };
  $('recCardTitle').textContent = 'Recording details';
  // header
  $('recTitle').textContent = titleOf(r);
  if (document.activeElement !== $('recTitleInput')) $('recTitleInput').value = r.title || '';
  $('recTitleInput').placeholder = titleOf(r);
  const chips = [
    el('span', {}, when(r.startedAt, true)),
    el('span', {}, length(r.durationSec)),
    el('span', { class: 'chip' }, icon(r.kind === 'local' ? 'laptop' : 'bot'), r.kind === 'local' ? 'On this computer' : 'Google Meet'),
  ];
  if (r.speakers.length) chips.push(el('span', { class: 'names' }, r.speakers.join(' · ')));
  $('recMeta').replaceChildren(...chips);
  // downloads
  const has = (n) => r.files.find((f) => f.name === n);
  const dl = (name, label, about) => {
    const f = has(name);
    return f ? el('a', { class: 'download', href: `/rec/${r.id}/${name}?download`, download: name }, icon('download'), el('span', {}, el('b', {}, label), el('small', {}, `${about} · ${bytes(f.bytes).join(' ')}`))) : null;
  };
  $('exportOptions').replaceChildren(
    el('section', {}, el('h3', {}, 'Transcript'),
      dl('transcript.txt', 'Text', '.txt'),
      dl('transcript.srt', 'Subtitles', '.srt'),
      has('transcript.json') ? el('button', { type: 'button', class: 'download', onclick: downloadMarkdown }, icon('download'), el('span', {}, el('b', {}, 'Markdown'), el('small', {}, '.md, for notes and documents'))) : null,
      !has('transcript.txt') ? el('p', { class: 'muted' }, 'After it is transcribed.') : null
    ),
    el('section', {}, el('h3', {}, 'Recording'), dl('audio.wav', 'Audio', '.wav'), dl('video.mp4', 'Video', '.mp4'), dl('speakers.csv', 'Who spoke when', '.csv'))
  );
  $('exportMenu').open = false;
  // facts on the left
  const total = r.files.reduce((a, f) => a + f.bytes, 0);
  const fact = (k, v) => [el('dt', {}, k), el('dd', {}, v)];
  $('recFacts').replaceChildren(
    ...fact('Recorded', when(r.startedAt, true)),
    ...fact('Length', length(r.durationSec)),
    ...fact('How', r.kind === 'local' ? (r.source === 'microphone+computer' ? 'This computer: microphone and call sound' : "This computer's microphone") : 'The bot, in ' + (r.meetUrl || 'Google Meet').replace(/^https?:\/\//, '')),
    ...fact('Voices', r.speakers.length ? String(r.speakers.length) : r.people === 1 ? 'One' : 'Not told apart'),
    ...fact('On disk', bytes(total).join(' '))
  );
  $('mergePick').hidden = !(r.kind !== 'local' && r.segments);
  $('recWatch').hidden = !has('video.mp4');
  if (fresh) showVideo(false);
  syncTranscribe();
  // people
  renderPeopleEdit(r);
  // sound
  if (fresh) {
    const a = $('audio');
    a.pause();
    a.src = has('audio.wav') ? `/rec/${r.id}/audio.wav` : '';
    a.playbackRate = Number($('speed').value) || 1;
    $('player').hidden = !has('audio.wav');
    $('txSearch').value = '';
    current.filter = null;
    updatePlayer();
  }
  await loadTranscript(r, fresh);
  markSelected();
  showTx(tx);
}

function syncTranscribe() {
  const r = current && current.rec;
  if (!r) return;
  const hasAudio = r.files.some((f) => f.name === 'audio.wav');
  const off = !hasAudio || txBusy() || (whisper && !whisper.available);
  $('retranscribe').disabled = off;
  $('transcribeBtn').disabled = off;
  const reason = whisper && !whisper.available ? 'The transcriber needs its model first (Models and storage).' : txBusy() && tx.id !== r.id ? 'Another recording is being transcribed.' : '';
  $('retranscribe').title = reason;
  $('transcribeBtn').title = reason;
}

function renderPeopleEdit(r) {
  const box = $('peopleList');
  if (!r.speakers.length) {
    $('peopleNote').textContent = r.people === 1 ? 'One voice: this recording was made as "Just me".' : 'The voices in this recording are not told apart yet. Transcribe it to find them.';
    box.replaceChildren();
    return;
  }
  $('peopleNote').textContent = 'Give each voice a name. The whole transcript follows.';
  box.replaceChildren(
    ...r.speakers.map((n, i) => {
      const input = el('input', { type: 'text', value: n, 'aria-label': `Name for ${n}`, maxlength: '60', dir: 'auto' });
      const save = async () => {
        const to = input.value.trim();
        if (!to || to === n) return void (input.value = n);
        try {
          await api('/api/rename/' + r.id, { from: n, to });
          toast(`${n} is now ${to}`);
          await loadRecordings();
          if (current && current.id === r.id) openRecording(r.id);
        } catch (e) {
          toast(e.message);
          input.value = n;
        }
      };
      input.addEventListener('change', save);
      input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
      return el('label', { class: 'person-edit', style: `--c:${WAVE[i % WAVE.length]}` }, el('span', { class: 'dot', 'aria-hidden': 'true' }), input);
    })
  );
}

const LINE = /^\[(\d\d):(\d\d):(\d\d) - (\d\d):(\d\d):(\d\d)\] (.*)$/;
async function loadTranscript(r, fresh) {
  const hasTx = r.files.some((f) => f.name === 'transcript.txt');
  $('txEmpty').hidden = hasTx;
  $('txBox').hidden = !hasTx;
  $('copyAll').hidden = $('copyRaw').hidden = !hasTx;
  $('txEmptyText').textContent = txBusy() && tx.id === r.id ? 'The transcript is being written now.' : 'No transcript yet.';
  $('transcribeBtn').hidden = txBusy() && tx.id === r.id;
  if (!hasTx) {
    $('txMeta').textContent = '';
    $('txLines').replaceChildren();
    $('speakerFilter').replaceChildren();
    renderTimeline(r, []);
    return;
  }
  if (fresh || !current.turns) {
    const [text, json] = await Promise.all([
      fetch(`/rec/${r.id}/transcript.txt`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : '')).catch(() => ''),
      fetch(`/rec/${r.id}/transcript.json`, { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    if (!current || current.id !== r.id) return;
    current.text = text;
    current.turns = json && json.turns ? json.turns : text.trim().split('\n').map((l) => {
      const m = LINE.exec(l);
      return m ? { start: +m[1] * 3600 + +m[2] * 60 + +m[3], end: +m[4] * 3600 + +m[5] * 60 + +m[6], speaker: 'Unknown', text: m[7] } : { start: 0, end: 0, speaker: 'Unknown', text: l };
    });
  }
  const turns = current.turns;
  // speakers in order of first appearance: the same colours as the list on the right
  const order = [...new Set(turns.map((t) => t.speaker).filter((s) => s && s !== 'Unknown'))];
  current.speakers = order;
  const named = order.length > 0;
  $('txMeta').textContent = turns.length ? (named ? `${plural(turns.length, 'turn')} · ${plural(order.length, 'speaker')}` : plural(turns.length, 'line')) : 'No speech was found in this recording.';
  if (!turns.length) $('copyAll').hidden = $('copyRaw').hidden = true;
  $('speakerFilter').hidden = order.length < 2;
  $('speakerFilter').replaceChildren(
    el('span', { class: 'muted' }, 'Speakers'),
    el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(!current.filter), onclick: () => setFilter(null) }, 'All speakers'),
    ...order.map((s, i) => el('button', { type: 'button', class: 'chip-btn', style: `--c:${INK[i % INK.length]}`, 'aria-pressed': String(current.filter === s), onclick: () => setFilter(s) }, el('span', { class: 'dot', 'aria-hidden': 'true' }), s))
  );
  $('txLines').replaceChildren(
    ...turns.map((t, i) => {
      const c = order.indexOf(t.speaker);
      const li = el('li', { class: 'tx-line', 'data-i': String(i), 'data-speaker': t.speaker || '', style: c >= 0 ? `--c:${INK[c % INK.length]}` : null },
        el('button', { type: 'button', class: 'time-link', title: 'Play from here', onclick: () => seek(t.start, true) }, mmss(t.start)),
        el('div', { class: 'tx-say' },
          named && t.speaker !== 'Unknown' ? el('span', { class: 'tx-who' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('bdi', {}, t.speaker), t.also && t.also.length ? el('span', { class: 'tx-over' }, ' over ', el('bdi', {}, t.also.join(', '))) : null) : null,
          el('p', { class: 'tx-text', dir: 'auto' }, t.text)
        )
      );
      return li;
    })
  );
  renderTimeline(r, turns);
  applySearch(false);
}
function setFilter(s) {
  current.filter = s;
  for (const b of document.querySelectorAll('#speakerFilter .chip-btn')) b.setAttribute('aria-pressed', String(b.textContent === (s || 'All speakers')));
  for (const li of document.querySelectorAll('#txLines .tx-line')) li.hidden = !!s && li.dataset.speaker !== s;
  applySearch(false);
}

// who spoke when, across the whole recording: one row per speaker; click to listen from there
function renderTimeline(r, turns) {
  const box = $('timeline');
  let segs = turns.filter((t) => t.speaker && t.speaker !== 'Unknown');
  const order = (current && current.speakers) || [];
  if (order.length < 2) return void (box.hidden = true, box.replaceChildren());
  box.hidden = false;
  const dur = Math.max(1, r.durationSec || Math.max(...segs.map((s) => s.end)));
  box.replaceChildren(
    ...order.map((name, i) =>
      el('div', { class: 'timeline-row', style: `--c:${INK[i % INK.length]}` },
        el('span', { class: 'timeline-name', title: name }, name),
        el('div', { class: 'timeline-track', onclick: (e) => { const b = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - b.left) / b.width) * dur, true); } },
          ...segs.filter((s) => s.speaker === name).map((s) => el('i', { style: `left:${((s.start / dur) * 100).toFixed(3)}%;width:${Math.max(0.25, ((s.end - s.start) / dur) * 100).toFixed(3)}%` })),
          el('b', { class: 'playhead', 'aria-hidden': 'true' })
        )
      )
    )
  );
}

// search inside the transcript: every match marked, Previous and Next step through them
let hits = [];
let hitAt = -1;
function applySearch(jump) {
  const q = $('txSearch').value.trim();
  hits = [];
  for (const li of document.querySelectorAll('#txLines .tx-line')) {
    const p = li.querySelector('.tx-text');
    const t = current.turns[+li.dataset.i].text;
    if (!q || li.hidden) {
      if (p.childElementCount) p.textContent = t;
      continue;
    }
    const low = t.toLowerCase();
    const ql = q.toLowerCase();
    let at = low.indexOf(ql);
    if (at < 0) {
      if (p.childElementCount) p.textContent = t;
      continue;
    }
    const parts = [];
    let from = 0;
    while (at >= 0) {
      parts.push(t.slice(from, at));
      const m = el('mark', {}, t.slice(at, at + q.length));
      parts.push(m);
      hits.push(m);
      from = at + q.length;
      at = low.indexOf(ql, from);
    }
    parts.push(t.slice(from));
    p.replaceChildren(...parts);
  }
  $('txMatches').textContent = q ? plural(hits.length, 'match', 'matches') : '';
  $('txPrev').disabled = $('txNext').disabled = hits.length < 1;
  hitAt = -1;
  if (jump && hits.length) step(1);
}
function step(d) {
  if (!hits.length) return;
  if (hits[hitAt]) hits[hitAt].classList.remove('current');
  hitAt = (hitAt + d + hits.length) % hits.length;
  hits[hitAt].classList.add('current');
  hits[hitAt].scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('txMatches').textContent = `${hitAt + 1} of ${plural(hits.length, 'match', 'matches')}`;
}
$('txSearch').addEventListener('input', () => applySearch(true));
$('txSearch').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), step(e.shiftKey ? -1 : 1)));
$('txPrev').addEventListener('click', () => step(-1));
$('txNext').addEventListener('click', () => step(1));

// copying: with times and names, or just what was said
$('copyAll').addEventListener('click', async () => {
  await copy(current.text);
  toast('Transcript copied');
});
$('copyRaw').addEventListener('click', async () => {
  await copy(current.turns.map((t) => t.text).join('\n'));
  toast('Copied without names or times');
});
function downloadMarkdown() {
  const r = current.rec;
  const named = current.speakers.length > 0;
  const md = [`# ${titleOf(r)}`, '', `${when(r.startedAt, true)} · ${length(r.durationSec)}${named ? ` · ${current.speakers.join(', ')}` : ''}`, '', ...current.turns.map((t) => `**${mmss(t.start)}**${named && t.speaker !== 'Unknown' ? ` **${t.speaker}:**` : ''} ${t.text}\n`)].join('\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `${(r.title || 'transcript-' + r.id).replace(/[\\/:*?"<>|]+/g, '-')}.md` });
  document.body.append(a);
  a.click();
  a.remove();
}

// renaming: the pencil in the header, or the Title field on the left
async function saveTitle(title) {
  const r = current && current.rec;
  if (!r) return;
  try {
    await api('/api/rec-title/' + r.id, { title });
    await loadRecordings();
    if (current && current.id === r.id) openRecording(r.id);
  } catch (e) {
    toast(e.message);
  }
}
let titleTimer;
$('recTitleInput').addEventListener('input', () => {
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => saveTitle($('recTitleInput').value), 600);
});
$('recRename').addEventListener('click', () => {
  $('recCard').open = true;
  showRecTab('details');
  $('recTitleInput').focus();
  $('recTitleInput').select();
});
// the bot's video, with who is speaking as captions
function showVideo(on) {
  const box = $('videoBox');
  $('recWatch').querySelector('span').textContent = on ? 'Hide the video' : 'Watch with names';
  if (!on) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  audio.pause();
  const id = current.id;
  const v = el('video', { controls: true, preload: 'metadata', src: `/rec/${id}/video.mp4` });
  v.append(el('track', { kind: 'captions', label: 'Speakers', srclang: 'en', src: `/rec/${id}/speakers.vtt`, default: true }));
  box.replaceChildren(v);
  box.hidden = false;
}
$('recWatch').addEventListener('click', () => showVideo($('videoBox').hidden));
$('recOpen').addEventListener('click',() => api('/api/open/' + current.id).catch((e) => toast(e.message)));
$('recDelete').addEventListener('click', async () => {
  const r = current.rec;
  const sure = await confirmBox({ title: 'Delete this recording?', text: `"${titleOf(r)}", its audio and its transcript are removed from this computer. This cannot be undone.`, ok: 'Delete' });
  if (!sure) return;
  try {
    await api('/api/rec-delete/' + r.id);
    closeRecording();
    await loadRecordings();
    location.hash = '#record';
    toast('Deleted');
  } catch (e) {
    toast(e.message);
  }
});
async function transcribe() {
  const r = current.rec;
  $('txError').hidden = true;
  $('retranscribe').disabled = $('transcribeBtn').disabled = true;
  try {
    showTx(await api('/api/transcribe/' + r.id, { model: $('whisperModel').value || undefined }), true);
  } catch (e) {
    $('txError').textContent = e.message;
    $('txError').hidden = false;
    syncTranscribe();
  }
}
$('retranscribe').addEventListener('click', transcribe);
$('transcribeBtn').addEventListener('click', transcribe);
$('txCancel').addEventListener('click', () => api('/api/transcribe-cancel').catch(() => {}));
$('mergePick').querySelector('input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    await api('/api/merge/' + current.id, { filename: f.name, content: await f.text() });
    current.turns = null;
    await loadRecordings();
    openRecording(current.id);
  } catch (err) {
    $('txError').textContent = 'Could not use that file: ' + err.message;
    $('txError').hidden = false;
  }
  e.target.value = '';
});

// ---------- the player ----------
const audio = $('audio');
function seek(sec, play) {
  if (!audio.src) return;
  audio.currentTime = Math.max(0, sec);
  if (play) audio.play().catch(() => {});
  updatePlayer();
}
let nowLine = null;
function updatePlayer() {
  const d = audio.duration || (current && current.rec && current.rec.durationSec) || 0;
  const t = audio.currentTime || 0;
  $('playerTime').textContent = `${mmss(t)} / ${mmss(d)}`;
  if (document.activeElement !== $('seek')) $('seek').value = d ? Math.round((t / d) * 1000) : 0;
  $('player').classList.toggle('playing', !audio.paused);
  $('playBtn').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  for (const h of document.querySelectorAll('.timeline .playhead')) h.style.left = d ? `${((t / d) * 100).toFixed(2)}%` : '0';
  // the line being heard now
  if (current && current.turns) {
    const i = current.turns.findIndex((x, k) => t >= x.start && t < (current.turns[k + 1] ? current.turns[k + 1].start : Infinity));
    const li = i >= 0 ? document.querySelector(`#txLines [data-i="${i}"]`) : null;
    if (li !== nowLine) {
      if (nowLine) nowLine.classList.remove('now');
      if (li && t > 0) li.classList.add('now');
      nowLine = li;
    }
  }
}
['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended', 'seeked'].forEach((e) => audio.addEventListener(e, updatePlayer));
$('playBtn').addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
$('back10').addEventListener('click', () => seek(audio.currentTime - 10));
$('fwd10').addEventListener('click', () => seek(audio.currentTime + 10));
$('seek').addEventListener('input', () => {
  const d = audio.duration || 0;
  if (d) audio.currentTime = (Number($('seek').value) / 1000) * d;
});
$('speed').addEventListener('change', () => (audio.playbackRate = Number($('speed').value) || 1));

// ---------- transcription ----------
async function loadWhisper() {
  try {
    whisper = await fetch('/api/whisper').then((r) => r.json());
  } catch {
    whisper = { available: false, reason: 'Could not check for the transcriber.' };
  }
  const where_ = whisper.device && whisper.device !== 'cpu' ? whisper.gpu || 'the graphics card' : 'the processor';
  const catalog = whisper.catalog || [];
  const titled = (name) => { const c = catalog.find((x) => x.key === name); return c ? `${c.title} (${name})` : name; };
  const sel = $('whisperModel');
  sel.replaceChildren(...(whisper.models || []).map((m) => el('option', { value: m.name }, titled(m.name))));
  if (whisper.chosen) sel.value = whisper.chosen;
  sel.disabled = !whisper.available || (whisper.models || []).length < 2;
  $('engine').dataset.state = whisper.available ? 'ready' : 'missing';
  $('engineText').textContent = whisper.available ? `Transcriber ready · ${titled(whisper.chosen || whisper.models[0].name)} on ${where_}` : whisper.engine ? 'The transcriber needs a model: open Models and storage' : 'The transcriber is not installed';
  $('whisperText').textContent = whisper.available
    ? `Runs on ${where_}. Choose the model new transcripts use.`
    : whisper.engine
      ? 'Choose a model to download. After that the transcriber works without the internet.'
      : 'The transcriber is not installed yet. Open the ICAIRE Echo app once; it sets it up.';
  renderModels();
  syncTranscribe();
  renderReadiness();
}
let modelSetup = null;
function renderModels() {
  const box = $('modelList');
  if (!whisper || !whisper.engine) return void box.replaceChildren();
  const busy = modelSetup && modelSetup.status === 'running';
  box.replaceChildren(
    ...(whisper.catalog || []).map((c) => {
      const inUse = c.installed && whisper.chosen === c.key;
      const downloading = busy && modelSetup.name === c.key;
      let act;
      if (inUse) act = el('span', { class: 'in-use' }, icon('check'), 'In use');
      else if (c.installed) act = el('button', { type: 'button', class: 'small', onclick: () => chooseModel(c.key) }, 'Use this');
      else act = el('button', { type: 'button', class: 'small' + (c.recommended && !whisper.available ? ' primary' : ''), disabled: busy, onclick: () => getModel(c.key) }, icon('download'), downloading ? 'Downloading…' : 'Download');
      return el('div', { class: 'model' + (inUse ? ' on' : ''), role: 'listitem' },
        el('div', { class: 'model-text' },
          el('h3', {}, c.title, c.recommended ? el('span', { class: 'tag' }, 'Recommended') : null),
          el('p', {}, c.about),
          el('small', {}, `${bytes(c.bytes).join(' ')} · ${c.key}${c.installed ? ' · on this computer' : ''}`)
        ),
        act
      );
    })
  );
}
async function chooseModel(key) {
  try {
    await api('/api/whisper/choose', { model: key });
    toast('New transcripts use this model');
    loadWhisper();
  } catch (e) {
    toast(e.message);
  }
}
async function getModel(key) {
  try {
    showWhisperSetup(await api('/api/whisper/setup', { model: key }));
  } catch (e) {
    toast(e.message);
  }
}
function showWhisperSetup(s) {
  if (!s) return;
  const was = modelSetup && modelSetup.status;
  modelSetup = s;
  const prog = $('whisperProg');
  prog.hidden = s.status !== 'running';
  if (s.status === 'running') {
    const gb = (n) => (n / 1e9).toFixed(2);
    $('whisperPct').textContent = Math.floor(s.percent) + '%';
    $('whisperLabel').textContent = `Downloading ${s.name}: ${gb(s.got)} of ${gb(s.total)} GB`;
    $('whisperBar').style.transform = `scaleX(${(s.percent / 100).toFixed(4)})`;
    $('engineText').textContent = `Downloading the transcriber model: ${Math.floor(s.percent)}%`;
  } else if (s.status === 'error' && was !== 'error') $('whisperText').textContent = 'The download stopped: ' + s.error;
  if (s.status !== was) (s.status === 'done' ? loadWhisper() : renderModels());
}

function showTx(t, started) {
  const prev = started ? { ...t, status: 'started' } : tx;
  tx = t;
  syncTranscribe();
  // the list shows progress on the card
  const r = t && recordings.find((x) => x.id === t.id);
  if (r) renderRail();
  if (!t) return;
  const open = current && current.id === t.id;
  const active = txBusy();
  if (open) {
    $('txProg').hidden = !active;
    if (active) {
      const model = t.model ? `Whisper ${t.model}` : 'Whisper';
      const waiting = t.status === 'loading' || t.status === 'separating';
      $('txProg').dataset.phase = waiting ? 'loading' : t.status;
      const pct = waiting ? 0 : t.percent;
      $('txPct').textContent = waiting ? '…' : `${Math.floor(pct)}%`;
      $('txLabel').textContent = t.status === 'separating'
        ? 'Telling the voices apart…'
        : t.status === 'loading'
          ? `Loading ${model}…`
          : t.status === 'merging'
            ? 'Adding the speaker names…'
            : `Writing the transcript: ${mmss(t.at)} of ${mmss(t.duration)}` + (t.etaSec != null && t.percent > 2 ? `, about ${mmss(t.etaSec)} left` : '');
      $('txBar').style.transform = waiting ? '' : `scaleX(${(pct / 100).toFixed(4)})`;
      $('txEmptyText').textContent = 'The transcript is being written now.';
      $('transcribeBtn').hidden = true;
    }
  }
  const changed = !prev || prev.id !== t.id || prev.status !== t.status;
  if (!changed || !prev) return; // only react to transitions seen live
  if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
    loadRecordings().then(() => {
      if (current && current.id === t.id) {
        current.turns = null;
        openRecording(t.id);
      }
    });
  }
  if (t.status === 'error' && open) {
    $('txError').textContent = 'The transcript failed: ' + t.error;
    $('txError').hidden = false;
  }
}

// ---------- models and storage ----------
async function loadStorage() {
  let s;
  try {
    s = await fetch('/api/storage').then((r) => r.json());
  } catch {
    return;
  }
  const size = (n) => bytes(n).join(' ');
  $('storeFree').textContent = s.free != null ? `Free space on this computer: ${size(s.free)}` : '';
  const row = (name, about, n, act) => el('div', { class: 'storage-item' }, el('div', {}, el('h3', {}, name), el('p', { class: 'muted' }, `${size(n)} · ${about}`)), act);
  const open = (which) => el('button', { type: 'button', class: 'small', onclick: () => api('/api/storage/open', { which }).catch((e) => toast(e.message)) }, icon('files'), SHOW_IN);
  $('storeList').replaceChildren(
    row('Recordings', 'Your audio and transcripts', s.recordings, open('recordings')),
    row('Voice-overs', 'The voice-overs you made', s.voiceovers, open('voiceovers')),
    ...s.models.map((m) =>
      row(m.name, m.about, m.bytes, m.removable ? el('button', {
        type: 'button',
        class: 'small quiet-danger',
        onclick: async () => {
          const sure = await confirmBox({ title: `Remove ${m.name}?`, text: `${size(m.bytes)} is freed. It is downloaded again when it is needed.`, ok: 'Remove' });
          if (!sure) return;
          try {
            await api('/api/storage/remove', { key: m.key });
            toast('Removed');
            loadStorage();
            loadWhisper();
          } catch (e) {
            toast(e.message);
          }
        },
      }, icon('trash'), 'Remove') : null)
    ),
    el('div', { class: 'storage-foot' }, open('models'), el('span', { class: 'muted' }, 'The models folder'))
  );
}

// ---------- updates ----------
function showUpdate(u) {
  update = u;
  const busy = u.status === 'checking' || u.status === 'updating' || u.status === 'updated';
  // the installed app is updated by installing the new version: the button opens its download page
  const label = u.status === 'available' ? (u.packaged ? 'Download the new version' : 'Update now') : 'Check for updates';
  const text = u.status === 'checking' ? 'Checking…'
    : u.status === 'available' ? 'A new version is ready' + (u.latest && u.latest.message ? `: ${u.latest.message}` : '')
      : u.status === 'updating' ? 'Updating…'
        : u.status === 'updated' ? 'Updated. Restarting…'
          : u.status === 'current' ? 'Up to date'
            : u.status === 'error' ? u.error : '';
  for (const b of [$('updateBtn'), $('updateBtn2')]) {
    b.disabled = busy;
    b.querySelector('span').textContent = label;
    b.classList.toggle('primary', u.status === 'available');
  }
  $('updateText').textContent = text;
  $('updateText2').textContent = text || 'ICAIRE Echo checks for a new version every few hours and updates itself when nothing is running.';
  $('versionNote').textContent = u.current ? `Version ${u.current}` : '';
  $('appMenu').classList.toggle('has-update', u.status === 'available');
  if (u.status === 'updated') waitForRestart();
}
let restarting = false;
function waitForRestart() {
  if (restarting) return;
  restarting = true;
  // the app starts again by itself; reload once it answers, to show the new version
  const tryIt = () => fetch('/api/state', { cache: 'no-store' }).then((r) => (r.ok ? location.reload() : setTimeout(tryIt, 1500))).catch(() => setTimeout(tryIt, 1500));
  setTimeout(tryIt, 4000);
}
async function updateClick() {
  const apply = update && update.status === 'available';
  try {
    showUpdate(await api(apply ? '/api/update/apply' : '/api/update/check'));
  } catch (e) {
    $('updateText').textContent = $('updateText2').textContent = e.message;
  }
}
$('updateBtn').addEventListener('click', updateClick);
$('updateBtn2').addEventListener('click', updateClick);

// ---------- the More menu ----------
$('openRecordings').addEventListener('click', () => api('/api/storage/open', { which: 'recordings' }).catch((e) => toast(e.message)));
// the bot's Google sign-in happens in the app: a window opens on the bot's own browser, you sign in and close it
var account = null; // var: read by renderReadiness, which can run before this line
async function loadAccount() {
  try { account = await fetch('/api/account').then((r) => r.json()); } catch { return; }
  $('loginText').textContent = account.signedIn ? (account.email ? `Bot signed in as ${account.email}` : 'Bot signed in to Google') : 'Sign the bot in to Google';
  $('loginNote').textContent = account.signedIn ? 'Click to sign in with another account.' : 'Google lets the bot into meetings only when it is signed in.';
  renderReadiness();
}
$('loginBtn').addEventListener('click', async () => {
  try {
    await api('/api/login');
    toast('Sign in in the window that opened, then close it.');
    // notice the sign-in as soon as it happens
    let n = 0;
    const t = setInterval(async () => {
      await loadAccount();
      if ((account && account.signedIn) || ++n > 60) clearInterval(t);
    }, 5000);
  } catch (e) {
    toast(e.message);
  }
});
$('appMenu').addEventListener('toggle', () => $('appMenu').open && loadAccount());
// the Mac app has no window of its own: this ends it
$('quitBtn').addEventListener('click', async () => {
  try {
    await api('/api/quit');
    document.body.replaceChildren(el('main', { class: 'stopped' }, el('h1', {}, 'ICAIRE Echo has stopped.'), el('p', {}, 'Open the ICAIRE Echo app to start it again. You can close this tab.')));
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('.app-menu[open], .export-menu[open]')) if (!d.contains(e.target)) d.open = false;
});

// A confirmation pop-up: resolves true when the person presses the action, false on Cancel or Escape
function confirmBox({ title, text, ok = 'Delete' }) {
  const d = $('confirm');
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmOk').textContent = ok;
  d.returnValue = '';
  d.showModal();
  d.querySelector('[value="cancel"]').focus();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}
window.confirmBox = confirmBox;
// the desktop app's window was closed while something was still recording or being made
window.echoConfirmQuit = async () => {
  const sure = await confirmBox({ title: 'Quit ICAIRE Echo?', text: 'Something is still recording or being made. If you quit now, it stops and what is not saved yet is lost.', ok: 'Quit anyway' });
  if (sure && NATIVE) NATIVE.invoke('quit_now');
};

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    if (!isLive()) {
      if (where().family !== 'record' || where().page === 'rec') location.hash = '#record';
      mode === 'bot' ? join() : startLocal();
    }
    return;
  }
  if (typing || $('confirm').open || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ') {
    if (local && where().page === 'live') (e.preventDefault(), togglePause());
    else if (where().page === 'rec' && audio.src) (e.preventDefault(), audio.paused ? audio.play().catch(() => {}) : audio.pause());
  } else if (e.key === '/' && where().page === 'rec' && !$('txBox').hidden) {
    e.preventDefault();
    $('txSearch').focus();
  }
});

// ---------- the connection ----------
// When the app behind this page has stopped (quit, or the computer restarted), say so plainly; reload by itself once it is back.
let lostSince = 0;
function showGone(gone) {
  if (!gone) {
    if (lostSince && Date.now() - lostSince > 1500) location.reload();
    lostSince = 0;
    $('gone').hidden = true;
    return;
  }
  if (!lostSince) lostSince = Date.now();
  $('gone').hidden = false;
}
function connect() {
  const es = new EventSource('/api/stream');
  es.onerror = () => showGone(true);
  es.onopen = () => showGone(false);
  es.onmessage = (m) => {
    const data = JSON.parse(m.data);
    snap = data.current;
    receivedAt = performance.now();
    render();
    showTx(data.transcribe || null);
    if (window.onVoiceState) window.onVoiceState(data);
    if (data.whisperSetup) showWhisperSetup(data.whisperSetup);
    if (data.update) showUpdate(data.update);
    $('quitBtn').hidden = !data.background;
  };
}

// ---------- start ----------
try {
  const call = localStorage.getItem('echo.call');
  if (call !== null) $('localCall').checked = call === '1';
  const name = localStorage.getItem('echo.name');
  if (name) $('name').value = name;
  mode = localStorage.getItem('echo.mode') || 'local';
} catch {}
$('localCall').dispatchEvent(new Event('change'));
setMode(mode);
if (!location.hash || location.hash === '#transcribe') history.replaceState(null, '', '#record');
connect();
loadRecordings().then(() => {
  route();
  showTx(tx);
});
loadWhisper();
loadAccount();
requestAnimationFrame(frame);
