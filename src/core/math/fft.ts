/**
 * Iterative radix-2 Cooley–Tukey FFT, in place.
 *
 * The FFT converts a block of N time samples into N frequency bins in
 * O(N log N) operations. It is used for spectra/spectrograms, fast convolution
 * (room reverberation in the channel simulator) and, in phase 5, OFDM.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (im.length !== n) throw new RangeError('re and im must have the same length');
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new RangeError(`FFT size must be a power of two, got ${n}`);

  // Reorder the input in bit-reversed index order.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  // Butterflies: merge pairs of half-size DFTs into DFTs of size `len`.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(angle * k);
      const wi = Math.sin(angle * k);
      for (let i = k; i < n; i += len) {
        const j = i + half;
        const xr = re[j];
        const xi = im[j];
        const br = xr * wr - xi * wi;
        const bi = xr * wi + xi * wr;
        const ar = re[i];
        const ai = im[i];
        re[i] = ar + br;
        im[i] = ai + bi;
        re[j] = ar - br;
        im[j] = ai - bi;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i] / n;
      im[i] = im[i] / n;
    }
  }
}

/** Smallest power of two ≥ n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Linear convolution y = a * b (length a.length + b.length − 1).
 * Uses the FFT for long inputs: convolution in time is multiplication in frequency.
 */
export function convolve(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  if (a.length === 0 || b.length === 0) return new Float64Array(0);
  const outLength = a.length + b.length - 1;

  if (Math.min(a.length, b.length) <= 32) {
    const out = new Float64Array(outLength);
    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      if (ai === 0) continue;
      for (let j = 0; j < b.length; j++) out[i + j] = out[i + j] + ai * b[j];
    }
    return out;
  }

  const n = nextPow2(outLength);
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  for (let i = 0; i < a.length; i++) ar[i] = a[i];
  for (let i = 0; i < b.length; i++) br[i] = b[i];
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const m = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = m;
  }
  fft(ar, ai, true);
  return ar.slice(0, outLength);
}
