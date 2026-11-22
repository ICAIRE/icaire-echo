// Finding the speech in a recording (voice activity detection) with the Silero VAD model, exactly as
// faster-whisper does it (faster_whisper/vad.py, MIT): the same model file (whisper/silero_vad_v6.onnx, from
// faster-whisper's assets), the same 512-sample windows with 64 samples of context, and the same rules for
// joining, splitting and padding speech.
const path = require('path');

const MODEL = path.join(__dirname, '..', 'whisper', 'silero_vad_v6.onnx');
const WINDOW = 512;
const CONTEXT = 64;
const BATCH = 10000;

let session = null;
async function model() {
  if (!session) {
    const ort = require('onnxruntime-node');
    session = await ort.InferenceSession.create(MODEL, { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false, logSeverityLevel: 4 });
  }
  return session;
}

// One speech probability per 512-sample window of 16 kHz audio.
async function probabilities(audio) {
  const ort = require('onnxruntime-node');
  const s = await model();
  const padded = new Float32Array(audio.length + (WINDOW - (audio.length % WINDOW)));
  padded.set(audio);
  const n = padded.length / WINDOW;
  let h = new ort.Tensor('float32', new Float32Array(128), [1, 1, 128]);
  let c = new ort.Tensor('float32', new Float32Array(128), [1, 1, 128]);
  const probs = new Float32Array(n);
  for (let b = 0; b < n; b += BATCH) {
    const rows = Math.min(BATCH, n - b);
    const input = new Float32Array(rows * (CONTEXT + WINDOW));
    for (let r = 0; r < rows; r++) {
      const w = b + r;
      const at = r * (CONTEXT + WINDOW);
      // the context of a window is the end of the window before it; the first window gets silence
      if (w > 0) input.set(padded.subarray(w * WINDOW - CONTEXT, w * WINDOW), at);
      input.set(padded.subarray(w * WINDOW, (w + 1) * WINDOW), at + CONTEXT);
    }
    const out = await s.run({ input: new ort.Tensor('float32', input, [rows, CONTEXT + WINDOW]), h, c });
    probs.set(out.speech_probs.data, b);
    h = out.hn;
    c = out.cn;
  }
  return probs;
}

// [{ start, end }] in samples. Options and defaults as faster-whisper's VadOptions.
async function speechTimestamps(audio, opts = {}, sr = 16000) {
  const threshold = opts.threshold ?? 0.5;
  const negThreshold = opts.negThreshold ?? Math.max(threshold - 0.15, 0.01);
  const minSpeechMs = opts.minSpeechDurationMs ?? 0;
  const maxSpeechS = opts.maxSpeechDurationS ?? Infinity;
  const minSilenceMs = opts.minSilenceDurationMs ?? 2000;
  const padMs = opts.speechPadMs ?? 400;

  const minSpeech = (sr * minSpeechMs) / 1000;
  const pad = (sr * padMs) / 1000;
  const maxSpeech = sr * maxSpeechS - WINDOW - 2 * pad;
  const minSilence = (sr * minSilenceMs) / 1000;
  const minSilenceAtMax = (sr * 98) / 1000;
  const len = audio.length;

  const probs = await probabilities(audio);
  let triggered = false;
  const speeches = [];
  let cur = {};
  let tempEnd = 0;
  let prevEnd = 0;
  let nextStart = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    const at = WINDOW * i;
    if (p >= threshold && tempEnd) {
      tempEnd = 0;
      if (nextStart < prevEnd) nextStart = at;
    }
    if (p >= threshold && !triggered) {
      triggered = true;
      cur.start = at;
      continue;
    }
    if (triggered && at - cur.start > maxSpeech) {
      if (prevEnd) {
        cur.end = prevEnd;
        speeches.push(cur);
        cur = {};
        if (nextStart < prevEnd) triggered = false;
        else cur.start = nextStart;
        prevEnd = nextStart = tempEnd = 0;
      } else {
        cur.end = at;
        speeches.push(cur);
        cur = {};
        prevEnd = nextStart = tempEnd = 0;
        triggered = false;
        continue;
      }
    }
    if (p < negThreshold && triggered) {
      if (!tempEnd) tempEnd = at;
      if (at - tempEnd > minSilenceAtMax) prevEnd = tempEnd;
      if (at - tempEnd < minSilence) continue;
      cur.end = tempEnd;
      if (cur.end - cur.start > minSpeech) speeches.push(cur);
      cur = {};
      prevEnd = nextStart = tempEnd = 0;
      triggered = false;
      continue;
    }
  }
  if (cur.start !== undefined && len - cur.start > minSpeech) {
    cur.end = len;
    speeches.push(cur);
  }
  for (let i = 0; i < speeches.length; i++) {
    const s = speeches[i];
    if (i === 0) s.start = Math.trunc(Math.max(0, s.start - pad));
    if (i !== speeches.length - 1) {
      const silence = speeches[i + 1].start - s.end;
      if (silence < 2 * pad) {
        s.end += Math.trunc(Math.floor(silence / 2));
        speeches[i + 1].start = Math.trunc(Math.max(0, speeches[i + 1].start - Math.floor(silence / 2)));
      } else {
        s.end = Math.trunc(Math.min(len, s.end + pad));
        speeches[i + 1].start = Math.trunc(Math.max(0, speeches[i + 1].start - pad));
      }
    } else {
      s.end = Math.trunc(Math.min(len, s.end + pad));
    }
  }
  return speeches;
}

module.exports = { speechTimestamps, probabilities };
