// Runs speaker separation (lib/diarize.js) off the server's main thread: sherpa-onnx works through the whole
// recording in one call, which takes seconds to minutes.
const { parentPort, workerData } = require('worker_threads');

try {
  const sherpa = require('sherpa-onnx-node');
  const { samples, segmentation, embedding, numSpeakers, threshold } = workerData;
  // 8 threads ran a 14 min meeting in 51 s against 61 s with 4 (same speakers); fewer on smaller computers
  const threads = Math.max(2, Math.min(8, require('os').cpus().length - 2));
  const d = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentation }, numThreads: threads },
    embedding: { model: embedding, numThreads: threads },
    clustering: { numClusters: numSpeakers, threshold },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });
  const segments = d.process(samples).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }));
  parentPort.postMessage({ segments });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
