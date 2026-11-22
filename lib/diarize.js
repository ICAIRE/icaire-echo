// Telling voices apart in recordings that have no speaker log (Record, without the bot): sherpa-onnx's
// diarization, all on this computer. pyannote's segmentation-3.0 finds who is talking when (including two at once);
// a speaker-embedding model turns each stretch into a voiceprint; clustering groups the voiceprints into
// Speaker 1, Speaker 2, ... The models were chosen on real meetings (test/bench-diarization.js, see TODO.md).
// The result is written as speakers.json, the same file the bot writes from Meet, so the transcript, the clip
// cutting (one language per speaker turn) and renaming all work the same way.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { Download } = require('./download');

const DIR = path.join(__dirname, '..', 'models', 'speakers');
const MODELS = {
  segmentation: { name: 'pyannote-segmentation-3.0.onnx', bytes: 5992913, sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079', url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx' },
  // 3D-Speaker CAM++ (VoxCeleb): the lowest error of five voice models on four AMI meetings (21.2 % DER, against
  // 23 to 33 % for ERes2Net, TitaNet-small, WeSpeaker CAM++ and ResNet34), 30 MB
  embedding: { name: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx', bytes: 29596979, sha256: '98daf9bcf1c8abf3db374fec4c27a5eda7c58705bb3f180d057b085a72a88bb5', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx' },
};
// how different two voiceprints must be to count as two people. Meetings scored best at 1.15 (higher did not help);
// a short recording has few voiceprints, and at 1.15 two clearly different voices merged, while 0.9 kept them apart
const THRESHOLD = 1.15;
const SHORT_THRESHOLD = 0.9;
const SHORT_SECONDS = 180;
const WORKER = path.join(__dirname, 'diarize-worker.js');

const have = (m) => { try { return fs.statSync(path.join(DIR, m.name)).size === m.bytes; } catch { return false; } };
const ready = () => Object.values(MODELS).every(have);
const engineReady = () => { try { require.resolve('sherpa-onnx-node'); return true; } catch { return false; } };

// the models, downloaded once (about 32 MB)
async function ensureModels(onUpdate) {
  if (ready()) return;
  const d = new Download('speaker models');
  if (onUpdate) d.on('update', onUpdate);
  const status = await d.run(Object.values(MODELS), DIR);
  if (status !== 'done') throw new Error(d.error || 'The speaker models did not download.');
}

// [{ start, end, speaker: 'Speaker 1' }] for 16 kHz mono samples; numSpeakers when it is known
function diarize(samples, { numSpeakers = -1, threshold = samples.length < SHORT_SECONDS * 16000 ? SHORT_THRESHOLD : THRESHOLD } = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, {
      workerData: { samples, segmentation: path.join(DIR, MODELS.segmentation.name), embedding: path.join(DIR, MODELS.embedding.name), numSpeakers, threshold },
    });
    w.once('message', (m) => (m.error ? reject(new Error(m.error)) : resolve(m.segments)));
    w.once('error', reject);
    w.once('exit', (code) => code && reject(new Error(`speaker separation stopped (code ${code})`)));
  });
}

// Speaker numbers in order of first appearance, so the first voice heard is Speaker 1
function label(raw) {
  const order = new Map();
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  for (const s of sorted) if (!order.has(s.speaker)) order.set(s.speaker, order.size + 1);
  return sorted.map((s) => ({ speaker: `Speaker ${order.get(s.speaker)}`, pid: `voice-${order.get(s.speaker)}`, start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100 }));
}

// Writes speakers.json for a recording folder from its audio.wav. Returns the segments.
async function writeSpeakers(dir, samples, opts = {}) {
  const segments = label(await diarize(samples, opts));
  const file = path.join(dir, 'speakers.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify({ source: 'voices', segments }, null, 2));
  fs.renameSync(file + '.tmp', file);
  return segments;
}

// Give a speaker a name everywhere in a recording: the timeline, and (by re-labelling) the transcript
function rename(dir, from, to) {
  const file = path.join(dir, 'speakers.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  // a colon or a line break would break the transcript's "Name: text" lines
  const name = String(to).replace(/[:\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) throw new Error('Type a name.');
  let n = 0;
  for (const s of j.segments) if (s.speaker === from) { s.speaker = name; n++; }
  if (!n) throw new Error(`No speaker called ${from} in this recording.`);
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return n;
}

module.exports = { diarize, writeSpeakers, rename, ensureModels, ready, engineReady, label, MODELS, DIR, THRESHOLD };
