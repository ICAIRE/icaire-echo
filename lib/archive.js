// Reading files out of .zip (and Python wheels, numpy .npz) and .tar.gz archives, in memory.
const zlib = require('zlib');

// { name: Buffer } for the entries of a zip whose names pass `want` (all when no filter)
function unzip(b, want = () => true) {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip file');
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + csize);
    if (method === 8) out[name] = zlib.inflateRawSync(data);
    else if (method === 0) out[name] = Buffer.from(data);
    else throw new Error(`${name}: unsupported compression`);
  }
  return out;
}

// { name: Buffer } for the files of a .tar.gz whose names pass `want`
function untargz(gz, want = () => true) {
  const b = zlib.gunzipSync(gz);
  const out = {};
  let longName = null;
  for (let p = 0; p + 512 <= b.length; ) {
    const h = b.subarray(p, p + 512);
    if (h.every((x) => x === 0)) break;
    const str = (a, n) => h.toString('utf8', a, a + n).replace(/\0.*$/s, '');
    let name = str(0, 100);
    const prefix = str(345, 155);
    if (prefix && h.toString('ascii', 257, 262) === 'ustar') name = prefix + '/' + name;
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const body = b.subarray(p + 512, p + 512 + size);
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
    else {
      if (longName) {
        name = longName;
        longName = null;
      }
      if ((type === '0' || type === '\0') && want(name)) out[name] = Buffer.from(body);
    }
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

module.exports = { unzip, untargz };
