import { describe, expect, it } from 'vitest';
import { utf8Decode } from '../../codec/utf8.ts';
import { createRng } from '../../math/rng.ts';
import { fskConfig } from './config.ts';
import { FskDemodulator, type FskEvent } from './demodulator.ts';
import { collectBytes, encodeText } from './text-link.ts';

/** Ideal channel: the transmitted samples surrounded by silence. */
function withSilence(signal: Float32Array, before: number, after: number): Float32Array {
  const out = new Float32Array(before + signal.length + after);
  out.set(signal, before);
  return out;
}

describe('FskDemodulator (ideal channel)', () => {
  const cfg = fskConfig(48_000);

  it('decodes text and reports carrier, bytes and end', () => {
    const text = 'Hola';
    const audio = withSilence(encodeText(text, cfg), 5000, 5000);
    const events = new FskDemodulator(cfg).push(audio);
    expect(events[0]?.type).toBe('carrier');
    expect(events.at(-1)?.type).toBe('end');
    expect(utf8Decode(collectBytes(events))).toBe(text);
    const bytes = events.filter((e) => e.type === 'byte');
    expect(bytes.every((e) => !e.framingError && e.confidence > 0.9)).toBe(true);
  });

  it('gives identical events whatever the chunk sizes', () => {
    const audio = withSilence(encodeText('chunk test ✓', cfg), 1234, 4000);
    const whole = new FskDemodulator(cfg).push(audio);
    const rng = createRng(11);
    for (let trial = 0; trial < 3; trial++) {
      const demod = new FskDemodulator(cfg);
      const events: FskEvent[] = [];
      for (let i = 0; i < audio.length;) {
        const size = rng.int(1, 3000);
        events.push(...demod.push(audio.subarray(i, i + size)));
        i += size;
      }
      expect(events).toEqual(whole);
    }
  });

  it('locates the start-bit edge precisely', () => {
    const lead = 777;
    const audio = withSilence(encodeText('A', cfg, { leadInMs: 300 }), lead, 4000);
    const byte = new FskDemodulator(cfg).push(audio).find((e) => e.type === 'byte');
    const expectedEdge = lead + 15 * 960; // 300 ms of lead-in at 50 Bd = 15 symbols
    expect(byte?.sample).toBeGreaterThanOrEqual(expectedEdge - 20);
    expect(byte?.sample).toBeLessThanOrEqual(expectedEdge + 20);
  });

  it('stays silent on silence', () => {
    expect(new FskDemodulator(cfg).push(new Float32Array(48_000))).toEqual([]);
  });

  it('can be reset and reused', () => {
    const demod = new FskDemodulator(cfg);
    const audio = withSilence(encodeText('x', cfg), 100, 4000);
    const first = demod.push(audio);
    demod.reset();
    expect(demod.push(audio)).toEqual(first);
  });
});
