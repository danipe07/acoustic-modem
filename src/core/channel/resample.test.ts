import { describe, expect, it } from 'vitest';
import { goertzelPower } from '../math/goertzel.ts';
import { resample } from './resample.ts';

function tone(freq: number, amplitude: number, sampleRate: number, seconds: number) {
  const n = Math.round(seconds * sampleRate);
  return Float32Array.from(
    { length: n },
    (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate),
  );
}

describe('resample', () => {
  it('returns a copy for ratio 1', () => {
    const x = Float32Array.from([1, 2, 3]);
    const y = resample(x, 1);
    expect(y).toEqual(x);
    expect(y).not.toBe(x);
  });

  it('scales the length by the ratio', () => {
    expect(resample(new Float32Array(48_001), 44_100 / 48_000).length).toBe(44_101);
    expect(resample(new Float32Array(44_101), 48_000 / 44_100).length).toBe(48_001);
  });

  it('preserves a tone when converting 48 kHz → 44.1 kHz and back up', () => {
    const y = resample(tone(2000, 0.5, 48_000, 2), 44_100 / 48_000);
    // Analyse exactly one second away from the edges.
    expect(goertzelPower(y, 2000, 44_100, 22_050, 44_100)).toBeCloseTo(0.25, 3);
    const z = resample(tone(3000, 0.5, 44_100, 2), 48_000 / 44_100);
    expect(goertzelPower(z, 3000, 48_000, 24_000, 48_000)).toBeCloseTo(0.25, 3);
  });

  it('shifts frequency like a clock that runs 0.1 % fast', () => {
    // A transmitter clock 1000 ppm fast plays 2000 Hz as 2002 Hz.
    const y = resample(tone(2000, 0.5, 48_000, 3), 1 / 1.001);
    expect(goertzelPower(y, 2002, 48_000, 48_000, 48_000)).toBeCloseTo(0.25, 2);
    expect(goertzelPower(y, 2000, 48_000, 48_000, 48_000)).toBeLessThan(0.01);
  });

  it('keeps a constant (DC) signal constant', () => {
    const y = resample(new Float32Array(2000).fill(0.3), 0.9);
    for (let i = 100; i < y.length - 100; i++) expect(y[i]).toBeCloseTo(0.3, 3);
  });
});
