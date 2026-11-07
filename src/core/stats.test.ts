import { describe, expect, it } from 'vitest';
import { compareBytes } from './stats.ts';

describe('compareBytes', () => {
  it('reports zero errors for identical data', () => {
    const s = compareBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]));
    expect(s).toEqual({ bitsSent: 24, bitErrors: 0, missingBytes: 0, extraBytes: 0, ber: 0 });
  });

  it('counts flipped bits', () => {
    const s = compareBytes(
      Uint8Array.from([0b0000_0000, 0xff]),
      Uint8Array.from([0b0001_0001, 0x7f]),
    );
    expect(s.bitErrors).toBe(3);
    expect(s.ber).toBeCloseTo(3 / 16);
  });

  it('counts missing bytes as 8 bit errors each and reports extra bytes', () => {
    expect(compareBytes(Uint8Array.from([1, 2]), Uint8Array.from([1])).ber).toBeCloseTo(0.5);
    expect(compareBytes(Uint8Array.from([1]), Uint8Array.from([1, 9])).extraBytes).toBe(1);
  });
});
