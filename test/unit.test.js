// Unit tests for the speaker-timeline builder and the Whisper merge. Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildTimeline, toCsv, toSrt, ts } = require('../lib/timeline');
const { loadWhisper, merge, speakerFor } = require('../merge');

// --- synthetic event generators (mimic what page/agent.js logs) ---
const KEY_BARS = ['div0>div0>b0|class', 'div0>div0>b1|class', 'div0>div0>b2|class'];
function barsEvents(pid, from, to, { hz = 12 } = {}) {
  const ev = [];
  const prev = {};
  for (let t = from; t < to; t += 1000 / hz) {
    for (const k of KEY_BARS) {
      const n = 'l' + (1 + Math.floor(Math.random() * 3));
      const o = prev[k] ?? '';
      if (n !== o) ev.push({ t: Math.round(t), p: pid, k, o, n });
      prev[k] = n;
    }
  }
  for (const k of KEY_BARS) if (prev[k]) ev.push({ t: to, p: pid, k, o: prev[k], n: '' });
  return ev;
}
function borderEvents(pid, from, to) {
  return [
    { t: from, p: pid, k: '.|class', o: 'tile', n: 'tile spk' },
    { t: to, p: pid, k: '.|class', o: 'tile spk', n: 'tile' },
  ];
}
const sortT = (a) => a.sort((x, y) => x.t - y.t);
const near = (a, b, tol = 0.25) => Math.abs(a - b) <= tol;

test('animated-bars indicator: separate and overlapping speakers', () => {
  const events = sortT([
    ...barsEvents('A', 1000, 3000),
    ...barsEvents('B', 2500, 5000),
    ...barsEvents('A', 6000, 7200),
  ]);
  const { segments } = buildTimeline(events, { durationMs: 9000, names: { A: ['Alice'], B: ['Bob'] } });
  assert.equal(segments.length, 3);
  const [a1, b1, a2] = segments;
  assert.equal(a1.speaker, 'Alice');
  assert.ok(near(a1.start, 1.0) && near(a1.end, 3.0), JSON.stringify(a1));
  assert.equal(b1.speaker, 'Bob');
  assert.ok(near(b1.start, 2.5) && near(b1.end, 5.0), JSON.stringify(b1));
  assert.ok(b1.start < a1.end, 'overlap preserved');
  assert.ok(near(a2.start, 6.0) && near(a2.end, 7.2), JSON.stringify(a2));
});

test('border-only indicator (on/off toggles) works when there are enough utterances', () => {
  const events = [];
  for (let i = 0; i < 15; i++) {
    events.push(...borderEvents('A', i * 4000, i * 4000 + 1500));
    events.push(...borderEvents('B', i * 4000 + 2000, i * 4000 + 3000));
  }
  const { segments } = buildTimeline(sortT(events), { durationMs: 62000, names: { A: ['Ann'], B: ['Ben'] } });
  assert.equal(segments.filter((g) => g.speaker === 'Ann').length, 15);
  assert.equal(segments.filter((g) => g.speaker === 'Ben').length, 15);
  const first = segments[0];
  assert.ok(near(first.start, 0) && near(first.end, 1.5), JSON.stringify(first));
});

test('short pauses inside one utterance are bridged; real pauses split turns', () => {
  const events = sortT([...barsEvents('A', 1000, 2000), ...barsEvents('A', 2400, 3000), ...barsEvents('A', 5000, 6000)]);
  const { segments } = buildTimeline(events, { durationMs: 8000, names: { A: ['A'] } });
  assert.equal(segments.length, 2);
  assert.ok(near(segments[0].end, 3.0));
});

test('rare unrelated changes (mute icon, hand raise) are not counted as speech', () => {
  const events = sortT([
    ...barsEvents('A', 1000, 4000),
    ...barsEvents('B', 5000, 8000),
    { t: 4500, p: 'C', k: 'div2>i0|class', o: 'mic', n: 'mic-off' },
    { t: 9000, p: 'C', k: 'div2>i0|class', o: 'mic-off', n: 'mic' },
    { t: 9500, p: 'C', k: 'div3|style', o: '', n: 'opacity: 1' },
  ]);
  const { segments } = buildTimeline(events, { durationMs: 12000, names: { A: ['A'], B: ['B'], C: ['C'] } });
  assert.deepEqual([...new Set(segments.map((g) => g.speaker))].sort(), ['A', 'B']);
});

test('ignorePids excludes the bot; blips shorter than minMs are dropped', () => {
  // A talks long enough (4 s) that its indicator clears minKeyChanges regardless of the random flicker.
  const events = sortT([...barsEvents('A', 1000, 5000), ...barsEvents('BOT', 1000, 5000), ...barsEvents('A', 7000, 7100)]);
  const { segments } = buildTimeline(events, { durationMs: 8000, names: { A: ['A'], BOT: ['Recorder'] }, ignorePids: new Set(['BOT']) });
  assert.ok(segments.every((g) => g.speaker === 'A'));
  assert.equal(segments.length, 1);
});

test('speaker still talking at the end of the recording gets an open-ended segment', () => {
  const events = sortT([...barsEvents('A', 1000, 3000), ...barsEvents('A', 4000, 99999).filter((e) => e.t < 6000)]);
  const { segments } = buildTimeline(events, { durationMs: 6000, names: { A: ['A'] } });
  assert.ok(near(segments[segments.length - 1].end, 6.0), JSON.stringify(segments));
});

test('no events -> empty timeline; unknown names get a stable fallback', () => {
  assert.deepEqual(buildTimeline([], { durationMs: 1000 }).segments, []);
  const { segments } = buildTimeline(sortT(barsEvents('spaces/x/devices/123456', 0, 4000)), { durationMs: 5000 });
  assert.equal(segments[0].speaker, 'Unknown 123456');
});

test('8 people talking over each other, 10 minutes', () => {
  const people = 'ABCDEFGH'.split('');
  const truth = [];
  let t = 0;
  for (let i = 0; i < 160; i++) {
    const p = people[i % 8];
    const len = 1500 + ((i * 7919) % 3000);
    truth.push({ p, from: t, to: t + len });
    t += len - (i % 3 === 0 ? 600 : -900); // every 3rd turn interrupts the previous one
  }
  const events = sortT(truth.flatMap((x) => barsEvents(x.p, x.from, x.to)));
  const names = Object.fromEntries(people.map((p) => [p, ['Person ' + p]]));
  const { segments } = buildTimeline(events, { durationMs: t + 5000, names });
  let matched = 0;
  for (const x of truth) {
    if (segments.some((g) => g.pid === x.p && near(g.start, x.from / 1000) && near(g.end, x.to / 1000))) matched++;
  }
  assert.ok(matched / truth.length > 0.97, `matched ${matched}/${truth.length}`);
});

// Real Meet (Nov 2026): after speech the bars freeze on a low level and one bar blinks every ~2 s (two changes
// ~0.4 s apart), and a sticky "last speaker" highlight stays on until someone else talks.
function frozenBlink(pid, from, to) {
  const ev = [];
  for (let t = from; t + 400 < to; t += 2000) {
    ev.push({ t, p: pid, k: KEY_BARS[0], o: 'l1', n: 'l1 blink' }, { t: t + 400, p: pid, k: KEY_BARS[0], o: 'l1 blink', n: 'l1' });
  }
  return ev;
}

test('real Meet: frozen bars blinking and a sticky highlight are not speech', () => {
  const events = sortT([
    ...barsEvents('A', 1000, 3000),
    ...frozenBlink('A', 4500, 20000),
    { t: 1000, p: 'A', k: '.|class', o: 'tile', n: 'tile last' },
    ...barsEvents('B', 10000, 12000),
    ...frozenBlink('B', 13500, 20000),
    { t: 10000, p: 'A', k: '.|class', o: 'tile last', n: 'tile' },
    { t: 10000, p: 'B', k: '.|class', o: 'tile', n: 'tile last' },
  ]);
  const { segments } = buildTimeline(events, { durationMs: 20000, names: { A: ['Ann'], B: ['Ben'] } });
  assert.equal(segments.length, 2, JSON.stringify(segments));
  assert.ok(near(segments[0].start, 1.0) && near(segments[0].end, 3.0, 0.5), JSON.stringify(segments[0]));
  assert.ok(near(segments[1].start, 10.0) && near(segments[1].end, 12.0, 0.5), JSON.stringify(segments[1]));
});

test('two tiles with the same name stay separate speakers, numbered by first speech', () => {
  const events = sortT([...barsEvents('X', 4000, 6000), ...barsEvents('Y', 1000, 3000), ...barsEvents('X', 7000, 8000)]);
  const { segments } = buildTimeline(events, { durationMs: 9000, names: { X: ['Sara'], Y: ['Sara'] } });
  assert.deepEqual(segments.map((g) => g.speaker), ['Sara', 'Sara (2)', 'Sara (2)']);
  assert.deepEqual(segments.map((g) => g.pid), ['Y', 'X', 'X']);
});

test('csv / srt / timestamps format', () => {
  const segs = [{ speaker: 'Al "the" Pal', pid: 'a', start: 3661.5, end: 3662.25 }];
  assert.equal(ts(3661.5), '01:01:01.500');
  assert.match(toCsv(segs), /"Al ""the"" Pal",01:01:01.500,01:01:02.250,3661.500,3662.250/);
  assert.match(toSrt(segs, (g) => g.speaker), /01:01:01,500 --> 01:01:02,250\nAl "the" Pal/);
});

// --- merge ---
const SPEAKERS = [
  { speaker: 'Alice', pid: 'a', start: 0.0, end: 4.0 },
  { speaker: 'Bob', pid: 'b', start: 3.6, end: 8.0 },
  { speaker: 'Alice', pid: 'a', start: 9.0, end: 10.0 },
];

test('merge with word timestamps splits a Whisper segment at the interruption', () => {
  const whisper = [
    {
      start: 0.2, end: 7.5, text: 'Hello everyone welcome sorry can I add something', words: [
        { start: 0.2, end: 0.6, text: ' Hello' }, { start: 0.7, end: 1.2, text: ' everyone' }, { start: 1.3, end: 1.9, text: ' welcome' },
        { start: 4.5, end: 4.9, text: ' sorry' }, { start: 5.0, end: 5.2, text: ' can' }, { start: 5.3, end: 5.4, text: ' I' },
        { start: 5.5, end: 5.8, text: ' add' }, { start: 5.9, end: 6.5, text: ' something' },
      ],
    },
  ];
  const turns = merge(whisper, SPEAKERS);
  assert.deepEqual(turns.map((t) => [t.speaker, t.text]), [
    ['Alice', 'Hello everyone welcome'],
    ['Bob', 'sorry can I add something'],
  ]);
});

test('merge without words assigns by max overlap and notes cross-talk', () => {
  const turns = merge([{ start: 3.0, end: 5.0, text: 'overlapping bit', words: null }], SPEAKERS);
  assert.equal(turns[0].speaker, 'Bob');
  assert.deepEqual(turns[0].also, ['Alice']);
});

test('merge: speech just outside a segment snaps to nearest speaker; far away is Unknown', () => {
  assert.equal(speakerFor(8.2, 8.4, SPEAKERS).speaker, 'Bob');
  assert.equal(speakerFor(20, 21, SPEAKERS).speaker, 'Unknown');
});

test('merge: handover — first word of an interruption goes to the new speaker, not the fading indicator', () => {
  // Alice stops talking ~15.0 but her indicator glows until 15.83; Bob starts at 15.4 and keeps going.
  const segs = [{ speaker: 'Alice', start: 12.4, end: 15.83 }, { speaker: 'Bob', start: 15.4, end: 19.08 }];
  assert.equal(speakerFor(15.3, 15.54, segs).speaker, 'Bob');
  assert.equal(speakerFor(14.56, 14.96, segs).speaker, 'Alice');
  // A whole sentence of Alice's (no word timings) that merely ends in the fade-out stays Alice's.
  assert.equal(speakerFor(12.45, 15.78, segs).speaker, 'Alice');
});

test('merge: a quick "yes" from Bob does not steal the words Alice keeps saying around it', () => {
  const segs = [{ speaker: 'Alice', start: 10, end: 20 }, { speaker: 'Bob', start: 14.0, end: 14.6 }];
  assert.equal(speakerFor(13.8, 14.1, segs).speaker, 'Alice');
  assert.equal(speakerFor(14.6, 14.9, segs).speaker, 'Alice');
});

test('merge handles Arabic / mixed-language text and punctuation joining', () => {
  const whisper = [{ start: 0.5, end: 2, text: '', words: [{ start: 0.5, end: 1, text: ' مرحبا' }, { start: 1.1, end: 1.3, text: '،' }, { start: 1.4, end: 2, text: ' hello' }] }];
  assert.equal(merge(whisper, SPEAKERS)[0].text, 'مرحبا، hello');
});

test('loadWhisper reads openai/faster-whisper JSON, whisper.cpp JSON, SRT and VTT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-w-'));
  const w = (n, s) => (fs.writeFileSync(path.join(dir, n), s), path.join(dir, n));
  const oa = loadWhisper(w('a.json', JSON.stringify({ text: 'x', segments: [{ start: 1, end: 2, text: ' hi', words: [{ word: ' hi', start: 1, end: 2 }] }] })));
  assert.equal(oa[0].words[0].text, ' hi');
  const cpp = loadWhisper(w('b.json', JSON.stringify({ transcription: [{ offsets: { from: 1500, to: 2500 }, text: ' yo' }] })));
  assert.deepEqual([cpp[0].start, cpp[0].end, cpp[0].text], [1.5, 2.5, 'yo']);
  const srt = loadWhisper(w('c.srt', 'ï»¿1\r\n00:00:01,000 --> 00:00:02,500\r\nfirst line\r\nsecond\r\n\r\n2\r\n00:01:00,000 --> 00:01:01,000\r\nnext\r\n'));
  assert.deepEqual(srt.map((s) => [s.start, s.end, s.text]), [[1, 2.5, 'first line second'], [60, 61, 'next']]);
  const vtt = loadWhisper(w('d.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nshort form\n'));
  assert.deepEqual([vtt[0].start, vtt[0].end], [1, 2]);
  assert.throws(() => loadWhisper(w('e.json', '{"foo":1}')), /Unrecognized/);
  fs.rmSync(dir, { recursive: true, force: true });
});
