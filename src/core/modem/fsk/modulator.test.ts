import { describe, expect, it } from 'vitest';
import { goertzelPower } from '../../math/goertzel.ts';
import { fskConfig, samplesPerSymbol } from './config.ts';
import { FskModulator } from './modulator.ts';

describe('FskModulator', () => {
  const cfg = fskConfig(48_000); // 50 Bd → 960 samples per symbol
  const modulator = new FskModulator(cfg);
  const N = samplesPerSymbol(cfg);

  it('produces one symbol period per bit', () => {
    expect(modulator.modulate(new Uint8Array(10)).length).toBe(10 * N);
    const odd = new FskModulator(fskConfig(44_100, { baudRate: 200 })); // 220.5 samples/symbol
    expect(odd.modulate(new Uint8Array(4)).length).toBe(882);
  });

  it('stays within the configured amplitude and fades in from silence', () => {
    const y = modulator.modulate(Uint8Array.from([1, 0, 1, 1, 0]));
    expect(y[0]).toBe(0);
    expect(Math.max(...y.map(Math.abs))).toBeLessThanOrEqual(cfg.amplitude + 1e-6);
  });

  it('keeps the phase continuous across bit changes (no clicks)', () => {
    const bits = Uint8Array.from({ length: 40 }, (_, i) => ((i * 7) % 3 === 0 ? 1 : 0));
    const y = modulator.modulate(bits);
    // The largest possible step of a sine at the highest tone:
    const maxStep = cfg.amplitude * ((2 * Math.PI * cfg.freq1) / cfg.sampleRate);
    let worst = 0;
    for (let n = 1; n < y.length; n++) worst = Math.max(worst, Math.abs(y[n] - y[n - 1]));
    expect(worst).toBeLessThanOrEqual(maxStep * 1.001);
  });

  it('puts each bit at its tone', () => {
    const bits = Uint8Array.from([1, 1, 0, 1, 0, 0, 1, 1]);
    const y = modulator.modulate(bits);
    const A2 = cfg.amplitude ** 2;
    // Skip the first and last symbols, which carry the fade ramps.
    for (let k = 1; k < bits.length - 1; k++) {
      const p0 = goertzelPower(y, cfg.freq0, cfg.sampleRate, k * N, N);
      const p1 = goertzelPower(y, cfg.freq1, cfg.sampleRate, k * N, N);
      const [wanted, unwanted] = bits[k] ? [p1, p0] : [p0, p1];
      expect(wanted).toBeCloseTo(A2, 3);
      expect(unwanted).toBeLessThan(1e-6);
    }
  });

  it('rejects invalid configurations', () => {
    expect(() => fskConfig(8000, { freq1: 5000 })).toThrow(RangeError); // above Nyquist
    expect(() => fskConfig(48_000, { freq0: 3000 })).toThrow(RangeError); // equal tones
  });
});
