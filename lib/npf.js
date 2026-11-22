// The few numpy operations the voice-over effects use, done the way numpy does them so the numbers agree:
// float32 sums are pairwise in float32 (numpy's pairwise_sum), percentile/median interpolate linearly, and
// rfft/irfft match numpy.fft for any length (radix-2, Bluestein for other lengths).
const f32 = Math.fround;

// numpy's pairwise_sum for float32 (blocks of 128, eight accumulators), all in float32
function pairwise32(a, lo, n) {
  if (n < 8) {
    let r = -0;
    for (let i = 0; i < n; i++) r = f32(r + a[lo + i]);
    return r;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] = f32(r[j] + a[lo + i + j]);
    let res = f32(f32(f32(r[0] + r[1]) + f32(r[2] + r[3])) + f32(f32(r[4] + r[5]) + f32(r[6] + r[7])));
    for (; i < n; i++) res = f32(res + a[lo + i]);
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return f32(pairwise32(a, lo, n2) + pairwise32(a, lo + n2, n - n2));
}

// the same for float64
function pairwise64(a, lo, n) {
  if (n < 8) {
    let r = -0;
    for (let i = 0; i < n; i++) r += a[lo + i];
    return r;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwise64(a, lo, n2) + pairwise64(a, lo + n2, n - n2);
}

const sum32 = (a, lo = 0, n = a.length - lo) => pairwise32(a, lo, n);
const mean32 = (a, lo = 0, n = a.length - lo) => f32(pairwise32(a, lo, n) / n);
const sum64 = (a, lo = 0, n = a.length - lo) => pairwise64(a, lo, n);
const mean64 = (a, lo = 0, n = a.length - lo) => pairwise64(a, lo, n) / n;

// sqrt(mean(x**2)) of each frame of `size` samples, in float32: np.sqrt((a[:n*size].reshape(n, size) ** 2).mean(1))
function frameRms32(a, size) {
  const n = Math.floor(a.length / size);
  const out = new Float32Array(n);
  const sq = new Float32Array(size);
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < size; k++) {
      const v = a[f * size + k];
      sq[k] = f32(v * v);
    }
    out[f] = f32(Math.sqrt(mean32(sq)));
  }
  return out;
}

// np.percentile(a, q) (method "linear") and np.median, for float32 data
function percentile32(a, q) {
  const s = Float32Array.from(a).sort();
  const n = s.length;
  const v = (q / 100) * (n - 1);
  const lo = Math.floor(v);
  const hi = Math.min(n - 1, lo + 1);
  const g = f32(v - lo);
  const diff = f32(s[hi] - s[lo]);
  // numpy's _lerp: a + (b - a) * t, or b - (b - a) * (1 - t) when t >= 0.5
  return g >= 0.5 ? f32(s[hi] - f32(diff * f32(1 - g))) : f32(s[lo] + f32(diff * g));
}
function median32(a) {
  const s = Float32Array.from(a).sort();
  const n = s.length;
  if (!n) return NaN;
  if (n % 2) return s[(n - 1) / 2];
  return f32(f32(s[n / 2 - 1] + s[n / 2]) / 2); // np.mean of the two middle values
}

// np.linspace(start, stop, num)
function linspace(start, stop, num) {
  const out = new Float64Array(num);
  const div = num - 1;
  const step = (stop - start) / div;
  for (let i = 0; i < num; i++) out[i] = i * step + start;
  if (num > 1) out[num - 1] = stop;
  return out;
}

// ---------- FFT ----------
const twiddles = new Map();
function fftPow2(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  let tw = twiddles.get(n);
  if (!tw) {
    tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) {
      tw.c[k] = Math.cos((2 * Math.PI * k) / n);
      tw.s[k] = Math.sin((2 * Math.PI * k) / n);
    }
    twiddles.set(n, tw);
  }
  const sg = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = tw.c[k * step];
        const wi = sg * tw.s[k * step];
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

// complex DFT of any length (Bluestein's chirp z-transform when it is not a power of two)
function dft(re, im, inverse = false) {
  const n = re.length;
  if (n <= 1) return [Float64Array.from(re), Float64Array.from(im)];
  if ((n & (n - 1)) === 0) {
    const r = Float64Array.from(re);
    const i = Float64Array.from(im);
    fftPow2(r, i, inverse);
    return [r, i];
  }
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const sg = inverse ? 1 : -1;
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = (Math.PI * ((k * k) % (2 * n))) / n;
    cr[k] = Math.cos(a);
    ci[k] = sg * Math.sin(a);
  }
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    ar[k] = re[k] * cr[k] - im[k] * ci[k];
    ai[k] = re[k] * ci[k] + im[k] * cr[k];
  }
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = cr[0];
  bi[0] = -ci[0];
  for (let k = 1; k < n; k++) {
    br[k] = br[m - k] = cr[k];
    bi[k] = bi[m - k] = -ci[k];
  }
  fftPow2(ar, ai, false);
  fftPow2(br, bi, false);
  for (let k = 0; k < m; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k];
    const i = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = r;
    ai[k] = i;
  }
  fftPow2(ar, ai, true);
  const or = new Float64Array(n);
  const oi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const r = ar[k] / m;
    const i = ai[k] / m;
    or[k] = r * cr[k] - i * ci[k];
    oi[k] = r * ci[k] + i * cr[k];
  }
  return [or, oi];
}

// np.fft.rfft(a, n): [re, im] of n // 2 + 1 bins (a is cut or zero-padded to n)
function rfft(a, n = a.length) {
  const re = new Float64Array(n);
  for (let i = 0; i < Math.min(n, a.length); i++) re[i] = a[i];
  const [r, i] = dft(re, new Float64Array(n));
  const h = Math.floor(n / 2) + 1;
  return [r.slice(0, h), i.slice(0, h)];
}

// np.fft.irfft(spec, n)
function irfft(re, im, n) {
  const h = Math.floor(n / 2) + 1;
  const fr = new Float64Array(n);
  const fi = new Float64Array(n);
  for (let k = 0; k < h && k < re.length; k++) {
    fr[k] = re[k];
    fi[k] = im[k];
  }
  fi[0] = 0;
  if (n % 2 === 0 && h - 1 < re.length) fi[h - 1] = 0;
  for (let k = 1; k < n - k; k++) {
    fr[n - k] = fr[k];
    fi[n - k] = -fi[k];
  }
  const [r] = dft(fr, fi, true);
  for (let i = 0; i < n; i++) r[i] /= n;
  return r;
}

// np.fft.rfftfreq(n, d)
function rfftfreq(n, d) {
  const h = Math.floor(n / 2) + 1;
  const out = new Float64Array(h);
  const val = 1.0 / (n * d);
  for (let i = 0; i < h; i++) out[i] = i * val;
  return out;
}

module.exports = { sum32, mean32, sum64, mean64, frameRms32, percentile32, median32, linspace, rfft, irfft, rfftfreq, dft };
