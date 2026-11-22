// Runs speaker separation (lib/diarize.js) off the server's main thread: sherpa-onnx works through the whole
// recording in one call, which takes seconds to minutes.
const { parentPort, workerData } = require('worker_threads');

try {
  const sherpa = require('sherpa-onnx-node');
  const { samples, segmentation, embedding, numSpeakers, threshold } = workerData;
  const d = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentation }, numThreads: 4 },
    embedding: { model: embedding, numThreads: 4 },
    clustering: { numClusters: numSpeakers, threshold },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });
  const segments = d.process(samples).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }));
  parentPort.postMessage({ segments });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
