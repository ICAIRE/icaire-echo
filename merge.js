#!/usr/bin/env node
// Usage: node merge.js <recording-folder> <whisper-output.(json|srt|vtt)>
// Adds speaker names to a Whisper transcript using the bot's speakers.json.
// Writes transcript.txt / transcript.srt / transcript.json into the recording folder.
//
// Accepted Whisper outputs:
//   - openai-whisper / faster-whisper / WhisperX JSON  ({ segments: [{ start, end, text, words? }] })
//   - whisper.cpp JSON                                  ({ transcription: [{ offsets: { from, to }, text }] })
//   - any .srt or .vtt subtitle file
// Word timestamps (e.g. whisper --word_timestamps True) give the best results with interruptions.
const fs = require('fs');
const path = require('path');
const { ts, toSrt } = require('./lib/timeline');

function parseTime(s) {
  const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(s);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +('0.' + m[4]);
}

function loadWhisper(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/\.json$/i.test(file)) {
    const j = JSON.parse(raw);
    if (Array.isArray(j.segments)) {
      return j.segments.map((s) => ({
        start: +s.start,
        end: +s.end,
        text: String(s.text || '').trim(),
        words: Array.isArray(s.words)
          ? s.words
              .filter((w) => Number.isFinite(+w.start) && Number.isFinite(+w.end))
              .map((w) => ({ start: +w.start, end: +w.end, text: String(w.word ?? w.text ?? '') }))
          : null,
      }));
    }
    if (Array.isArray(j.transcription)) {
      return j.transcription.map((s) => ({
        start: s.offsets.from / 1000,
        end: s.offsets.to / 1000,
        text: String(s.text || '').trim(),
        words: null,
      }));
    }
    throw new Error('Unrecognized JSON: expected "segments" (openai/faster-whisper) or "transcription" (whisper.cpp).');
  }
  // SRT / VTT
  const out = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    out.push({ start: parseTime(a), end: parseTime(b), text: lines.slice(i + 1).join(' ').trim(), words: null });
  }
  return out;
}

const HANDOVER_S = 0.8; // how long a stopped speaker's indicator may still be glowing
const ONSET_LAG_S = 0.4; // how late a new speaker's indicator may light up after they start

function speakerFor(start, end, segs) {
  const dur = Math.max(0.001, end - start);
  // speaker -> { o: overlap seconds, onset: latest segment start, until: latest segment end } over this span
  const ov = new Map();
  for (const g of segs) {
    if (g.end <= start || g.start >= end) continue;
    const o = Math.min(end, g.end) - Math.max(start, g.start);
    const cur = ov.get(g.speaker) || { o: 0, onset: -Infinity, until: -Infinity };
    ov.set(g.speaker, { o: cur.o + o, onset: Math.max(cur.onset, g.start), until: Math.max(cur.until, g.end) });
  }
  if (ov.size) {
    // Most overlap wins. When two speakers cover the word about equally (cross-talk), the one who
    // started talking most recently is the one interrupting, so the word is theirs.
    const ranked = [...ov].sort((a, b) => (Math.abs(b[1].o - a[1].o) > 0.1 * dur ? b[1].o - a[1].o : b[1].onset - a[1].onset));
    // Handover: Meet's indicator keeps glowing for a moment after someone stops. If this word begins
    // about when another person starts talking (their indicator can light up a little late), the top
    // speaker's segment ends within HANDOVER_S of it, and the newcomer keeps going past that point,
    // the word is the start of the newcomer's turn.
    const [top, tv] = ranked[0];
    const next = ranked.find(
      ([s, v]) => s !== top && v.onset > tv.onset && start >= v.onset - ONSET_LAG_S && v.until > tv.until && tv.until - end <= HANDOVER_S
    );
    if (next) {
      const rest = ranked.filter(([s]) => s !== next[0]);
      return { speaker: next[0], also: rest.filter(([, v]) => v.o / dur >= 0.3).map(([s]) => s) };
    }
    return { speaker: top, also: ranked.slice(1).filter(([, v]) => v.o / dur >= 0.3).map(([s]) => s) };
  }
  // No overlap: nearest segment within 1 s (indicator lag), else unknown.
  let best = null;
  let bestD = 1.0;
  for (const g of segs) {
    const d = g.end < start ? start - g.end : g.start > end ? g.start - end : 0;
    if (d < bestD) (bestD = d), (best = g.speaker);
  }
  return { speaker: best || 'Unknown', also: [] };
}

function merge(whisper, segs) {
  const units = [];
  for (const s of whisper) {
    if (s.words && s.words.length) for (const w of s.words) units.push({ ...w, ...speakerFor(w.start, w.end, segs) });
    else units.push({ start: s.start, end: s.end, text: s.text, ...speakerFor(s.start, s.end, segs) });
  }
  const turns = [];
  for (const u of units) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === u.speaker && u.start - last.end < 1.5) {
      last.end = Math.max(last.end, u.end);
      last.text = joinText(last.text, u.text);
      for (const a of u.also) if (!last.also.includes(a)) last.also.push(a);
    } else turns.push({ speaker: u.speaker, start: u.start, end: u.end, text: u.text.trim(), also: [...u.also] });
  }
  for (const t of turns) t.text = t.text.replace(/\s+/g, ' ').trim();
  return turns.filter((t) => t.text);
}

function joinText(a, b) {
  if (!a) return b.trim();
  return /^\s/.test(b) || /^[,.!?;:،؟]/.test(b) ? a + b : a + ' ' + b;
}

// Labels a Whisper output with the recording's speakers and writes transcript.txt / .srt / .json.
function writeTranscript(dir, whisperFile) {
  let segs = [];
  try { segs = JSON.parse(fs.readFileSync(path.join(dir, 'speakers.json'), 'utf8')).segments || []; } catch {}
  const turns = merge(loadWhisper(whisperFile), segs);
  // A microphone recording made without a meeting has no speaker timeline: write plain lines, no "Unknown:".
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch {}
  const named = !(meta.kind === 'local' && !segs.length);
  const label = (t) => t.speaker + (t.also.length ? ` (over: ${t.also.join(', ')})` : '');
  const line = (t) => (named ? `${label(t)}: ${t.text}` : t.text);
  const txt = turns.map((t) => `[${ts(t.start).slice(0, 8)} - ${ts(t.end).slice(0, 8)}] ${line(t)}`).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'transcript.txt'), txt);
  fs.writeFileSync(path.join(dir, 'transcript.srt'), toSrt(turns, line));
  fs.writeFileSync(path.join(dir, 'transcript.json'), JSON.stringify({ turns }, null, 2));
  return { turns, txt, unknown: turns.filter((t) => t.speaker === 'Unknown').length };
}

function main() {
  const [dir, file] = process.argv.slice(2);
  if (!dir || !file) {
    console.log('Usage: node merge.js <recording-folder> <whisper-output.json|.srt|.vtt>');
    process.exit(1);
  }
  const { turns, unknown } = writeTranscript(dir, file);
  console.log(`Wrote ${turns.length} turns to ${path.join(dir, 'transcript.txt')}` + (unknown ? ` (${unknown} with unknown speaker)` : ''));
}

if (require.main === module) main();
module.exports = { loadWhisper, merge, speakerFor, writeTranscript };
