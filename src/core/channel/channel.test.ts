import { describe, expect, it } from 'vitest';
import { meanPower, powerToDb } from '../math/db.ts';
import { goertzelPower } from '../math/goertzel.ts';
import { createRng } from '../math/rng.ts';
import { simulateChannel } from './channel.ts';

const fs = 48_000;

function tone(freq: number, amplitude: number, seconds: number, sampleRate = fs) {
  const n = Math.round(seconds * sampleRate);
  return Float32Array.from(
    { length: n },
    (_, i) => amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate),
  );
}

function impulse(length: number) {
  const x = new Float32Array(length);
  x[0] = 1;
  return x;
}

describe('simulateChannel', () => {
  it('is an identity with the default configuration', () => {
    const x = tone(2000, 0.5, 0.1);
    const r = simulateChannel(x, { txSampleRate: fs }, createRng(1));
    expect(r.samples).toEqual(x);
    expect(r.snrDb).toBe(Infinity);
  });

  it('is reproducible: same seed → same output, different seed → different output', () => {
    const x = tone(2000, 0.5, 0.2);
    const cfg = { txSampleRate: fs, noise: { snrDb: 10 }, reverb: { rt60: 0.2, wetDb: -10 } };
    const a = simulateChannel(x, cfg, createRng(5)).samples;
    const b = simulateChannel(x, cfg, createRng(5)).samples;
    const c = simulateChannel(x, cfg, createRng(6)).samples;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('adds silence before and after the signal', () => {
    const x = tone(2000, 0.5, 0.1);
    const r = simulateChannel(
      x,
      { txSampleRate: fs, leadingSilenceMs: 50, trailingSilenceMs: 25 },
      createRng(1),
    );
    expect(r.samples.length).toBe(2400 + x.length + 1200);
    expect(r.samples.subarray(0, 2400).every((v) => v === 0)).toBe(true);
  });

  describe('noise and attenuation', () => {
    it('adds noise at the requested SNR', () => {
      const x = tone(2000, 0.5, 1);
      const r = simulateChannel(
        x,
        { txSampleRate: fs, noise: { snrDb: 6 }, leadingSilenceMs: 1000 },
        createRng(2),
      );
      expect(r.snrDb).toBeCloseTo(6, 6);
      // The leading second holds noise only: measure its power.
      const measured = meanPower(r.samples, 0, fs);
      expect(powerToDb(measured / r.noisePower)).toBeCloseTo(0, 1);
    });

    it('scales the signal by the attenuation', () => {
      const x = tone(2000, 0.5, 0.1);
      const r = simulateChannel(x, { txSampleRate: fs, attenuationDb: 20 }, createRng(1));
      for (let i = 0; i < x.length; i += 97) expect(r.samples[i]).toBeCloseTo(x[i] / 10, 6);
    });

    it('with an absolute noise level, attenuation lowers the SNR', () => {
      const x = tone(2000, 0.5, 0.5); // power 0.125 ≈ −9 dB
      const near = simulateChannel(x, { txSampleRate: fs, noise: { powerDb: -40 } }, createRng(1));
      const far = simulateChannel(
        x,
        { txSampleRate: fs, noise: { powerDb: -40 }, attenuationDb: 15 },
        createRng(1),
      );
      expect(near.snrDb).toBeCloseTo(powerToDb(0.125) + 40, 1);
      expect(near.snrDb - far.snrDb).toBeCloseTo(15, 6);
    });
  });

  describe('sample-rate and clock mismatch', () => {
    it('converts 48 kHz → 44.1 kHz preserving the tone frequency', () => {
      const x = tone(3000, 0.5, 2);
      const r = simulateChannel(x, { txSampleRate: 48_000, rxSampleRate: 44_100 }, createRng(1));
      expect(r.sampleRate).toBe(44_100);
      expect(r.samples.length).toBeCloseTo(x.length * (44_100 / 48_000), -1);
      expect(goertzelPower(r.samples, 3000, 44_100, 22_050, 44_100)).toBeCloseTo(0.25, 3);
    });

    it.each([1000, -1000])('models a %i ppm transmitter clock error', (ppm) => {
      const x = tone(2000, 0.5, 3);
      const r = simulateChannel(x, { txSampleRate: fs, clockOffsetPpm: ppm }, createRng(1));
      const factor = 1 + ppm * 1e-6;
      expect(r.sampleRate).toBe(fs);
      expect(Math.abs(r.samples.length - x.length / factor)).toBeLessThanOrEqual(1);
      const shifted = 2000 * factor; // 2002 Hz or 1998 Hz
      expect(goertzelPower(r.samples, shifted, fs, fs, fs)).toBeCloseTo(0.25, 2);
      expect(goertzelPower(r.samples, 2000, fs, fs, fs)).toBeLessThan(0.01);
    });
  });

  describe('room acoustics', () => {
    it('adds discrete echoes at the given delays and gains', () => {
      const r = simulateChannel(
        impulse(10),
        {
          txSampleRate: fs,
          echoes: [
            { delayMs: 10, gainDb: -6 },
            { delayMs: 25, gainDb: -12 },
          ],
        },
        createRng(1),
      );
      expect(r.samples[0]).toBe(1);
      expect(r.samples[480]).toBeCloseTo(10 ** (-6 / 20), 6);
      expect(r.samples[1200]).toBeCloseTo(10 ** (-12 / 20), 6);
      expect(r.samples[300]).toBeCloseTo(0, 6);
    });

    it('adds a reverb tail with the requested energy and decay time', () => {
      const rt60 = 0.4;
      const r = simulateChannel(
        impulse(10),
        { txSampleRate: fs, reverb: { rt60, wetDb: -6 } },
        createRng(3),
      );
      const ir = r.samples;
      expect(ir[0]).toBeCloseTo(1, 6);
      // Tail energy relative to the direct sound (energy 1).
      const tailEnergy = meanPower(ir, 1) * (ir.length - 1);
      expect(powerToDb(tailEnergy)).toBeCloseTo(-6, 1);
      // Level 0.2 s later should be 30 dB lower (60 dB per rt60 = 0.4 s).
      const win = 0.02 * fs;
      const early = meanPower(ir, 0.05 * fs, 0.05 * fs + win);
      const late = meanPower(ir, 0.25 * fs, 0.25 * fs + win);
      expect(powerToDb(early / late)).toBeGreaterThan(27);
      expect(powerToDb(early / late)).toBeLessThan(33);
    });
  });
});
