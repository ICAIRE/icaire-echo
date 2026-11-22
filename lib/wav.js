// Reading and writing WAV files: 16-bit PCM and 32-bit float, mono or more channels (read as mono).
// The 16-bit conversion matches libsndfile (what the Python version used): floor(x * 32768), clipped, and
// read back as n / 32768, so sound cached by either version is the same sample for sample.
const fs = require('fs');

function read(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
  let fmt = null;
  let data = null;
  for (let p = 12; p + 8 <= b.length; ) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      let format = b.readUInt16LE(body);
      if (format === 0xfffe && size >= 26) format = b.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE: the real format is in the GUID
      fmt = { format, channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(b.length, body + size));
      break;
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error(`${file} has no audio in it`);
  const { format, channels, rate, bits } = fmt;
  const frames = Math.floor(data.length / ((bits / 8) * channels));
  const out = new Float32Array(frames);
  const get =
    format === 1 && bits === 16 ? (i) => data.readInt16LE(i * 2) / 32768
      : format === 3 && bits === 32 ? (i) => data.readFloatLE(i * 4)
        : format === 1 && bits === 32 ? (i) => data.readInt32LE(i * 4) / 2147483648
          : null;
  if (!get) throw new Error(`${file}: ${bits}-bit audio of format ${format} is not supported`);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += get(f * channels + c);
    out[f] = s / channels;
  }
  return { rate, channels, bits, format, samples: out };
}

function header(frames, rate, bits, format) {
  const bytes = frames * (bits / 8);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(format, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * (bits / 8), 28);
  h.writeUInt16LE(bits / 8, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(bytes, 40);
  return h;
}

// float samples -> the int16 values libsndfile would store
function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.floor(samples[i] * 32768);
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return out;
}

// what a float signal sounds like after a trip through a 16-bit file
function quantize16(samples) {
  const q = toInt16(samples);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / 32768;
  return out;
}

function write16(file, samples, rate) {
  const q = toInt16(samples);
  fs.writeFileSync(file, Buffer.concat([header(q.length, rate, 16, 1), Buffer.from(q.buffer, q.byteOffset, q.byteLength)]));
}

function writeFloat(file, samples, rate) {
  const f = Float32Array.from(samples);
  fs.writeFileSync(file, Buffer.concat([header(f.length, rate, 32, 3), Buffer.from(f.buffer, f.byteOffset, f.byteLength)]));
}

module.exports = { read, write16, writeFloat, toInt16, quantize16 };
