/**
 * End-to-end tests: text → FSK modulator → simulated acoustic channel →
 * streaming demodulator → text. Every channel is seeded, so any failure can be
 * replayed exactly.
 */
import { describe, expect, it } from 'vitest';
import { type ChannelConfig, simulateChannel } from '../../channel/channel.ts';
import { utf8Decode, utf8Encode } from '../../codec/utf8.ts';
import { createRng, type Rng } from '../../math/rng.ts';
import { compareBytes } from '../../stats.ts';
import { fskConfig } from './config.ts';
import { FskDemodulator, type FskEvent } from './demodulator.ts';
import { collectBytes, encodeText } from './text-link.ts';

const TEXT = '¡Hola, mundo! Ñandú 👋 0123456789';
const SEEDS = [1, 2, 3, 4, 5];

interface RunOptions {
  baudRate?: number;
  txSampleRate?: number;
  channel?: Omit<ChannelConfig, 'txSampleRate'>;
  seed?: number;
  /** Feed the receiver in random chunk sizes, like a live microphone. */
  chunked?: boolean;
}

function pushInChunks(demod: FskDemodulator, samples: Float32Array, rng: Rng): FskEvent[] {
  const events: FskEvent[] = [];
  for (let i = 0; i < samples.length;) {
    const size = rng.int(64, 4096);
    events.push(...demod.push(samples.subarray(i, i + size)));
    i += size;
  }
  return events;
}

function transmit(text: string, options: RunOptions = {}) {
  const { baudRate = 50, txSampleRate = 48_000, seed = 1 } = options;
  const audio = encodeText(text, fskConfig(txSampleRate, { baudRate }));
  const rng = createRng(seed);
  const channel = simulateChannel(
    audio,
    { leadingSilenceMs: 250, trailingSilenceMs: 300, ...options.channel, txSampleRate },
    rng,
  );
  // The receiver only knows its own sample rate.
  const demod = new FskDemodulator(fskConfig(channel.sampleRate, { baudRate }));
  const events = options.chunked
    ? pushInChunks(demod, channel.samples, rng)
    : demod.push(channel.samples);
  const received = collectBytes(events);
  return {
    events,
    text: utf8Decode(received),
    stats: compareBytes(utf8Encode(text), received),
    snrDb: channel.snrDb,
  };
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
    ])('fs = %i Hz, %i Bd: text arrives intact', (txSampleRate, baudRate) => {
      const r = transmit(TEXT, { txSampleRate, baudRate });
      expect(r.text).toBe(TEXT);
      expect(r.events.map((e) => e.type).filter((t) => t !== 'byte')).toEqual(['carrier', 'end']);
    });

    it('decodes identically when the samples arrive in random chunks', () => {
      const whole = transmit(TEXT, { seed: 3 });
      const chunked = transmit(TEXT, { seed: 3, chunked: true });
      expect(chunked.events).toEqual(whole.events);
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
        expect(transmit(TEXT, { channel: { attenuationDb } }).text).toBe(TEXT);
      }
    });
  });

  describe('random start time', () => {
    it.each(SEEDS)('seed %i: synchronises after a random leading silence', (seed) => {
      const leadingSilenceMs = createRng(seed * 101).int(0, 2000);
      expect(transmit(TEXT, { seed, chunked: true, channel: { leadingSilenceMs } }).text).toBe(
        TEXT,
      );
    });
  });

  describe('white Gaussian noise', () => {
    it.each(SEEDS)('seed %i: error-free at 50 and 100 Bd with SNR = −3 dB', (seed) => {
      for (const baudRate of [50, 100]) {
        const r = transmit(TEXT, { seed, baudRate, channel: { noise: { snrDb: -3 } } });
        expect(r.stats.ber).toBe(0);
      }
    });

    it.each(SEEDS)('seed %i: error-free at 200 Bd with SNR = 0 dB', (seed) => {
      const r = transmit(TEXT, { seed, baudRate: 200, channel: { noise: { snrDb: 0 } } });
      expect(r.stats.ber).toBe(0);
    });

    it('is reproducible: the same seed gives exactly the same result', () => {
      const channel = { noise: { snrDb: -9 } };
      const a = transmit(TEXT, { seed: 42, channel });
      const b = transmit(TEXT, { seed: 42, channel });
      expect(b.events).toEqual(a.events);
      expect(b.stats).toEqual(a.stats);
    });

    it('fails gracefully when the noise is far too strong', () => {
      const r = transmit(TEXT, { channel: { noise: { snrDb: -20 } } });
      expect(r.stats.ber).toBeGreaterThan(0.1);
    });

    it('raises no false alarm on noise alone', () => {
      const rng = createRng(8);
      const noise = Float32Array.from({ length: 48_000 * 5 }, () => 0.1 * rng.gaussian());
      expect(new FskDemodulator(fskConfig(48_000)).push(noise)).toEqual([]);
    });
  });

  describe('sample-rate mismatch between devices', () => {
    it.each([
      [48_000, 44_100],
      [44_100, 48_000],
    ])('transmitter at %i Hz, receiver at %i Hz', (txSampleRate, rxSampleRate) => {
      for (const baudRate of [50, 200]) {
        const r = transmit(TEXT, { txSampleRate, baudRate, channel: { rxSampleRate } });
        expect(r.text).toBe(TEXT);
      }
    });

    it.each([-1000, -500, 500, 1000])('transmitter clock off by %i ppm (±0.1 %%)', (ppm) => {
      for (const baudRate of [50, 200]) {
        const r = transmit(TEXT, { baudRate, channel: { clockOffsetPpm: ppm } });
        expect(r.text).toBe(TEXT);
      }
    });

    it('a long message survives a 0.1 % clock error (UART resyncs every byte)', () => {
      const long = 'The quick brown fox jumps over the lazy dog. '.repeat(4);
      const r = transmit(long, { baudRate: 200, channel: { clockOffsetPpm: 1000 } });
      expect(r.text).toBe(long);
    });
  });

  describe('room acoustics', () => {
    it.each(SEEDS)('seed %i: discrete echoes', (seed) => {
      const echoes = [
        { delayMs: 3, gainDb: -3 },
        { delayMs: 12, gainDb: -8 },
        { delayMs: 35, gainDb: -12 },
      ];
      expect(transmit(TEXT, { seed, channel: { echoes } }).text).toBe(TEXT);
    });

    it.each(SEEDS)('seed %i: long decaying reverb (RT60 = 0.6 s, −10 dB)', (seed) => {
      const reverb = { rt60: 0.6, wetDb: -10 };
      expect(transmit(TEXT, { seed, channel: { reverb } }).text).toBe(TEXT);
    });

    it.each(SEEDS)('seed %i: very long reverb (RT60 = 1.2 s, −10 dB)', (seed) => {
      const reverb = { rt60: 1.2, wetDb: -10 };
      expect(transmit(TEXT, { seed, channel: { reverb } }).text).toBe(TEXT);
    });
  });

  describe('everything at once', () => {
    it.each(SEEDS)('seed %i: 48→44.1 kHz, +300 ppm, echoes, reverb, attenuation, noise', (seed) => {
      const r = transmit(TEXT, {
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
    });
  });
});
