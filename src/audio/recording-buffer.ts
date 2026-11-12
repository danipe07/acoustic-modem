/**
 * Keeps the most recent microphone audio, addressed by absolute sample index
 * (samples since listening started), so the part that belongs to one reception
 * can be cut out later, whether or not it decoded.
 */
export interface RecordingSlice {
  samples: Float32Array;
  /** Absolute index of `samples[0]`. */
  firstSample: number;
}

export class RecordingBuffer {
  private readonly capacity: number;
  private chunks: Float32Array[] = [];
  private stored = 0;
  private end = 0;

  /** @param capacity Samples to keep at least (whole chunks are kept, so slightly more). */
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Absolute index of the oldest sample still stored. */
  get firstSample(): number {
    return this.end - this.stored;
  }

  /** Absolute index one past the newest sample. */
  get endSample(): number {
    return this.end;
  }

  /** Appends a chunk. The buffer keeps a reference: do not modify it afterwards. */
  push(chunk: Float32Array): void {
    this.chunks.push(chunk);
    this.stored += chunk.length;
    this.end += chunk.length;
    while (this.chunks.length > 1 && this.stored - this.chunks[0].length >= this.capacity) {
      this.stored -= this.chunks[0].length;
      this.chunks.shift();
    }
  }

  /** Copy of the samples in [from, to), clamped to what is still stored. */
  slice(from = this.firstSample, to = this.end): RecordingSlice {
    const first = Math.max(this.firstSample, Math.min(Math.round(from), this.end));
    const last = Math.max(first, Math.min(Math.round(to), this.end));
    const samples = new Float32Array(last - first);
    let position = this.firstSample;
    for (const chunk of this.chunks) {
      const a = Math.max(first, position);
      const b = Math.min(last, position + chunk.length);
      if (a < b) samples.set(chunk.subarray(a - position, b - position), a - first);
      position += chunk.length;
    }
    return { samples, firstSample: first };
  }
}
