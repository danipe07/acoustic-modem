/**
 * End-to-end tests: text → FSK modulator → simulated acoustic channel →
 * streaming demodulator → text.
 *
 * Random channels use TEST_SEEDS only: the receiver's constants were tuned on
 * TUNING_SEEDS (scripts/ber-bench.ts), so these are channels it never saw.
 */
import { describe, expect, it } from 'vitest';
import { type FskTrialOptions, runFskTrial } from '../../analysis/fsk-trial.ts';
import { TEST_SEEDS } from '../../analysis/seeds.ts';
import { utf8Decode } from '../../codec/utf8.ts';
import { createRng } from '../../math/rng.ts';
import { fskConfig } from './config.ts';
import { FskDemodulator } from './demodulator.ts';
import { collectBytes, encodeText } from './text-link.ts';

const TEXT = '¡Hola, mundo! Ñandú 👋 0123456789';
const [SEED] = TEST_SEEDS;

function transmit(options: Partial<FskTrialOptions> = {}) {
  const r = runFskTrial({
    payload: TEXT,
    sampleRate: 48_000,
    baudRate: 50,
    seed: SEED,
    ...options,
    channel: { leadingSilenceMs: 250, trailingSilenceMs: 300, ...options.channel },
  });
  return { ...r, text: utf8Decode(r.received) };
}

describe('FSK end to end', () => {
  describe('ideal channel', () => {
    it.each([
      [44_100, 50],
      [44_100, 100],
      [44_100, 200], // 220.5 samples per symbol
      [48_000, 50],
      [48_000, 100],
      [48_000, 200],
    ])('fs = %i Hz, %i Bd: text arrives intact', (sampleRate, baudRate) => {
      const r = transmit({ sampleRate, baudRate });
      expect(r.text).toBe(TEXT);
      expect(r.events.map((e) => e.type).filter((t) => t !== 'byte')).toEqual(['carrier', 'end']);
      expect(r.report.bytes.every((b) => Math.abs(b.timingError ?? Infinity) < 20)).toBe(true);
    });

    it('decodes identically when the samples arrive in random chunks', () => {
      expect(transmit({ chunked: true }).events).toEqual(transmit().events);
    });

    it('decodes two transmissions separated by silence', () => {
      const cfg = fskConfig(48_000);
      const a = encodeText('first', cfg);
      const b = encodeText('second', cfg);
      const gap = 48_000 / 2;
      const audio = new Float32Array(gap + a.length + gap + b.length + gap);
      audio.set(a, gap);
      audio.set(b, 2 * gap + a.length);
      const events = new FskDemodulator(cfg).push(audio);
      expect(events.filter((e) => e.type === 'carrier')).toHaveLength(2);
      expect(events.filter((e) => e.type === 'end')).toHaveLength(2);
      expect(utf8Decode(collectBytes(events))).toBe('firstsecond');
    });

    it('works at any distance without noise (volume-independent detection)', () => {
      for (const attenuationDb of [0, 20, 40, 60]) {
        expect(transmit({ channel: { attenuationDb } }).text).toBe(TEXT);
      }
    });
  });

  describe('random start time', () => {
    it.each(TEST_SEEDS)('seed %i: synchronises after a random leading silence', (seed) => {
      const leadingSilenceMs = createRng(seed).int(0, 2000);
      expect(transmit({ seed, chunked: true, channel: { leadingSilenceMs } }).text).toBe(TEXT);
    });
  });

  describe('white Gaussian noise', () => {
    it.each(TEST_SEEDS)('seed %i: error-free at 50 and 100 Bd with SNR = −3 dB', (seed) => {
      for (const baudRate of [50, 100]) {
        const r = transmit({ seed, baudRate, channel: { noise: { snrDb: -3 } } });
        expect(r.report.stats.ber).toBe(0);
        expect(r.report.inventedBytes).toBe(0);
      }
    });

    it.each(TEST_SEEDS)('seed %i: error-free at 200 Bd with SNR = 0 dB', (seed) => {
      const r = transmit({ seed, baudRate: 200, channel: { noise: { snrDb: 0 } } });
      expect(r.report.stats.ber).toBe(0);
      expect(r.report.inventedBytes).toBe(0);
    });

    it.each(TEST_SEEDS)('seed %i: never misses the first start bit after the lead-in', (seed) => {
      // Regression: at a 1 → 0 transition the window holds half of each tone,
      // the purity dips below the noise threshold for one window and the
      // receiver used to forget the balance history, missing the crossing.
      const payload = Uint8Array.from([0xa9, 0x20, 0x1c, 0xd0, 0x55, 0x55, 0x55, 0x55]);
      const r = transmit({ seed, payload, baudRate: 100, channel: { noise: { snrDb: -9 } } });
      expect(r.report.bytes.map((b) => b.status)).toEqual(Array(8).fill('ok'));
      expect(r.report.inventedBytes).toBe(0);
    });

    it('is reproducible: the same seed gives exactly the same result', () => {
      const channel = { noise: { snrDb: -9 } };
      const a = transmit({ channel });
      const b = transmit({ channel });
      expect(b.events).toEqual(a.events);
      expect(b.report.stats).toEqual(a.report.stats);
    });

    it('fails gracefully when the noise is far too strong', () => {
      const r = transmit({ channel: { noise: { snrDb: -20 } } });
      expect(r.report.stats.ber).toBeGreaterThan(0.1);
    });

    it('raises no false alarm on noise alone', () => {
      const rng = createRng(SEED);
      const noise = Float32Array.from({ length: 48_000 * 5 }, () => 0.1 * rng.gaussian());
      expect(new FskDemodulator(fskConfig(48_000)).push(noise)).toEqual([]);
    });
  });

  describe('sample-rate mismatch between devices', () => {
    it.each([
      [48_000, 44_100],
      [44_100, 48_000],
    ])('transmitter at %i Hz, receiver at %i Hz', (sampleRate, rxSampleRate) => {
      for (const baudRate of [50, 200]) {
        expect(transmit({ sampleRate, baudRate, channel: { rxSampleRate } }).text).toBe(TEXT);
      }
    });

    it.each([-1000, -500, 500, 1000])('transmitter clock off by %i ppm (±0.1 %%)', (ppm) => {
      for (const baudRate of [50, 200]) {
        expect(transmit({ baudRate, channel: { clockOffsetPpm: ppm } }).text).toBe(TEXT);
      }
    });

    it('a long message survives a 0.1 % clock error (UART resyncs every byte)', () => {
      const long = 'The quick brown fox jumps over the lazy dog. '.repeat(4);
      const r = transmit({ payload: long, baudRate: 200, channel: { clockOffsetPpm: 1000 } });
      expect(r.text).toBe(long);
    });
  });

  describe('twist (one tone much quieter than the other)', () => {
    // A reflection a few centimetres longer than the direct path (e.g. off the
    // table) is a comb filter: a 0.25 ms echo notches 2000 Hz, a 1/6 ms echo
    // notches 3000 Hz. With a −2 dB echo one tone arrives ~16 dB below the other.
    const cases = [
      ['tone 0 (2000 Hz) quieter', 0.25],
      ['tone 1 (3000 Hz) quieter', 1 / 6],
    ] as const;
    for (const [name, delayMs] of cases) {
      it.each(TEST_SEEDS)(`seed %i: ${name}: one reception, text intact`, (seed) => {
        const r = transmit({
          seed,
          payload: 'Prueba 1: ¡Hola desde el módem acústico! 0123456789',
          channel: { echoes: [{ delayMs, gainDb: -2 }], noise: { snrDb: 10 } },
        });
        expect(r.events.filter((e) => e.type === 'carrier')).toHaveLength(1);
        expect(r.text).toBe('Prueba 1: ¡Hola desde el módem acústico! 0123456789');
      });
    }
  });

  describe('one transmission, one reception', () => {
    it.each(TEST_SEEDS)(
      'seed %i: a sudden level drop mid-message never opens a second reception before silence',
      (seed) => {
        // Regression: after an end declared inside a transmission, the rest of
        // that same transmission used to be detected as a new one.
        const cfg = fskConfig(48_000);
        const a = encodeText('Prueba 1: ¡Hola desde el módem acústico! 0123456789', cfg);
        const b = encodeText('second', cfg);
        const gap = 24_000;
        const audio = new Float32Array(gap + a.length + gap + b.length + gap);
        audio.set(a, gap);
        // From byte 12 on, the signal drops by 20 dB (someone covers the speaker).
        const dropAt = gap + Math.round((0.3 + 12 * 0.2) * 48_000);
        for (let i = dropAt; i < gap + a.length; i++) audio[i] *= 0.1;
        audio.set(b, 2 * gap + a.length);
        const rng = createRng(seed);
        for (let i = 0; i < audio.length; i++) audio[i] += 0.002 * rng.gaussian();

        const events = new FskDemodulator(cfg).push(audio);
        const carriers = events.filter((e) => e.type === 'carrier');
        const ends = events.filter((e) => e.type === 'end');
        // Exactly the two real transmissions; the second only after the silent gap.
        expect(carriers).toHaveLength(2);
        expect(ends).toHaveLength(2);
        expect(carriers[1].sample).toBeGreaterThan(gap + a.length);
        expect(utf8Decode(collectBytes(events)).endsWith('second')).toBe(true);
      },
    );
  });

  describe('room acoustics', () => {
    it.each(TEST_SEEDS)('seed %i: discrete echoes', (seed) => {
      const echoes = [
        { delayMs: 3, gainDb: -3 },
        { delayMs: 12, gainDb: -8 },
        { delayMs: 35, gainDb: -12 },
      ];
      expect(transmit({ seed, channel: { echoes } }).text).toBe(TEXT);
    });

    it.each(TEST_SEEDS)('seed %i: long decaying reverb (RT60 = 0.6 s, −10 dB)', (seed) => {
      const r = transmit({ seed, channel: { reverb: { rt60: 0.6, wetDb: -10 } } });
      expect(r.text).toBe(TEXT);
      expect(r.report.inventedBytes).toBe(0);
    });

    it.each(TEST_SEEDS)('seed %i: very long reverb (RT60 = 1.2 s, −10 dB)', (seed) => {
      const r = transmit({ seed, channel: { reverb: { rt60: 1.2, wetDb: -10 } } });
      expect(r.text).toBe(TEXT);
      expect(r.report.inventedBytes).toBe(0);
    });
  });

  describe('everything at once', () => {
    it.each(TEST_SEEDS)(
      'seed %i: 48→44.1 kHz, +300 ppm, echoes, reverb, attenuation, noise',
      (seed) => {
        const r = transmit({
          seed,
          chunked: true,
          channel: {
            rxSampleRate: 44_100,
            clockOffsetPpm: 300,
            echoes: [{ delayMs: 4, gainDb: -6 }],
            reverb: { rt60: 0.5, wetDb: -12 },
            attenuationDb: 30,
            noise: { snrDb: 3 },
            leadingSilenceMs: 777,
          },
        });
        expect(r.text).toBe(TEXT);
      },
    );
  });
});
