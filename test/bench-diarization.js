// How well does each voice model tell speakers apart? Scores sherpa-onnx diarization (pyannote segmentation-3.0
// plus a speaker-embedding model) against meetings with known "who spoke when" labels (RTTM files), as DER:
// the share of speech time given to the wrong person, missed or invented. Scored the strict way: no collar,
// overlapping speech included. Lower is better.
//
//   node test/bench-diarization.js <folder with NAME.wav + NAME.rttm> <segmentation.onnx> <embedding.onnx>...
//
// Each model is run with the speaker count unknown, over a range of clustering thresholds; the threshold with the
// lowest average DER is reported, with the DER per meeting and the time taken.
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');
const wav = require('../lib/wav');

const STEP = 0.01; // 10 ms frames

function readRttm(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('SPEAKER')).map((l) => {
    const f = l.trim().split(/\s+/);
    return { start: +f[3], end: +f[3] + +f[4], speaker: f[7] };
  });
}

// optimal one-to-one assignment (Hungarian), maximising the overlap between reference and hypothesis speakers
function assign(score) {
  const n = Math.max(score.length, score[0] ? score[0].length : 0);
  const big = Math.max(1, ...score.flat());
  const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => big - ((score[i] && score[i][j]) || 0)));
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const match = {};
  for (let j = 1; j <= n; j++) if (p[j]) match[p[j] - 1] = j - 1;
  return match; // reference index -> hypothesis index
}

function der(ref, hyp, total) {
  const frames = Math.ceil(total / STEP);
  const rs = [...new Set(ref.map((s) => s.speaker))];
  const hs = [...new Set(hyp.map((s) => s.speaker))];
  const R = rs.map(() => new Uint8Array(frames));
  const H = hs.map(() => new Uint8Array(frames));
  const fill = (arr, list, names) => list.forEach((s) => { const k = names.indexOf(s.speaker); for (let f = Math.max(0, Math.round(s.start / STEP)); f < Math.min(frames, Math.round(s.end / STEP)); f++) arr[k][f] = 1; });
  fill(R, ref, rs);
  fill(H, hyp, hs);
  const score = rs.map((_, i) => hs.map((_, j) => { let c = 0; for (let f = 0; f < frames; f++) c += R[i][f] & H[j][f]; return c; }));
  const match = hs.length ? assign(score) : {};
  let err = 0, speech = 0, miss = 0, fa = 0, conf = 0;
  for (let f = 0; f < frames; f++) {
    let nr = 0, nh = 0, ok = 0;
    for (let i = 0; i < rs.length; i++) if (R[i][f]) { nr++; const j = match[i]; if (j !== undefined && j < hs.length && H[j][f]) ok++; }
    for (let j = 0; j < hs.length; j++) nh += H[j][f];
    speech += nr;
    err += Math.max(nr, nh) - ok;
    miss += Math.max(0, nr - nh);
    fa += Math.max(0, nh - nr);
    conf += Math.min(nr, nh) - ok;
  }
  return { der: err / speech, miss: miss / speech, fa: fa / speech, conf: conf / speech, refSpeakers: rs.length, hypSpeakers: hs.length };
}

const [dir, seg, ...embs] = process.argv.slice(2);
const meetings = fs.readdirSync(dir).filter((f) => f.endsWith('.rttm')).map((f) => f.replace(/\.rttm$/, '')).filter((m) => fs.existsSync(path.join(dir, m + '.wav')));
const audio = Object.fromEntries(meetings.map((m) => {
  const w = wav.read(path.join(dir, m + '.wav'));
  if (w.rate !== 16000) throw new Error(`${m}: expected 16 kHz`);
  // BENCH_SECONDS=600 scores only the first ten minutes of each meeting (quicker)
  const keep = Number(process.env.BENCH_SECONDS) || Infinity;
  return [m, w.samples.subarray(0, Math.min(w.samples.length, Math.round(keep * 16000)))];
}));
const THRESHOLDS = (process.env.BENCH_THRESHOLDS || '0.45,0.55,0.65,0.75,0.85').split(',').map(Number);
const rows = [];
for (const emb of embs) {
  const d = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: seg }, numThreads: 4 },
    embedding: { model: emb, numThreads: 4 },
    clustering: { numClusters: -1, threshold: 0.5 },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });
  const per = {};
  let secs = 0;
  for (const th of THRESHOLDS) {
    d.setConfig({ clustering: { numClusters: -1, threshold: th } });
    per[th] = {};
    for (const m of meetings) {
      const t0 = Date.now();
      const hyp = d.process(audio[m]).map((s) => ({ start: s.start, end: s.end, speaker: 's' + s.speaker }));
      if (th === THRESHOLDS[0]) secs += (Date.now() - t0) / 1000;
      per[th][m] = der(readRttm(path.join(dir, m + '.rttm')), hyp, audio[m].length / 16000);
    }
  }
  const avg = (th) => meetings.reduce((a, m) => a + per[th][m].der, 0) / meetings.length;
  const best = THRESHOLDS.reduce((b, th) => (avg(th) < avg(b) ? th : b));
  rows.push({
    model: path.basename(emb, '.onnx'),
    MB: Math.round(fs.statSync(emb).size / 1e6),
    threshold: best,
    'DER %': (avg(best) * 100).toFixed(1),
    ...Object.fromEntries(meetings.map((m) => [m, `${(per[best][m].der * 100).toFixed(1)} (${per[best][m].hypSpeakers}/${per[best][m].refSpeakers})`])),
    'speed x': (meetings.reduce((a, m) => a + audio[m].length / 16000, 0) / secs).toFixed(0),
  });
  console.error('done', path.basename(emb));
}
rows.sort((a, b) => a['DER %'] - b['DER %']);
console.table(rows);
console.log('Per meeting: DER % (speakers found / real speakers). speed x = audio seconds per second of work.');
