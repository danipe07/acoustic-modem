/**
 * Common interfaces shared by every modulation scheme (FSK now; PSK, QAM and
 * OFDM later), so the simulator and the UI can swap modems without changes.
 */
export interface Modulator {
  readonly sampleRate: number;
  /** Converts a bit sequence (one bit per element, 0 or 1) into audio samples in [-1, 1]. */
  modulate(bits: Uint8Array): Float32Array;
}

/**
 * Streaming demodulator: accepts audio in chunks of any size (as they arrive
 * from the microphone) and returns whatever events those samples completed.
 */
export interface Demodulator<TEvent> {
  push(samples: Float32Array): TEvent[];
  reset(): void;
}
