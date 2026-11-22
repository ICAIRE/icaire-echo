// numpy.random.default_rng(seed), in JavaScript: the same numbers for the same seed, so the voice-over's breaths,
// room and music come out exactly as the Python version (and the Ideas City project) made them.
// SeedSequence (numpy/random/bit_generator.pyx) -> PCG64 (pcg64.h, XSL-RR 128/64) -> random(), integers(),
// standard_normal() (the ziggurat method, distributions.c, with numpy's own tables in voice/ziggurat.json).
const Z = require('../voice/ziggurat.json');

const M32 = 0xffffffff;
const mul32 = (a, b) => Math.imul(a, b) >>> 0;
const INIT_A = 0x43b0d7e5;
const MULT_A = 0x931e8875;
const INIT_B = 0x8b51f9dd;
const MULT_B = 0x58f38ded;
const MIX_MULT_L = 0xca01f9dd;
const MIX_MULT_R = 0x4973f715;
const XSHIFT = 16;

function seedWords(seed) {
  let n = BigInt(seed);
  if (n < 0n) throw new Error('seed must be non-negative');
  if (n === 0n) return [0];
  const words = [];
  while (n > 0n) {
    words.push(Number(n & 0xffffffffn));
    n >>= 32n;
  }
  return words;
}

// SeedSequence(seed).generate_state(4, uint64)
function seedState(seed) {
  const entropy = seedWords(seed);
  let hc = INIT_A;
  const hashmix = (v) => {
    v = (v ^ hc) >>> 0;
    hc = mul32(hc, MULT_A);
    v = mul32(v, hc);
    return (v ^ (v >>> XSHIFT)) >>> 0;
  };
  const mix = (x, y) => {
    const r = (mul32(MIX_MULT_L, x) - mul32(MIX_MULT_R, y)) >>> 0;
    return (r ^ (r >>> XSHIFT)) >>> 0;
  };
  const pool = new Array(4);
  for (let i = 0; i < 4; i++) pool[i] = hashmix(i < entropy.length ? entropy[i] : 0);
  for (let s = 0; s < 4; s++) for (let d = 0; d < 4; d++) if (s !== d) pool[d] = mix(pool[d], hashmix(pool[s]));
  for (let s = 4; s < entropy.length; s++) for (let d = 0; d < 4; d++) pool[d] = mix(pool[d], hashmix(entropy[s]));
  let hb = INIT_B;
  const words = [];
  for (let i = 0; i < 8; i++) {
    let v = pool[i % 4];
    v = (v ^ hb) >>> 0;
    hb = mul32(hb, MULT_B);
    v = mul32(v, hb);
    words.push((v ^ (v >>> XSHIFT)) >>> 0);
  }
  const u64 = [];
  for (let i = 0; i < 8; i += 2) u64.push(BigInt(words[i]) | (BigInt(words[i + 1]) << 32n));
  return u64;
}

const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;
const MULT = (2549297995355413924n << 64n) | 4865540595714422341n;
const KI = Z.ki.map(BigInt);
const WI = Z.wi.map(Number);
const FI = Z.fi.map(Number);
const NOR_R = Number(Z.r);
const NOR_INV_R = Number(Z.inv_r);

class Generator {
  constructor(seed) {
    const [s0, s1, i0, i1] = seedState(seed);
    const initstate = (s0 << 64n) | s1;
    const initseq = (i0 << 64n) | i1;
    this.inc = ((initseq << 1n) | 1n) & MASK128;
    this.state = 0n;
    this.step();
    this.state = (this.state + initstate) & MASK128;
    this.step();
    this.hasU32 = false;
    this.u32 = 0;
  }
  step() {
    this.state = (this.state * MULT + this.inc) & MASK128;
  }
  nextU64() {
    this.step();
    const hi = this.state >> 64n;
    const x = (hi ^ (this.state & MASK64)) & MASK64;
    const rot = hi >> 58n;
    return ((x >> rot) | (x << ((64n - rot) & 63n))) & MASK64;
  }
  nextU32() {
    if (this.hasU32) {
      this.hasU32 = false;
      return this.u32;
    }
    const n = this.nextU64();
    this.hasU32 = true;
    this.u32 = Number(n >> 32n);
    return Number(n & 0xffffffffn);
  }
  // rng.random()
  random() {
    return Number(this.nextU64() >> 11n) * (1.0 / 9007199254740992.0);
  }
  // rng.integers(low, high) for a range that fits in 32 bits (Lemire's method, as numpy)
  integers(low, high) {
    const rng = high - 1 - low;
    if (rng === 0) return low;
    if (rng > M32 - 1) throw new Error('range too large');
    const excl = rng + 1;
    let m = BigInt(this.nextU32()) * BigInt(excl);
    let left = Number(m & 0xffffffffn);
    if (left < excl) {
      const threshold = (M32 - rng) % excl;
      while (left < threshold) {
        m = BigInt(this.nextU32()) * BigInt(excl);
        left = Number(m & 0xffffffffn);
      }
    }
    return low + Number(m >> 32n);
  }
  // one rng.standard_normal()
  normal() {
    for (;;) {
      let r = this.nextU64();
      const idx = Number(r & 0xffn);
      r >>= 8n;
      const sign = Number(r & 1n);
      const rabs = (r >> 1n) & 0x000fffffffffffffn;
      let x = Number(rabs) * WI[idx];
      if (sign) x = -x;
      if (rabs < KI[idx]) return x;
      if (idx === 0) {
        for (;;) {
          const xx = -NOR_INV_R * Math.log1p(-this.random());
          const yy = -Math.log1p(-this.random());
          if (yy + yy > xx * xx) return (rabs >> 8n) & 1n ? -(NOR_R + xx) : NOR_R + xx;
        }
      } else if ((FI[idx - 1] - FI[idx]) * this.random() + FI[idx] < Math.exp(-0.5 * x * x)) return x;
    }
  }
  // rng.standard_normal(n), as float64
  standardNormal(n) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.normal();
    return out;
  }
}

const defaultRng = (seed) => new Generator(seed);

module.exports = { defaultRng, Generator, seedState };
