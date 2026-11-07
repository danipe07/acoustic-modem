/**
 * Second-order IIR filter ("biquad") with the classic RBJ Audio EQ Cookbook
 * coefficients. Used by the receiver to discard everything outside the band
 * where the modem transmits (room rumble, voices, hiss).
 *
 * The filter keeps its state between calls, so a signal can be processed in
 * chunks of any size with exactly the same result as in one go.
 */
export type BiquadType = 'lowpass' | 'highpass';

export class Biquad {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  private z1 = 0;
  private z2 = 0;

  constructor(type: BiquadType, cutoffHz: number, sampleRate: number, q = Math.SQRT1_2) {
    if (!(cutoffHz > 0 && cutoffHz < sampleRate / 2)) {
      throw new RangeError(`cutoff must be in (0, ${sampleRate / 2}) Hz, got ${cutoffHz}`);
    }
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const k = type === 'lowpass' ? 1 - cos : 1 + cos;
    const b1 = type === 'lowpass' ? k : -k;
    this.b0 = k / 2 / a0;
    this.b1 = b1 / a0;
    this.b2 = k / 2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  /** Filters `input` (transposed direct form II). */
  process(input: Float32Array, output = new Float32Array(input.length)): Float32Array {
    const { b0, b1, b2, a1, a2 } = this;
    let { z1, z2 } = this;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      output[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
    return output;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}
