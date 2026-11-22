'use strict';
// Meet Recorder control panel. Live meeting state arrives over Server-Sent Events from /api/stream.
// "Record here" records this computer's microphone, plus (when "Also record the people in my call" is on)
// the computer's own sound shared through the browser's screen-share picker, mixed into one track and
// streamed to the server in chunks.

const $ = (id) => document.getElementById(id);
// Speaker colours, readable on the light console face and on the dark variant.
const PALETTE = ['#2f6fdb', '#0f8a7e', '#8a4fe0', '#d0621f', '#c23b7a', '#2e9a4a', '#b88a12', '#5560d8', '#1590a8', '#a35a2a', '#9c3fb5', '#5f8a1a'];
const STATUS = {
  starting: ['Starting the bot', 'Opening its own browser'],
  joining: ['Joining the meeting', ''],
  waiting: ['Waiting to be let in', 'Someone in the meeting needs to click "Admit"'],
  recording: ['In the meeting, recording', ''],
  stopping: ['Stopping', 'Leaving the meeting'],
  processing: ['Saving the files', 'Making the video, audio and speaker list'],
  done: ['Saved', ''],
  error: ["Couldn't record", ''],
  cancelled: ['Cancelled', ''],
};
const TOP = {
  idle: 'Not recording',
  starting: 'Starting',
  joining: 'Joining the meeting',
  waiting: 'Waiting to be let in',
  recording: 'Recording',
  stopping: 'Stopping',
  processing: 'Saving',
  done: 'Saved',
  error: "Couldn't record",
  cancelled: 'Cancelled',
};

let snap = null;
let receivedAt = 0;
let dismissedId = null;
let lastStatus = null;
let lastPreviewAt = 0;
let lastElapsed = -1;
let lastElapsedAt = 0;
let local = null; // microphone recording in progress
let localDone = null; // summary of the last microphone recording
const colorByKey = new Map();
const colorOf = (key) => {
  if (!colorByKey.has(key)) colorByKey.set(key, PALETTE[colorByKey.size % PALETTE.length]);
  return colorByKey.get(key);
};

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}
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
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
async function api(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mrb': '1' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const nowSec = () => {
  if (local) return (performance.now() - local.t0) / 1000;
  return snap ? (snap.elapsedMs + (snap.status === 'recording' ? performance.now() - receivedAt : 0)) / 1000 : 0;
};
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

// ---------- live waveform, like a voice recorder ----------
// values: sound level every 100 ms (0-1000 = RMS x 1000), the last one at time `end` (seconds).
function drawWave(canvas, values, end, now) {
  const [c, W, H] = fitCanvas(canvas);
  // about 4 px per 100 ms bar: 30 s on a wide screen, less on a phone
  const WAVE_SEC = Math.max(8, Math.min(30, Math.round(W / 40)));
  const mid = Math.round(H / 2) - 6;
  const labelY = H - 2;
  const half = mid - 2;
  const start = now - WAVE_SEC;
  const X = (t) => ((t - start) / WAVE_SEC) * (W - 2);
  // centre line
  c.fillStyle = css('--lcd-dim');
  c.fillRect(0, mid, W, 1);
  const ink = css('--lcd-ink');
  const barW = Math.max(1.5, Math.min(3, (W / (WAVE_SEC * 10)) * 0.62));
  c.fillStyle = ink;
  for (let i = values.length - 1; i >= 0; i--) {
    const t = end - (values.length - 1 - i) * 0.1;
    if (t < start) break;
    if (t > now) continue;
    const v = values[i];
    const db = v > 0 ? 20 * Math.log10(v / 1000) : -120;
    const mag = Math.max(0, Math.min(1, (db + 54) / 48));
    const h = Math.max(1, mag * half);
    const x = X(t) - barW;
    c.globalAlpha = 0.35 + 0.65 * Math.min(1, (t - start) / 6); // older sound fades at the left edge
    c.beginPath();
    c.roundRect ? c.roundRect(x, mid - h, barW, h * 2 + 1, barW / 2) : c.rect(x, mid - h, barW, h * 2 + 1);
    c.fill();
  }
  c.globalAlpha = 1;
  // playhead
  c.fillStyle = '#fff3d6';
  c.fillRect(W - 2, 2, 2, mid * 2 - 4);
  // time marks
  c.font = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  c.fillStyle = '#9a8f7c';
  c.textBaseline = 'bottom';
  const every = WAVE_SEC > 20 ? 10 : 5;
  for (let s = every; s <= WAVE_SEC; s += every) {
    const x = X(now - s);
    c.fillText(`-${s} s`, Math.max(0, x), labelY);
  }
  const w = c.measureText('now').width;
  c.fillText('now', W - w - 4, labelY);
}

function waveNote(values, peopleTalking) {
  const note = $('waveNote');
  const recent = values.slice(-60); // last 6 s
  const peak = recent.length ? Math.max(...recent) : 0;
  const elapsed = nowSec();
  let text = 'Listening…';
  let tone = '';
  if (peak >= 4) {
    text = 'Sound is coming through';
    tone = 'ok';
  } else if (elapsed > 15) {
    text = peopleTalking ? 'People are talking but no sound is reaching the recording' : 'Quiet: no sound right now';
    tone = peopleTalking ? 'warn' : '';
  }
  if (note.textContent !== text) note.textContent = text;
  if ((note.dataset.tone || '') !== tone) note.dataset.tone = tone;
}

// ---------- who-spoke-when lanes ----------
function drawLanes(canvas, lanes, segments, opt) {
  const { start, end, live, laneH = 24, labels = true, now } = opt;
  const gap = Math.round(laneH * 0.3);
  const axisH = 20;
  const H = lanes.length ? 2 + lanes.length * (laneH + gap) + axisH : 0;
  const [c, W] = fitCanvas(canvas, H);
  if (!lanes.length) return;
  const labelW = labels ? Math.min(150, Math.max(92, W * 0.18)) : 0;
  const x0 = labelW + 8;
  const x1 = W - (live ? 4 : 2);
  const span = Math.max(1, end - start);
  const X = (t) => x0 + ((t - start) / span) * (x1 - x0);
  const seam = css('--seam');
  const faint = css('--ink-3');
  const text = css('--ink');
  const track = css('--track');
  const lanesBottom = 2 + lanes.length * (laneH + gap);
  const font = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => span / s <= 8) || 3600;
  c.font = `12px ${font}`;
  c.textBaseline = 'top';
  const ticks = [];
  if (live) for (let k = 0; end - k * step >= start; k++) ticks.push(end - k * step);
  else for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);
  for (const t of ticks) {
    const x = X(t);
    c.fillStyle = seam;
    c.fillRect(Math.round(x), 0, 1, lanesBottom);
    const label = live ? (end - t < 0.5 ? 'now' : '-' + mmss(end - t)) : mmss(t);
    const w = c.measureText(label).width;
    c.fillStyle = faint;
    c.fillText(label, Math.min(Math.max(x - w / 2, x0), x1 - w), lanesBottom + 5);
  }

  lanes.forEach((lane, i) => {
    const y = 2 + i * (laneH + gap);
    c.fillStyle = track;
    c.beginPath();
    c.roundRect ? c.roundRect(x0, y, x1 - x0, laneH, 5) : c.rect(x0, y, x1 - x0, laneH);
    c.fill();
    if (labels) {
      c.fillStyle = lane.color;
      c.beginPath();
      c.arc(5, y + laneH / 2, 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = text;
      c.font = (lane.speaking ? '600 ' : '') + `13px ${font}`;
      c.textBaseline = 'middle';
      c.fillText(ellipsize(c, lane.name, labelW - 16), 14, y + laneH / 2);
      c.textBaseline = 'top';
    }
    c.fillStyle = lane.color;
    for (const g of segments) {
      if (g.key !== lane.key) continue;
      const s = Math.max(g.start, start);
      const e = Math.min(g.end, end);
      if (e <= s) continue;
      const xs = X(s);
      const w = Math.max(2, X(e) - xs);
      c.beginPath();
      c.roundRect ? c.roundRect(xs, y + 3, w, laneH - 6, Math.min(4, w / 2)) : c.rect(xs, y + 3, w, laneH - 6);
      c.fill();
    }
  });
}
function ellipsize(c, s, max) {
  if (c.measureText(s).width <= max) return s;
  while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

function liveLanes() {
  if (!snap) return { lanes: [], segments: [] };
  const people = snap.people || [];
  const lanes = people.map((p) => ({ key: p.pid, name: p.name, color: colorOf('name:' + p.name), speaking: p.speaking }));
  const t = nowSec();
  const segments = (snap.segments || []).map((g) => {
    const speaking = people.find((p) => p.pid === g.pid)?.speaking;
    const open = speaking && g.end >= snap.elapsedMs / 1000 - 0.4;
    return { key: g.pid, start: g.start, end: open ? Math.max(g.end, t) : g.end, open };
  });
  return { lanes, segments };
}

// ---------- render ----------
function render() {
  const s = snap;
  const meetingLive = !!(s && s.active);
  const localLive = !!local;
  const showLive = meetingLive || localLive;
  const meetingDone = !!(s && !s.active && s.id !== dismissedId);
  const showDone = !showLive && (!!localDone || meetingDone);
  let status = 'idle';
  if (localLive) status = local.stopping ? 'processing' : 'recording';
  else if (meetingLive) status = s.status;
  else if (localDone) status = localDone.status;
  else if (meetingDone) status = s.status;
  document.body.dataset.status = status;

  // top strip: always says whether anything is recording, and for how long
  let top = TOP[status] || status;
  if (localLive && !local.stopping) top = local.call ? 'Recording you and the call' : 'Recording from the microphone';
  else if (meetingLive && status === 'recording') top = 'In a meeting, recording';
  if ($('pill').textContent !== top) $('pill').textContent = top;
  if (!showLive && $('topClock').textContent !== '00:00:00') $('topClock').textContent = '00:00:00';

  $('launch').hidden = showLive || showDone;
  $('live').hidden = !showLive;
  $('done').hidden = !showDone;
  $('live').dataset.kind = localLive ? 'local' : 'meeting';

  if (s && s.status !== lastStatus) {
    if (['done', 'error', 'cancelled'].includes(s.status) && lastStatus) loadRecordings();
    lastStatus = s.status;
  }

  if (localLive) {
    $('statusTitle').textContent = local.stopping ? 'Saving the recording' : 'Recording from this computer';
    $('statusSub').textContent = local.stopping
      ? 'Then the transcript starts by itself'
      : local.call === 'ended'
        ? "Sound sharing was stopped, so only your microphone is recording now"
        : local.call
          ? 'Your microphone and the sound of your call'
          : "This computer's microphone";
    $('stopBtn').disabled = !!local.stopping;
    $('stopBtn').textContent = local.stopping ? 'Saving…' : 'Stop & transcribe';
    return;
  }

  if (meetingLive) {
    const [title, sub] = STATUS[s.status] || [s.status, ''];
    $('statusTitle').textContent = title;
    $('statusSub').textContent = sub || s.url.replace(/^https?:\/\//, '');
    const stop = $('stopBtn');
    stop.disabled = s.status === 'stopping' || s.status === 'processing' || !!s.stopReason;
    stop.textContent = s.status === 'recording' ? 'Stop & save' : ['joining', 'waiting', 'starting'].includes(s.status) ? 'Cancel' : 'Stopping…';
    if (s.elapsedMs !== lastElapsed) {
      lastElapsed = s.elapsedMs;
      lastElapsedAt = performance.now();
    }
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
    return;
  }

  if (showDone && localDone) {
    $('doneTitle').textContent = localDone.status === 'error' ? "Couldn't save the recording" : 'Saved';
    $('doneSub').textContent = localDone.text;
    $('doneNotes').replaceChildren();
  } else if (showDone) {
    const [title] = STATUS[s.status] || [s.status];
    $('doneTitle').textContent = title;
    const inCall = (s.people || []).length;
    const spoke = (s.people || []).filter((p) => p.turns > 0).length;
    const who = spoke === inCall ? plural(inCall, 'person', 'people') : `${plural(inCall, 'person', 'people')} in the call (${spoke} spoke)`;
    const next = whisper && whisper.available ? 'The transcript is being written now; its progress shows at the top of the list below.' : "It's at the top of the list below.";
    $('doneSub').textContent =
      s.status === 'done'
        ? `${length(s.elapsedMs / 1000)} recorded with ${who} and ${plural(s.totalSegments, 'speaking turn')}. ${next}`
        : s.error || (s.stopReason ? `Stopped: ${s.stopReason}` : '');
    $('doneNotes').replaceChildren(...(s.notes || []).map((n) => el('p', {}, n)));
  }
}

function renderPeople(s) {
  const people = [...(s.people || [])];
  const talking = people.filter((p) => p.speaking).length;
  $('peopleMeta').textContent = people.length ? `${plural(people.length, 'person', 'people')}${talking ? ` · ${talking} talking now` : ''}` : '';
  const list = $('people');
  if (!people.length) {
    list.replaceChildren(el('li', { class: 'empty' }, s.status === 'recording' ? 'Nobody has been seen yet.' : 'People show up here once the bot is in the meeting.'));
    return;
  }
  list.replaceChildren(
    ...people.map((p, i) =>
      el(
        'li',
        { class: 'person' + (p.speaking ? ' speaking' : '') + (s.status === 'recording' && p.visible === false ? ' offscreen' : ''), style: `--c:${colorOf('name:' + p.name)}` },
        el('span', { class: 'key-top', 'aria-hidden': 'true' }, el('span', { class: 'led' }), el('span', { class: 'ch' }, pad(i + 1))),
        el('span', { class: 'person-name', title: p.name }, p.name),
        el('span', { class: 'person-num' }, el('b', {}, mmss(p.talkMs / 1000)), ` · ${plural(p.turns, 'turn')}`, p.speaking ? el('span', { class: 'sr-only' }, ', talking now') : null)
      )
    )
  );
}

function renderStats(s) {
  const v = bytes(s.stats.videoBytes);
  const a = bytes(s.stats.audioBytes);
  const stat = (label, value, unit, cls = '') => el('div', { class: 'stat ' + cls }, el('dt', {}, label), el('dd', {}, value, unit ? el('small', {}, ' ' + unit) : null));
  const folder = el('a', { href: '#', onclick: (e) => { e.preventDefault(); api('/api/open/' + s.id).catch(() => {}); } }, s.outDir);
  $('stats').replaceChildren(
    stat('Video written', v[0], v[1]),
    stat('Audio written', a[0], a[1]),
    stat('Speaking turns', String(s.totalSegments)),
    stat('People on screen', String(s.stats.visible)),
    el('div', { class: 'stat wide' }, el('dt', {}, 'Saving to'), el('dd', {}, folder))
  );
}

function renderLog(s) {
  const log = $('log');
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren(...(s.logs || []).map((l) => el('li', {}, el('time', {}, new Date(l.t).toLocaleTimeString([], { hour12: false })), el('span', {}, l.msg))));
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function frame() {
  const t = nowSec();
  if (local) {
    const c = clock(t);
    $('clock').textContent = c;
    $('topClock').textContent = c;
    drawWave($('wave'), local.levels, local.levelsEnd, t);
    waveNote(local.levels, false);
  } else if (snap && snap.active) {
    const c = clock(t);
    $('clock').textContent = c;
    $('topClock').textContent = c;
    const levels = snap.levels || [];
    if (snap.status === 'recording' || levels.length) {
      // levels arrive in batches about once a second: keep scrolling smoothly between batches
      const end = lastElapsed / 1000;
      const drift = Math.min(1.2, (performance.now() - lastElapsedAt) / 1000);
      drawWave($('wave'), levels, end, end + drift);
      waveNote(levels, (snap.people || []).some((p) => p.speaking));
    }
    const { lanes, segments } = liveLanes();
    drawLanes($('lanes'), lanes, segments, { start: t - 120, end: t, now: t, live: true });
    $('lanesEmpty').hidden = lanes.length > 0;
  }
  requestAnimationFrame(frame);
}

// ---------- record here (microphone, no meeting) ----------
async function startLocal() {
  const err = $('localError');
  err.textContent = '';
  if (snap && snap.active) {
    err.textContent = 'The bot is in a meeting right now. Stop it first.';
    return;
  }
  const btn = $('localBtn');
  btn.disabled = true;
  // the other people's voices only come out of the speakers, and the microphone's echo cancelling removes
  // them on purpose, so the call is taken from the computer's own sound instead
  let shared = null;
  if ($('localCall').checked) {
    try {
      shared = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      });
    } catch (e) {
      btn.disabled = false;
      err.textContent =
        e && e.name === 'NotAllowedError'
          ? "Nothing was shared, so recording didn't start. Press Record again and choose what to share, or untick \"Also record the people in my call\" to record only your microphone."
          : 'This browser could not share the computer\'s sound: ' + (e && e.message);
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
    err.textContent =
      e && e.name === 'NotAllowedError'
        ? 'The browser was not allowed to use the microphone. Click the lock icon next to the address, allow the microphone, then try again.'
        : e && e.name === 'NotFoundError'
          ? 'No microphone was found on this computer.'
          : 'Could not open the microphone: ' + (e && e.message);
    return;
  }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', ''].find((m) => !m || (window.MediaRecorder && MediaRecorder.isTypeSupported(m)));
  let id;
  try {
    ({ id } = await api('/api/local/start', { mime, source: shared ? 'microphone+computer' : 'microphone' }));
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
  limit.connect(mix);
  limit.connect(analyser);
  for (const s of [stream, shared && new MediaStream(shared.getAudioTracks())].filter(Boolean)) ctx.createMediaStreamSource(s).connect(shared ? limit : mix);
  if (!shared) ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const rec = new MediaRecorder(mix.stream, mime ? { mimeType: mime } : undefined);
  local = { id, stream, shared, call: !!shared, ctx, rec, t0: performance.now(), levels: [], levelsEnd: 0, uploads: Promise.resolve(), failed: null, device: stream.getAudioTracks()[0]?.label || 'Microphone' };
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
    local.levels.push(Math.min(1000, Math.round(Math.sqrt(sum / buf.length) * 1000)));
    if (local.levels.length > 600) local.levels.shift();
    local.levelsEnd = (performance.now() - local.t0) / 1000;
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
  localDone = null;
  render();
}

async function stopLocal() {
  const me = local;
  if (!me || me.stopping) return;
  me.stopping = true;
  render();
  const durationMs = Math.round(performance.now() - me.t0);
  await new Promise((r) => {
    me.rec.onstop = r;
    me.rec.stop();
  });
  clearInterval(me.timer);
  me.stream.getTracks().forEach((t) => t.stop());
  if (me.shared) me.shared.getTracks().forEach((t) => t.stop());
  me.ctx.close().catch(() => {});
  await me.uploads;
  try {
    const r = await api(`/api/local/${me.id}/finish`, { durationMs });
    const txErr = r.transcribe && r.transcribe.error;
    localDone = {
      status: 'done',
      text: `${length(r.durationSec)} recorded ${me.call ? 'from your microphone and the call' : 'from the microphone'}. ` + (txErr ? `It's saved, but the transcript couldn't start: ${txErr}` : 'The transcript is being written now; watch its progress in the list below.'),
    };
    local = null;
    await loadRecordings();
    if (r.transcribe && !txErr) showTx(r.transcribe, true);
  } catch (e) {
    localDone = { status: 'error', text: e.message + (me.failed ? ` (${me.failed.message})` : '') };
    local = null;
    loadRecordings();
  }
  render();
}

// ---------- recordings ----------
const PRIMARY = ['video.mp4', 'audio.wav', 'transcript.txt', 'transcript.srt', 'speakers.csv', 'speakers.srt'];

async function loadRecordings() {
  const list = await fetch('/api/recordings').then((r) => r.json()).catch(() => []);
  $('recList').replaceChildren(...list.map(renderRecording));
  $('recEmpty').hidden = list.length > 0;
}

function renderRecording(r) {
  const node = $('recItem').content.firstElementChild.cloneNode(true);
  const isLocal = r.kind === 'local';
  node.dataset.kind = isLocal ? 'local' : 'meeting';
  node.dataset.id = r.id;
  const when = r.startedAt ? new Date(r.startedAt) : null;
  node.querySelector('.rec-kind').textContent = isLocal ? 'Microphone recording' : 'Google Meet';
  node.querySelector('.rec-when').textContent = when ? when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : r.id;
  node.querySelector('.rec-facts').textContent = isLocal
    ? length(r.durationSec)
    : [length(r.durationSec), plural(r.speakers.length, 'speaker'), plural(r.segments, 'speaking turn')].join(' · ');
  node.querySelector('.rec-speakers').replaceChildren(...r.speakers.map((n) => el('span', { class: 'chip', style: `--c:${colorOf('name:' + n)}` }, n)));

  const files = [...r.files].sort((a, b) => (PRIMARY.indexOf(a.name) + 1 || 99) - (PRIMARY.indexOf(b.name) + 1 || 99));
  node.querySelector('.rec-files').replaceChildren(
    ...files.map((f) => {
      const [n, u] = bytes(f.bytes);
      return el('span', {}, el('a', { href: `/rec/${r.id}/${f.name}?download`, download: f.name }, f.name), ` ${n} ${u}`);
    })
  );

  const hasVideo = r.files.some((f) => f.name === 'video.mp4');
  const watch = node.querySelector('.act-watch');
  watch.hidden = !hasVideo;
  watch.addEventListener('click', () => {
    const box = node.querySelector('.rec-player');
    if (!box.hidden) {
      box.hidden = true;
      box.replaceChildren();
      watch.textContent = 'Watch with names';
      return;
    }
    const v = el('video', { controls: '', preload: 'metadata', src: `/rec/${r.id}/video.mp4` });
    v.append(el('track', { kind: 'captions', label: 'Speakers', srclang: 'en', src: `/rec/${r.id}/speakers.vtt`, default: '' }));
    box.replaceChildren(v);
    box.hidden = false;
    watch.textContent = 'Hide video';
  });
  node.querySelector('.act-open').addEventListener('click', () => api('/api/open/' + r.id).catch((e) => alert(e.message)));
  nameFolderButtons(node);
  if (isLocal) node.querySelector('.act-merge').hidden = true; // merging needs a speaker timeline

  // Transcribe with the local Whisper model
  const hasAudio = r.files.some((f) => f.name === 'audio.wav');
  const hasTranscript = r.files.some((f) => f.name === 'transcript.txt');
  const txBtn = node.querySelector('.act-transcribe');
  txBtn.textContent = hasTranscript ? 'Transcribe again' : 'Transcribe';
  txBtn.classList.toggle('key-quiet', hasTranscript);
  txBtn.classList.toggle('key-primary', !hasTranscript);
  txBtn.hidden = !hasAudio;
  txBtn.addEventListener('click', async () => {
    const err = node.querySelector('.tx-error');
    err.hidden = true;
    txBtn.disabled = true;
    try {
      showTx(await api('/api/transcribe/' + r.id, { model: $('whisperModel').value || undefined }), true);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      txBtn.disabled = false;
    }
  });
  node.querySelector('.tx-cancel').addEventListener('click', () => api('/api/transcribe-cancel').catch(() => {}));
  if (hasTranscript) loadTranscript(node, r.id, isLocal);
  syncTxButtons(node);

  const fileInput = node.querySelector('.act-merge input');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const err = node.querySelector('.tx-error');
    err.hidden = true;
    try {
      await api('/api/merge/' + r.id, { filename: f.name, content: await f.text() });
      await refreshRecording(r.id);
    } catch (e) {
      err.textContent = 'Could not use that file: ' + e.message;
      err.hidden = false;
    }
    fileInput.value = '';
  });

  // whole-meeting overview
  const canvas = node.querySelector('.rec-overview');
  if (r.segments) {
    fetch(`/rec/${r.id}/speakers.json`)
      .then((x) => x.json())
      .then(({ segments }) => {
        const names = [...new Set(segments.map((g) => g.speaker))];
        const lanes = names.map((n) => ({ key: n, name: n, color: colorOf('name:' + n) }));
        const segs = segments.map((g) => ({ key: g.speaker, start: g.start, end: g.end }));
        const draw = () => drawLanes(canvas, lanes, segs, { start: 0, end: Math.max(r.durationSec, 1), laneH: 12, labels: true });
        requestAnimationFrame(draw);
        new ResizeObserver(draw).observe(canvas.parentElement);
      })
      .catch(() => {});
  }
  return node;
}

// ---------- transcription ----------
let whisper = null;
let tx = null; // latest transcription snapshot from the server
const recNode = (id) => document.querySelector(`.rec-item[data-id="${CSS.escape(id)}"]`);

async function loadWhisper() {
  const box = $('whisperInfo');
  try {
    whisper = await fetch('/api/whisper').then((r) => r.json());
  } catch {
    whisper = { available: false, reason: 'Could not check for the transcriber.' };
  }
  box.dataset.state = whisper.available ? 'ready' : 'missing';
  const where = whisper.device && whisper.device !== 'cpu' ? whisper.gpu || 'the graphics card' : 'the processor';
  const sel = $('whisperModel');
  if (whisper.available) {
    $('whisperText').textContent = whisper.models.length > 1 ? `Transcriber ready on ${where}, model` : `Transcriber ready (Whisper ${whisper.models[0].name}, ${where})`;
    sel.replaceChildren(...whisper.models.map((m) => el('option', { value: m.name }, m.name)));
    sel.hidden = whisper.models.length < 2;
  } else {
    $('whisperText').textContent = whisper.engine
      ? 'The transcriber needs its model once.'
      : 'The transcriber is not installed yet. Open the app with "Start Meet Recorder" to set it up.';
    sel.hidden = true;
  }
  // first run on a new computer: one button downloads the model
  let get = $('whisperGet');
  if (!get) {
    get = el('button', { id: 'whisperGet', class: 'key key-primary key-sm', type: 'button', hidden: '' });
    get.addEventListener('click', async () => {
      get.disabled = true;
      try {
        showWhisperSetup(await api('/api/whisper/setup'));
      } catch (e) {
        $('whisperText').textContent = e.message;
        get.disabled = false;
      }
    });
    box.append(get);
  }
  const big = whisper.device === 'cuda';
  get.textContent = `Get it (${big ? '3.1' : '1.6'} GB)`;
  get.hidden = !(whisper.engine && !whisper.available);
  document.querySelectorAll('.rec-item').forEach(syncTxButtons);
}

function showWhisperSetup(s) {
  if (!s) return;
  const get = $('whisperGet');
  if (s.status === 'running') {
    if (get) get.hidden = true;
    const gb = (n) => (n / 1e9).toFixed(1);
    $('whisperText').textContent = `Downloading Whisper ${s.name}: ${gb(s.got)} of ${gb(s.total)} GB (${Math.floor(s.percent)}%)`;
  } else if (s.status === 'done' && !(whisper && whisper.available)) {
    loadWhisper();
  } else if (s.status === 'error') {
    $('whisperText').textContent = 'The download stopped: ' + s.error;
    if (get) { get.hidden = false; get.disabled = false; }
  }
}

function syncTxButtons(node) {
  const b = node.querySelector('.act-transcribe');
  const busy = tx && ['loading', 'running', 'merging'].includes(tx.status);
  b.disabled = !!busy || (whisper && !whisper.available);
  b.title = whisper && !whisper.available ? whisper.reason || '' : busy && tx.id !== node.dataset.id ? 'Another recording is being transcribed' : '';
}

const LINE = /^\[(\d\d:\d\d:\d\d) - (\d\d:\d\d:\d\d)\] (.*)$/;
// names can contain brackets themselves: "Sara (2) (over: Ali (3)): text"
const WHO = /^(.+?)(?: \(over: (.*?)\))?: (.*)$/;
async function loadTranscript(node, id, isLocal) {
  const box = node.querySelector('.rec-transcript');
  const text = await fetch(`/rec/${id}/transcript.txt`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (!text.trim()) {
    box.querySelector('.tx-meta').textContent = 'No speech was found in this recording.';
    box.querySelector('.tx-copy').hidden = true;
    box.querySelector('.tx-lines').replaceChildren();
    box.hidden = false;
    return;
  }
  const lines = text.trim().split('\n');
  const speakers = new Set();
  const items = lines.map((raw) => {
    const m = LINE.exec(raw);
    if (!m) return el('li', { class: 'tx-line' }, el('time', {}, ''), el('div', { class: 'tx-say' }, el('div', { class: 'tx-text', dir: 'auto' }, raw)));
    const time = m[1].replace(/^00:/, '');
    const w = isLocal ? null : WHO.exec(m[3]);
    const say = el('div', { class: 'tx-say' });
    if (w) {
      speakers.add(w[1]);
      say.append(el('span', { class: 'tx-who', style: `--c:${colorOf('name:' + w[1])}` }, el('bdi', {}, w[1]), w[2] ? el('span', { class: 'tx-over' }, ' over ', el('bdi', {}, w[2])) : null));
    }
    say.append(el('span', { class: 'tx-text', dir: 'auto' }, w ? w[3] : m[3]));
    return el('li', { class: 'tx-line' }, el('time', {}, time), say);
  });
  const list = box.querySelector('.tx-lines');
  list.replaceChildren(...items);
  box.querySelector('.tx-meta').textContent = isLocal ? plural(lines.length, 'line') : `${plural(lines.length, 'turn')} · ${plural(speakers.size, 'speaker')}`;
  const more = box.querySelector('.tx-more');
  const long = lines.length > 7;
  more.hidden = !long;
  if (long) box.dataset.collapsed = '';
  more.onclick = () => {
    const collapsed = 'collapsed' in box.dataset;
    if (collapsed) delete box.dataset.collapsed;
    else box.dataset.collapsed = '';
    more.textContent = collapsed ? 'Show less' : 'Show the whole transcript';
  };
  const copy = box.querySelector('.tx-copy');
  copy.onclick = async () => {
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
    copy.textContent = 'Copied';
    copy.dataset.copied = '';
    clearTimeout(copy._t);
    copy._t = setTimeout(() => {
      copy.textContent = 'Copy transcript';
      delete copy.dataset.copied;
    }, 1800);
  };
  box.hidden = false;
}

async function refreshRecording(id) {
  const fresh = (await fetch('/api/recordings').then((x) => x.json()).catch(() => [])).find((x) => x.id === id);
  const node = recNode(id);
  if (fresh && node) node.replaceWith(renderRecording(fresh));
  else if (fresh) loadRecordings();
}

function showTx(t, started) {
  const prev = started ? { ...t, status: 'started' } : tx;
  tx = t;
  document.querySelectorAll('.rec-item').forEach(syncTxButtons);
  if (!t) return;
  const node = recNode(t.id);
  if (!node) return;
  const prog = node.querySelector('.tx-progress');
  const active = ['loading', 'running', 'merging'].includes(t.status);
  prog.hidden = !active;
  if (active) {
    const model = t.model ? `Whisper ${t.model}` : 'Whisper';
    const where = t.device === 'cpu' ? 'the processor' : (whisper && whisper.gpu) || 'the graphics card';
    prog.dataset.phase = t.status;
    const pct = t.status === 'loading' ? 0 : t.percent;
    node.querySelector('.tx-pct').textContent = t.status === 'loading' ? '…' : `${Math.floor(pct)}%`;
    node.querySelector('.tx-label').textContent =
      t.status === 'loading'
        ? `Loading ${model}…`
        : t.status === 'merging'
          ? 'Adding the speaker names…'
          : `Writing the transcript: ${mmss(t.at)} of ${mmss(t.duration)} done` + (t.etaSec != null && t.percent > 2 ? `, about ${mmss(t.etaSec)} left` : '') + ` (${model} on ${where})`;
    node.querySelector('.tx-track > span').style.transform = t.status === 'loading' ? '' : `scaleX(${(pct / 100).toFixed(4)})`;
    node.querySelector('.tx-track').setAttribute('aria-valuenow', Math.floor(pct));
  }
  const changed = !prev || prev.id !== t.id || prev.status !== t.status;
  if (!changed || !prev) return; // only react to transitions seen live
  if (t.status === 'done') refreshRecording(t.id);
  if (t.status === 'error') {
    const err = node.querySelector('.tx-error');
    err.textContent = 'The transcript failed: ' + t.error;
    err.hidden = false;
  }
}

// ---------- wiring ----------
$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('joinForm').querySelector('button');
  $('joinError').textContent = '';
  if (local) {
    $('joinError').textContent = 'A microphone recording is running. Stop it first.';
    return;
  }
  btn.disabled = true;
  try {
    const s = await api('/api/join', { url: $('url').value, name: $('name').value, show: $('show').checked });
    snap = s;
    receivedAt = performance.now();
    lastPreviewAt = 0;
    localDone = null;
    $('preview').hidden = true;
    $('previewEmpty').hidden = false;
    render();
  } catch (err) {
    $('joinError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('localBtn').addEventListener('click', startLocal);
$('stopBtn').addEventListener('click', async () => {
  if (local) return stopLocal();
  $('stopBtn').disabled = true;
  try {
    await api('/api/stop');
  } catch {
    $('stopBtn').disabled = false;
  }
});
$('againBtn').addEventListener('click', () => {
  dismissedId = snap && snap.id;
  localDone = null;
  render();
  $('url').focus();
});
window.addEventListener('beforeunload', (e) => {
  if (local) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (m) => {
    const data = JSON.parse(m.data);
    snap = data.current;
    receivedAt = performance.now();
    render();
    showTx(data.transcribe || null);
    if (window.onVoiceState) window.onVoiceState(data);
    if (data.whisperSetup) showWhisperSetup(data.whisperSetup);
    if (data.update) showUpdate(data.update);
  };
}

// ---------- updates ----------
let update = null;
function showUpdate(u) {
  update = u;
  const btn = $('updateBtn');
  const text = $('updateText');
  const busy = u.status === 'checking' || u.status === 'updating' || u.status === 'updated';
  btn.disabled = busy;
  btn.textContent = u.status === 'available' ? 'Update now' : 'Check for updates';
  btn.hidden = u.status === 'updated';
  text.textContent =
    u.status === 'checking' ? 'Checking…'
      : u.status === 'available' ? 'A new version is ready'
        : u.status === 'updating' ? 'Updating…'
          : u.status === 'updated' ? 'Updated. Restarting…'
            : u.status === 'current' ? 'Up to date'
              : u.status === 'error' ? u.error
                : '';
  text.title = u.latest && u.status === 'available' ? u.latest.message : '';
  $('update').dataset.state = u.status;
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
$('updateBtn').addEventListener('click', async () => {
  const apply = update && update.status === 'available';
  try {
    showUpdate(await api(apply ? '/api/update/apply' : '/api/update/check'));
  } catch (e) {
    $('updateText').textContent = e.message;
  }
});

// "Open folder" in the words of this computer
const SHOW_IN = /Mac/.test(navigator.platform || navigator.userAgent) ? 'Show in Finder' : /Win/.test(navigator.platform || navigator.userAgent) ? 'Show in File Explorer' : 'Open folder';
function nameFolderButtons(root = document) {
  root.querySelectorAll('.act-open, [data-open-folder]').forEach((b) => (b.textContent = SHOW_IN));
}

// what the browser's share picker will ask, in its own words for this computer
function callHelp(failed) {
  const mac = /Mac/.test(navigator.platform || navigator.userAgent);
  const how = mac
    ? 'choose the tab your meeting is in and keep "Also share tab audio" on'
    : 'choose "Entire screen" and switch on "Also share system audio"';
  return failed
    ? `The call's sound wasn't shared, so recording didn't start. Press Record again, then ${how}.`
    : `When the browser asks what to share, ${how}.`;
}
function localHint() {
  $('localHint').textContent = $('localCall').checked ? callHelp(false) : 'Your browser will ask to use the microphone.';
}
try {
  const call = localStorage.getItem('mrb.localCall');
  if (call !== null) $('localCall').checked = call === '1';
} catch {}
localHint();
$('localCall').addEventListener('change', () => {
  localHint();
  try { localStorage.setItem('mrb.localCall', $('localCall').checked ? '1' : '0'); } catch {}
});

try {
  const remembered = localStorage.getItem('mrb.name');
  if (remembered) $('name').value = remembered;
  $('name').addEventListener('change', () => {
    try { localStorage.setItem('mrb.name', $('name').value); } catch {}
  });
} catch {}

connect();
loadRecordings().then(() => showTx(tx));
loadWhisper();
requestAnimationFrame(frame);
