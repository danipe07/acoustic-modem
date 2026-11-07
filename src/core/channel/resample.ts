/**
 * Band-limited resampling with a windowed-sinc interpolator.
 *
 * Used to model two real-world effects:
 *  - Devices running at different nominal sample rates (48 kHz → 44.1 kHz).
 *  - Clock mismatch: two "48 kHz" devices never tick at exactly the same
 *    speed; a ±0.1 % error stretches or compresses the received signal.
 *
 * Each output sample y[m] is the input evaluated at the fractional position
 * t = m / ratio, reconstructed from the neighbouring input samples weighted by
 * a sinc (the ideal interpolation kernel) tapered with a Blackman window.
 * When downsampling, the kernel is widened to act as an anti-aliasing filter.
 */
const HALF_TAPS = 16;
const TABLE_RESOLUTION = 512; // kernel values per input-sample spacing

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Resamples `input` so that the output has `ratio` times as many samples per second. */
export function resample(input: Float32Array, ratio: number): Float32Array {
  if (!(ratio > 0)) throw new RangeError('ratio must be positive');
  if (ratio === 1) return input.slice();
  if (input.length === 0) return new Float32Array(0);

  const cutoff = Math.min(1, ratio); // relative to the input Nyquist frequency
  const halfWidth = Math.ceil(HALF_TAPS / cutoff); // in input samples

  // Pre-computed kernel h(τ) for τ ∈ [0, halfWidth], linearly interpolated at run time.
  const table = new Float64Array(halfWidth * TABLE_RESOLUTION + 2);
  for (let k = 0; k < table.length; k++) {
    const tau = k / TABLE_RESOLUTION;
    const u = Math.min(1, tau / halfWidth);
    const blackman = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
    table[k] = cutoff * sinc(cutoff * tau) * blackman;
  }

  const outLength = Math.floor((input.length - 1) * ratio) + 1;
  const out = new Float32Array(outLength);
  for (let m = 0; m < outLength; m++) {
    const t = m / ratio;
    const center = Math.floor(t);
    const first = Math.max(0, center - halfWidth + 1);
    const last = Math.min(input.length - 1, center + halfWidth);
    let acc = 0;
    for (let i = first; i <= last; i++) {
      const pos = Math.abs(t - i) * TABLE_RESOLUTION;
      const k = Math.floor(pos);
      const frac = pos - k;
      const h = table[k] + frac * (table[k + 1] - table[k]);
      acc += input[i] * h;
    }
    out[m] = acc;
  }
  return out;
}
