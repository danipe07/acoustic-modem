import { describe, expect, it } from 'vitest';
import { goertzelPower } from './goertzel.ts';

function tone(freq: number, amplitude: number, sampleRate: number, length: number, phase = 0) {
  return Float32Array.from(
    { length },
    (_, n) => amplitude * Math.sin((2 * Math.PI * freq * n) / sampleRate + phase),
  );
}

describe('goertzelPower', () => {
  const fs = 48_000;
  const n = 960; // 20 ms: 2000 Hz and 3000 Hz both fit a whole number of cycles

  it('returns A² for a tone at the analysed frequency, whatever its phase', () => {
    for (const phase of [0, 0.7, Math.PI / 2, 2.5]) {
      expect(goertzelPower(tone(2000, 0.7, fs, n, phase), 2000, fs)).toBeCloseTo(0.49, 4);
    }
  });

  it('ignores an orthogonal tone (whole number of cycles apart)', () => {
    expect(goertzelPower(tone(3000, 0.7, fs, n), 2000, fs)).toBeLessThan(1e-8);
  });

  it('separates two simultaneous tones', () => {
    const a = tone(2000, 0.5, fs, n);
    const b = tone(3000, 0.2, fs, n);
    const mix = a.map((v, i) => v + (b[i] ?? 0));
    expect(goertzelPower(mix, 2000, fs)).toBeCloseTo(0.25, 4);
    expect(goertzelPower(mix, 3000, fs)).toBeCloseTo(0.04, 4);
  });

  it('analyses a sub-block selected by start and length', () => {
    const x = new Float32Array(3 * n);
    x.set(tone(3000, 0.4, fs, n), n);
    expect(goertzelPower(x, 3000, fs, n, n)).toBeCloseTo(0.16, 4);
    expect(goertzelPower(x, 3000, fs, 0, n)).toBe(0);
  });
});
