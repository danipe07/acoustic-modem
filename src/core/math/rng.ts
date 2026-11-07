/**
 * Seeded pseudo-random number generator (xoshiro128**).
 *
 * Every simulation in this project draws its randomness from here, so that a
 * given seed always produces the same noise and therefore the same bit errors:
 * tests are reproducible and a failing case can be replayed exactly.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform unsigned 32-bit integer. */
  nextUint32(): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Standard normal sample (mean 0, variance 1), generated with Box–Muller. */
  gaussian(): number;
}

/** SplitMix32: expands a single 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

export function createRng(seed: number): Rng {
  const init = splitmix32(seed);
  let s0 = init();
  let s1 = init();
  let s2 = init();
  let s3 = init();
  let spareGaussian: number | null = null;

  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };

  const next = (): number => nextUint32() / 4294967296;

  return {
    next,
    nextUint32,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    gaussian: () => {
      if (spareGaussian !== null) {
        const value = spareGaussian;
        spareGaussian = null;
        return value;
      }
      // Box–Muller turns two uniform numbers into two independent normal ones.
      const u1 = 1 - next(); // in (0, 1], so log(u1) is finite
      const u2 = next();
      const radius = Math.sqrt(-2 * Math.log(u1));
      spareGaussian = radius * Math.sin(2 * Math.PI * u2);
      return radius * Math.cos(2 * Math.PI * u2);
    },
  };
}
