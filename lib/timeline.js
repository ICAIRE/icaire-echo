// Turns the raw tile-mutation log (events.ndjson) into "who spoke when" segments.
//
// Idea: Meet changes classes/styles inside a participant's tile while they talk (sound bars,
// highlight border). We don't rely on Meet's obfuscated class names. Instead:
//   1. Find the element slots ("keys") that change most often across all tiles: that's the indicator.
//   2. For each key, its "quiet" value is the one it holds for the most total time.
//   3. A person is speaking while any indicator key in their tile is not in its quiet value.
//   4. Close small gaps, drop blips.
const fs = require('fs');

const DEFAULTS = {
  gapMs: 700,
  minMs: 300,
  tailMs: 150,
  keyShare: 0.15,
  minKeyChanges: 20,
  levelGapMs: 500, // sound-bar changes further apart than this end a burst
  levelMinChanges: 3, // a burst needs this many changes (Meet's idle blink is 2 changes ~0.4 s apart)
};

function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function buildTimeline(events, { durationMs, names = {}, ignorePids = new Set(), ...opts } = {}) {
  const o = { ...DEFAULTS, ...opts };
  const end = durationMs || (events.length ? events[events.length - 1].t + 1000 : 0);

  // per tile, per key: ordered changes
  const tiles = new Map();
  const keyTotals = new Map();
  for (const e of events) {
    if (ignorePids.has(e.p)) continue;
    if (!tiles.has(e.p)) tiles.set(e.p, new Map());
    const keys = tiles.get(e.p);
    if (!keys.has(e.k)) keys.set(e.k, []);
    keys.get(e.k).push(e);
    keyTotals.set(e.k, (keyTotals.get(e.k) || 0) + 1);
  }

  const top = Math.max(0, ...keyTotals.values());
  const indicatorKeys = new Set(
    [...keyTotals].filter(([, n]) => n >= o.minKeyChanges && n >= top * o.keyShare).map(([k]) => k)
  );

  // quiet value per key = value held longest, summed over all tiles
  const held = new Map(); // key -> Map(value -> ms)
  const add = (k, v, ms) => {
    if (ms <= 0) return;
    if (!held.has(k)) held.set(k, new Map());
    const m = held.get(k);
    m.set(v, (m.get(v) || 0) + ms);
  };
  for (const keys of tiles.values()) {
    for (const [k, list] of keys) {
      if (!indicatorKeys.has(k)) continue;
      let prevT = 0;
      let val = list[0].o;
      for (const e of list) {
        add(k, val, e.t - prevT);
        prevT = e.t;
        val = e.n;
      }
      add(k, val, end - prevT);
    }
  }
  const quiet = new Map();
  for (const [k, m] of held) quiet.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);

  // Two kinds of indicator:
  //  - "level" keys take 3+ values (sound bars). Real Meet (Nov 2026) cycles them while someone talks, then
  //    FREEZES them on a low level (blinking every ~2 s) instead of going back to quiet. So for these keys a
  //    person is talking while the bars keep changing: bursts of >= levelMinChanges changes, each <= levelGapMs apart.
  //  - "state" keys take 2 values (on/off border). Talking = not in the quiet value. Real Meet also has a
  //    sticky "last active speaker" highlight like this, which stays on long after they stop; when level keys
  //    exist, state keys are ignored for that reason.
  const values = new Map();
  for (const keys of tiles.values()) {
    for (const [k, list] of keys) {
      if (!indicatorKeys.has(k)) continue;
      if (!values.has(k)) values.set(k, new Set());
      for (const e of list) values.get(k).add(e.o).add(e.n);
    }
  }
  const levelKeys = new Set([...values].filter(([, v]) => v.size >= 3).map(([k]) => k));

  // active intervals per tile
  const segments = [];
  for (const [pid, keys] of tiles) {
    const raw = [];
    if (levelKeys.size) {
      const times = [...new Set([...keys].filter(([k]) => levelKeys.has(k)).flatMap(([, list]) => list.map((e) => e.t)))].sort((a, b) => a - b);
      let burst = [];
      const flush = () => {
        if (burst.length >= o.levelMinChanges) raw.push([burst[0], burst[burst.length - 1]]);
        burst = [];
      };
      for (const t of times) {
        if (burst.length && t - burst[burst.length - 1] > o.levelGapMs) flush();
        burst.push(t);
      }
      flush();
    } else {
      for (const [k, list] of keys) {
        if (!indicatorKeys.has(k)) continue;
        const q = quiet.get(k);
        let val = list[0].o;
        let since = 0;
        for (const e of list) {
          if (val !== q) raw.push([since, e.t]);
          since = e.t;
          val = e.n;
        }
        if (val !== q) raw.push([since, end]);
      }
    }
    raw.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [s, e] of raw) {
      const last = merged[merged.length - 1];
      if (last && s - last[1] <= o.gapMs) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    const speaker = displayName(names[pid], pid);
    for (const [s, e] of merged) {
      const e2 = Math.min(end, e + o.tailMs);
      if (e2 - s >= o.minMs) segments.push({ speaker, pid, start: s / 1000, end: e2 / 1000 });
    }
  }
  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  // Two tiles with the same name (namesakes, or one person on two devices) must not merge into one
  // speaker: number them in the order they first spoke, "Sara", "Sara (2)".
  const byName = new Map();
  for (const g of segments) {
    if (!byName.has(g.speaker)) byName.set(g.speaker, []);
    const pids = byName.get(g.speaker);
    if (!pids.includes(g.pid)) pids.push(g.pid);
  }
  for (const g of segments) {
    const pids = byName.get(g.speaker);
    const i = pids.indexOf(g.pid);
    if (pids.length > 1 && i > 0) g.speaker = `${g.speaker} (${i + 1})`;
  }
  return { segments, indicatorKeys: [...indicatorKeys], options: o };
}

function displayName(list, pid) {
  if (Array.isArray(list) && list.length) return list[0];
  if (typeof list === 'string' && list) return list;
  return 'Unknown ' + String(pid).slice(-6);
}

function ts(sec, sep = '.') {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

function toCsv(segments) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return (
    'speaker,start,end,start_sec,end_sec\n' +
    segments.map((g) => [q(g.speaker), ts(g.start), ts(g.end), g.start.toFixed(3), g.end.toFixed(3)].join(',')).join('\n') +
    '\n'
  );
}

function toSrt(items, textOf) {
  return items.map((g, i) => `${i + 1}\n${ts(g.start, ',')} --> ${ts(g.end, ',')}\n${textOf(g)}\n`).join('\n');
}

module.exports = { readEvents, buildTimeline, toCsv, toSrt, ts, DEFAULTS };
