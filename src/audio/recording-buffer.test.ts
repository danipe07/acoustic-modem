import { describe, expect, it } from 'vitest';
import { RecordingBuffer } from './recording-buffer.ts';

/** A chunk whose values are their own absolute sample index. */
const ramp = (from: number, length: number) => Float32Array.from({ length }, (_, i) => from + i);

function filled(capacity: number, chunkLength: number, chunks: number): RecordingBuffer {
  const buffer = new RecordingBuffer(capacity);
  for (let i = 0; i < chunks; i++) buffer.push(ramp(i * chunkLength, chunkLength));
  return buffer;
}

describe('RecordingBuffer', () => {
  it('returns any range by absolute sample index, across chunk borders', () => {
    const buffer = filled(1000, 100, 5);
    const { samples, firstSample } = buffer.slice(150, 320);
    expect(firstSample).toBe(150);
    expect([...samples]).toEqual([...ramp(150, 170)]);
  });

  it('drops the oldest chunks but always keeps at least `capacity` samples', () => {
    const buffer = filled(250, 100, 10);
    expect(buffer.endSample).toBe(1000);
    expect(buffer.firstSample).toBe(700); // 3 whole chunks ≥ 250 samples
    const all = buffer.slice();
    expect(all.firstSample).toBe(700);
    expect([...all.samples]).toEqual([...ramp(700, 300)]);
  });

  it('clamps a range that starts before the stored audio or ends after it', () => {
    const buffer = filled(250, 100, 10);
    const early = buffer.slice(0, 750);
    expect(early.firstSample).toBe(700);
    expect([...early.samples]).toEqual([...ramp(700, 50)]);
    const late = buffer.slice(950, 5000);
    expect([...late.samples]).toEqual([...ramp(950, 50)]);
    expect(buffer.slice(2000, 3000).samples).toHaveLength(0);
  });

  it('is empty before any audio arrives', () => {
    const buffer = new RecordingBuffer(100);
    expect(buffer.slice().samples).toHaveLength(0);
    expect(buffer.firstSample).toBe(0);
  });
});
