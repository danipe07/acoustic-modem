import { describe, expect, it } from 'vitest';
import type { FskEvent } from '../modem/fsk/demodulator.ts';
import { analyzeLink } from './link-report.ts';
import { berNoncoherentBfsk, ebN0Db, snrDbFromEbN0 } from './theory.ts';

const N = 960;
const edges = [10_000, 19_600, 29_200, 38_800];
const sent = Uint8Array.from([0x41, 0x42, 0x43, 0x44]);
const byte = (sample: number, value: number, framingError = false): FskEvent => ({
  type: 'byte',
  sample,
  value,
  framingError,
  confidence: 1,
});

describe('analyzeLink', () => {
  it('classifies every kind of error by its true cause', () => {
    const events: FskEvent[] = [
      { type: 'carrier', sample: 5000 },
      byte(10_030, 0x41), // ok, 30 samples late
      // byte 1: start bit missed
      byte(24_000, 0x11), // invented: no real byte here
      byte(29_100, 0x43 ^ 0b101, true), // two bit errors and a wrong stop bit
      { type: 'end', sample: 33_000 },
      // byte 3 arrives after the receiver gave up: lost without carrier
    ];
    const r = analyzeLink(sent, edges, events, N);
    expect(r.bytes.map((b) => b.status)).toEqual(['ok', 'lost', 'bit-errors', 'lost']);
    expect(r).toMatchObject({
      carrierDetected: true,
      lostStartBits: 1,
      lostWithoutCarrier: 1,
      inventedBytes: 1,
      stopBitErrors: 1,
    });
    expect(r.bytes[0].timingError).toBe(30);
    expect(r.stats).toMatchObject({ matchedBytes: 2, bitErrors: 2, lostBytes: 2 });
    expect(r.stats.decisionBer).toBeCloseTo(2 / 16);
    expect(r.stats.ber).toBeCloseTo((2 + 16) / 32);
  });

  it('counts everything as lost without carrier when nothing was detected', () => {
    const r = analyzeLink(sent, edges, [], N);
    expect(r.carrierDetected).toBe(false);
    expect(r.lostWithoutCarrier).toBe(4);
    expect(r.stats.ber).toBe(1);
  });
});

describe('theory', () => {
  it('converts full-band SNR to Eb/N0 (fs = 48 kHz, 50 bit/s → +26.8 dB)', () => {
    expect(ebN0Db(0, 48_000, 50)).toBeCloseTo(26.81, 2);
    expect(snrDbFromEbN0(ebN0Db(-7, 44_100, 200), 44_100, 200)).toBeCloseTo(-7, 10);
  });

  it('gives the textbook non-coherent BFSK error rate', () => {
    expect(berNoncoherentBfsk(-Infinity)).toBe(0.5);
    expect(berNoncoherentBfsk(10)).toBeCloseTo(0.5 * Math.exp(-5), 12);
    // About 1e-3 near Eb/N0 = 10.9 dB:
    expect(berNoncoherentBfsk(10.9)).toBeGreaterThan(5e-4);
    expect(berNoncoherentBfsk(10.9)).toBeLessThan(2e-3);
  });
});
