// Post-meeting processing: raw recordings -> video.mp4 + audio.wav (16 kHz mono, what Whisper wants),
// plus meta.json and the speaker timeline files. Async so the control panel stays live meanwhile.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { readEvents, buildTimeline, toCsv, toSrt } = require('./timeline');

function ff(args) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-y', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ ok: code === 0, stderr: err }));
    p.on('error', (e) => resolve({ ok: false, stderr: String(e) }));
  });
}

async function probeDurationMs(file) {
  if (!fs.existsSync(file)) return 0;
  const { stderr } = await ff(['-i', file]);
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  return m ? Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000) : 0;
}

const lastLines = (s) => s.trim().split(/\r?\n/).slice(-4).join(' | ');
const isBotName = (names, botName) => (names || []).some((x) => x === botName || /^you$/i.test(x) || /\(you\)/i.test(x));
const botPidsOf = (names, botName) => new Set(Object.entries(names).filter(([, n]) => isBotName(n, botName)).map(([p]) => p));

async function finalize({ outDir, state, botName, meetUrl, log = () => {} }) {
  const out = (n) => path.join(outDir, n);
  const has = (n) => fs.existsSync(out(n)) && fs.statSync(out(n)).size > 0;
  const notes = [];

  if (has('video.part')) {
    log('Converting video to MP4...');
    const r = await ff(['-fflags', '+genpts', '-i', out('video.part'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out('video.mp4')]);
    if (r.ok) fs.unlinkSync(out('video.part'));
    else {
      const ext = (state.info?.videoMime || '').startsWith('video/mp4') ? '.mp4' : '.webm';
      fs.renameSync(out('video.part'), out('video-unprocessed' + ext));
      notes.push('Video conversion failed; kept the raw file. ffmpeg: ' + lastLines(r.stderr));
    }
  }
  if (has('audio.part')) {
    log('Extracting audio.wav for Whisper...');
    const r = await ff(['-i', out('audio.part'), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out('audio.wav')]);
    if (r.ok) fs.unlinkSync(out('audio.part')); // one audio file per meeting: audio.wav
    else notes.push('Audio conversion failed; kept audio.part. ffmpeg: ' + lastLines(r.stderr));
  }
  for (const n of ['video.part', 'audio.part']) if (fs.existsSync(out(n)) && !has(n)) fs.unlinkSync(out(n));

  const durationMs = state.durationMs || (await probeDurationMs(out('audio.wav')));
  const botPids = botPidsOf(state.names, botName);
  const meta = {
    meetUrl,
    botName,
    startedAt: state.info?.startedAt,
    durationSec: durationMs / 1000,
    videoMime: state.info?.videoMime,
    participants: state.names,
    nameHistory: state.nameHistory,
    botParticipantIds: [...botPids],
    rawEventCount: state.eventCount,
  };
  fs.writeFileSync(out('meta.json'), JSON.stringify(meta, null, 2));
  log('Writing speaker timeline...');
  notes.push(...writeTimeline(outDir, { durationMs, names: state.names, ignorePids: botPids }));
  return notes;
}

function writeTimeline(outDir, opts) {
  const out = (n) => path.join(outDir, n);
  const events = readEvents(out('events.ndjson'));
  const { segments, indicatorKeys } = buildTimeline(events, opts);
  fs.writeFileSync(out('speakers.json'), JSON.stringify({ segments }, null, 2));
  fs.writeFileSync(out('speakers.csv'), toCsv(segments));
  fs.writeFileSync(out('speakers.srt'), toSrt(segments, (g) => g.speaker));
  const notes = [];
  if (!events.length) notes.push('No speaking-indicator events were captured, so the speaker files are empty.');
  else if (!segments.length) notes.push(`${events.length} raw events but no speech segments found (indicator keys: ${indicatorKeys.length}).`);
  return notes;
}

module.exports = { finalize, writeTimeline, probeDurationMs, botPidsOf, isBotName };
