import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 100 }, () => a.nextUint32() === b.nextUint32());
    expect(same.filter(Boolean).length).toBeLessThan(3);
  });

  it('generates uniform floats in [0, 1) with mean ≈ 0.5', () => {
    const rng = createRng(7);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it('generates integers within the inclusive range', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(-2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('generates standard normal samples (mean 0, variance 1)', () => {
    const rng = createRng(123);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.gaussian();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(0, 2);
    expect(sumSq / n - mean * mean).toBeCloseTo(1, 1);
  });
});
