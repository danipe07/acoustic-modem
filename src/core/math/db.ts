/**
 * Decibel helpers. Decibels express power ratios on a logarithmic scale:
 * +10 dB is ×10 in power, +3 dB is roughly ×2, and amplitude ratios use 20·log10.
 */
export const powerToDb = (power: number): number => 10 * Math.log10(power);
export const dbToPower = (db: number): number => 10 ** (db / 10);
export const amplitudeToDb = (amplitude: number): number => 20 * Math.log10(amplitude);
export const dbToAmplitude = (db: number): number => 10 ** (db / 20);

/** Mean of x² over [start, end): the average power of a block of samples. */
export function meanPower(x: ArrayLike<number>, start = 0, end = x.length): number {
  if (end <= start) return 0;
  let acc = 0;
  for (let i = start; i < end; i++) {
    const v = x[i];
    acc += v * v;
  }
  return acc / (end - start);
}
