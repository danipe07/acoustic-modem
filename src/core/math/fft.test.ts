import { describe, expect, it } from 'vitest';
import { convolve, fft, nextPow2 } from './fft.ts';
import { createRng } from './rng.ts';

function naiveDft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      outRe[k] += re[t] * Math.cos(angle) - im[t] * Math.sin(angle);
      outIm[k] += re[t] * Math.sin(angle) + im[t] * Math.cos(angle);
    }
  }
  return { re: outRe, im: outIm };
}

function randomVector(n: number, seed: number) {
  const rng = createRng(seed);
  return Float64Array.from({ length: n }, () => rng.gaussian());
}

describe('fft', () => {
  it('matches a naive DFT', () => {
    for (const n of [1, 2, 8, 64, 256]) {
      const re = randomVector(n, n);
      const im = randomVector(n, n + 1);
      const expected = naiveDft(re, im);
      fft(re, im);
      for (let k = 0; k < n; k++) {
        expect(re[k]).toBeCloseTo(expected.re[k], 8);
        expect(im[k]).toBeCloseTo(expected.im[k], 8);
      }
    }
  });

  it('inverse transform recovers the input', () => {
    const re = randomVector(1024, 1);
    const im = randomVector(1024, 2);
    const re0 = re.slice();
    const im0 = im.slice();
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < re.length; i++) {
      expect(re[i]).toBeCloseTo(re0[i], 10);
      expect(im[i]).toBeCloseTo(im0[i], 10);
    }
  });

  it('puts a pure cosine in the expected bins', () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, t) => Math.cos((2 * Math.PI * 5 * t) / n));
    const im = new Float64Array(n);
    fft(re, im);
    expect(re[5]).toBeCloseTo(n / 2, 8);
    expect(re[n - 5]).toBeCloseTo(n / 2, 8);
    expect(Math.hypot(re[6], im[6])).toBeLessThan(1e-9);
  });

  it('rejects sizes that are not powers of two', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
  });
});

describe('nextPow2', () => {
  it('rounds up to a power of two', () => {
    expect([1, 2, 3, 5, 1024, 1025].map(nextPow2)).toEqual([1, 2, 4, 8, 1024, 2048]);
  });
});

describe('convolve', () => {
  function direct(a: Float64Array, b: Float64Array) {
    const out = new Float64Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
    return out;
  }

  it('matches direct convolution for short and long inputs', () => {
    for (const [la, lb] of [
      [5, 3],
      [100, 40],
      [1000, 333],
    ] as const) {
      const a = randomVector(la, la);
      const b = randomVector(lb, lb + 7);
      const expected = direct(a, b);
      const got = convolve(a, b);
      expect(got.length).toBe(expected.length);
      for (let i = 0; i < got.length; i++) expect(got[i]).toBeCloseTo(expected[i], 8);
    }
  });

  it('returns an empty result for empty input', () => {
    expect(convolve([], [1, 2]).length).toBe(0);
  });
});
