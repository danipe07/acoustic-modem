/**
 * Goertzel algorithm: how much of one particular frequency is present in a block
 * of samples?
 *
 * It computes a single bin of the discrete Fourier transform with a two-tap
 * recursive filter, costing O(N) — much cheaper than a full FFT when only a
 * couple of frequencies matter (as in FSK).
 *
 * The result is normalised as a squared amplitude: a sine wave of amplitude A
 * at exactly `freq`, spanning a whole number of cycles in the block, yields A².
 */
export function goertzelPower(
  x: ArrayLike<number>,
  freq: number,
  sampleRate: number,
  start = 0,
  length = x.length - start,
): number {
  if (length <= 0) return 0;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  const end = start + length;
  for (let i = start; i < end; i++) {
    const s = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2; // |X(f)|²
  return (4 * power) / (length * length);
}
