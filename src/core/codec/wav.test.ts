import { describe, expect, it } from 'vitest';
import { fskConfig } from '../modem/fsk/config.ts';
import { FskDemodulator } from '../modem/fsk/demodulator.ts';
import { collectBytes, encodeText } from '../modem/fsk/text-link.ts';
import { utf8Decode } from './utf8.ts';
import { decodeWav, encodeWav } from './wav.ts';

describe('wav', () => {
  it('writes a valid 16-bit PCM mono header', () => {
    const wav = encodeWav(new Float32Array(10), 44_100);
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 20);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('round-trips samples within 16-bit precision and clips out-of-range values', () => {
    const x = Float32Array.from([0, 0.5, -0.5, 0.999, -1, 2, -2]);
    const { samples, sampleRate } = decodeWav(encodeWav(x, 48_000));
    expect(sampleRate).toBe(48_000);
    const expected = [0, 0.5, -0.5, 0.999, -1, 1, -1];
    samples.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
  });

  it('a recorded transmission can be demodulated after saving it', () => {
    const cfg = fskConfig(48_000);
    const audio = encodeText('WAV ok', cfg);
    const padded = new Float32Array(audio.length + 20_000);
    padded.set(audio, 5000);
    const { samples } = decodeWav(encodeWav(padded, 48_000));
    expect(utf8Decode(collectBytes(new FskDemodulator(cfg).push(samples)))).toBe('WAV ok');
  });

  it('rejects files that are not WAV', () => {
    expect(() => decodeWav(new Uint8Array(44))).toThrow();
  });
});
