import { describe, expect, it } from 'vitest';
import { Biquad } from './biquad.ts';
import { amplitudeToDb, meanPower } from './db.ts';

const fs = 48_000;

/** Steady-state gain (dB) of a filter for a sine at `freq`. */
function gainDb(make: () => Biquad, freq: number): number {
  const n = fs; // 1 s
  const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * freq * i) / fs));
  const y = make().process(x);
  const settle = n / 2; // skip the start-up transient
  return amplitudeToDb(Math.sqrt(meanPower(y, settle) / meanPower(x, settle)));
}

describe('Biquad', () => {
  it('lowpass: −3 dB at the cutoff, flat below, attenuates above', () => {
    const lp = () => new Biquad('lowpass', 4000, fs);
    expect(gainDb(lp, 4000)).toBeCloseTo(-3, 0);
    expect(Math.abs(gainDb(lp, 500))).toBeLessThan(0.1);
    expect(gainDb(lp, 16_000)).toBeLessThan(-20);
  });

  it('highpass: −3 dB at the cutoff, flat above, attenuates below', () => {
    const hp = () => new Biquad('highpass', 1400, fs);
    expect(gainDb(hp, 1400)).toBeCloseTo(-3, 0);
    expect(Math.abs(gainDb(hp, 8000))).toBeLessThan(0.2);
    expect(gainDb(hp, 100)).toBeLessThan(-35);
  });

  it('gives the same output when processing in chunks', () => {
    const x = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i * 0.3) + Math.cos(i * 0.01));
    const whole = new Biquad('highpass', 1000, fs).process(x);
    const chunked = new Biquad('highpass', 1000, fs);
    const parts = [x.subarray(0, 7), x.subarray(7, 2000), x.subarray(2000)].map((p) =>
      chunked.process(p),
    );
    const joined = new Float32Array(x.length);
    let offset = 0;
    for (const p of parts) {
      joined.set(p, offset);
      offset += p.length;
    }
    expect(joined).toEqual(whole);
  });

  it('rejects cutoffs outside (0, fs/2)', () => {
    expect(() => new Biquad('lowpass', 30_000, fs)).toThrow(RangeError);
  });
});
