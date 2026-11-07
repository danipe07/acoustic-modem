import { describe, expect, it } from 'vitest';
import { alignBytes, compareBytes } from './stats.ts';

const bytes = (...v: number[]) => Uint8Array.from(v);

describe('compareBytes', () => {
  it('reports zero errors for identical data', () => {
    const s = compareBytes(bytes(1, 2, 3), bytes(1, 2, 3));
    expect(s).toMatchObject({ bitsSent: 24, matchedBytes: 3, bitErrors: 0, lostBytes: 0 });
    expect(s.ber).toBe(0);
    expect(s.decisionBer).toBe(0);
  });

  it('counts flipped bits in matched bytes', () => {
    const s = compareBytes(bytes(0b0000_0000, 0xff), bytes(0b0001_0001, 0x7f));
    expect(s.bitErrors).toBe(3);
    expect(s.ber).toBeCloseTo(3 / 16);
  });

  it('realigns after a lost byte instead of failing every following byte', () => {
    const s = compareBytes(bytes(10, 20, 30, 40, 50), bytes(10, 30, 40, 50));
    expect(s).toMatchObject({ matchedBytes: 4, lostBytes: 1, inventedBytes: 0, bitErrors: 0 });
    expect(s.ber).toBeCloseTo(8 / 40); // the lost byte counts as 8 wrong bits
    expect(s.decisionBer).toBe(0);
  });

  it('realigns after an invented byte', () => {
    const s = compareBytes(bytes(10, 20, 30), bytes(10, 99, 20, 30));
    expect(s).toMatchObject({ matchedBytes: 3, lostBytes: 0, inventedBytes: 1, bitErrors: 0 });
    expect(s.ber).toBe(0);
  });

  it('reports a total loss when nothing arrives', () => {
    const s = compareBytes(bytes(1, 2), bytes());
    expect(s.ber).toBe(1);
    expect(s.decisionBer).toBeNaN();
  });
});

describe('alignBytes', () => {
  it('prefers matching a corrupted byte over lost + invented', () => {
    expect(alignBytes(bytes(1, 2, 3), bytes(1, 6, 3)).map((s) => s.op)).toEqual([
      'match',
      'match',
      'match',
    ]);
  });
});
