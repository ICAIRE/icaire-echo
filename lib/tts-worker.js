// Runs one voice-over (lib/tts.js) off the server's main thread, so the panel stays responsive while the
// effects and the music are worked out. Messages to the parent: start, progress, done, error, cancelled.
// Cancelling is a message, not worker.terminate(): stopping the thread while onnxruntime is running the model
// aborts the whole process, so the worker stops itself after the line it is on.
// Expressive (lib/chatterbox.js) needs half floats kept as raw 16-bit words: remove Float16Array before onnxruntime
// loads in this thread (Kokoro works in full floats and does not mind)
delete globalThis.Float16Array;
const { parentPort, workerData } = require('worker_threads');
const tts = require('./tts');

let cancelled = false;
parentPort.on('message', (m) => {
  if (m && m.type === 'cancel') cancelled = true;
});

(async () => {
  try {
    const r = await tts.make(workerData, (m) => parentPort.postMessage(m), () => cancelled);
    parentPort.postMessage(r && !cancelled ? { type: 'done', ...r } : { type: 'cancelled' });
  } catch (e) {
    const m = /^needs-extra:(\w+)/.exec(e.message);
    parentPort.postMessage({ type: 'error', error: e.message, needsExtra: m ? m[1] : undefined });
  }
  await tts.release();
  parentPort.close();
})();
