// Scores a live recording against the guests' own microphone logs.
//   node test/live-compare.js recordings/<id> [test/out/live]
const fs = require('fs');
const path = require('path');

const recDir = path.resolve(process.argv[2]);
const truthDir = path.resolve(process.argv[3] || path.join(__dirname, 'out', 'live'));
const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8'));
const { segments } = JSON.parse(fs.readFileSync(path.join(recDir, 'speakers.json'), 'utf8'));
const t0 = Date.parse(meta.startedAt);
const dur = meta.durationSec || (meta.durationMs || 0) / 1000;

const truth = {};
for (const f of fs.readdirSync(truthDir).filter((f) => f.endsWith('.truth.ndjson'))) {
  let open = null;
  for (const line of fs.readFileSync(path.join(truthDir, f), 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(line);
    const s = (e.t - t0) / 1000;
    truth[e.name] = truth[e.name] || [];
    if (e.ev === 'on') open = s;
    else if (open !== null) truth[e.name].push([open, s]), (open = null);
  }
  if (open !== null) truth[Object.keys(truth).pop()].push([open, dur]);
}

const STEP = 0.1;
const frames = Math.ceil(dur / STEP);
const mask = (ivs, shift = 0) => {
  const m = new Uint8Array(frames);
  for (const [a, b] of ivs) for (let i = Math.max(0, Math.floor((a + shift) / STEP)); i < Math.min(frames, Math.ceil((b + shift) / STEP)); i++) m[i] = 1;
  return m;
};

console.log(`recording ${dur.toFixed(1)} s, started ${meta.startedAt}`);
console.log('detected speakers:', [...new Set(segments.map((s) => s.speaker))].join(', ') || '(none)');
for (const [name, ivs] of Object.entries(truth)) {
  const inRec = ivs.filter(([a, b]) => b > 0 && a < dur);
  const det = segments.filter((s) => s.speaker === name).map((s) => [s.start, s.end]);
  const tm = mask(inRec);
  // Meet's indicator trails the audio a little; find the lag that fits best (0..1.5 s).
  let best = { lag: 0, acc: -1 };
  for (let lag = 0; lag <= 1.5; lag += 0.1) {
    const dm = mask(det, -lag);
    let agree = 0;
    for (let i = 0; i < frames; i++) agree += tm[i] === dm[i];
    if (agree / frames > best.acc) best = { lag, acc: agree / frames };
  }
  const dm = mask(det, -best.lag);
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < frames; i++) {
    if (tm[i] && dm[i]) tp++;
    else if (dm[i]) fp++;
    else if (tm[i]) fn++;
  }
  const hits = inRec.filter(([a, b]) => det.some(([c, d]) => c - best.lag < b && d - best.lag > a)).length;
  console.log(
    `${name.padEnd(12)} talked ${inRec.length} times; caught ${hits}/${inRec.length} | ` +
      `time agreement ${(best.acc * 100).toFixed(1)}% | recall ${((tp / (tp + fn || 1)) * 100).toFixed(0)}% ` +
      `precision ${((tp / (tp + fp || 1)) * 100).toFixed(0)}% | indicator lag ~${best.lag.toFixed(1)} s`
  );
}
