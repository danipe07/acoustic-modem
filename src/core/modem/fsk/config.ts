/**
 * Binary FSK parameters.
 *
 * Each bit is a tone: 0 → `freq0`, 1 → `freq1`, held for one symbol period
 * (1 / baudRate seconds). With 2000 Hz / 3000 Hz and 50 baud every symbol
 * lasts 20 ms, so each tone completes a whole number of cycles (40 and 60):
 * the two tones are orthogonal and do not leak into each other's detector.
 */
export interface FskConfig {
  /** Samples per second of the audio device (e.g. 44 100 or 48 000). */
  sampleRate: number;
  /** Symbols per second. In binary FSK one symbol carries one bit. */
  baudRate: number;
  /** Tone for bit 0 ("space"), Hz. */
  freq0: number;
  /** Tone for bit 1 ("mark"), Hz. */
  freq1: number;
  /** Peak amplitude of the generated signal, 0–1. */
  amplitude: number;
  /** Duration of the fade-in / fade-out ramps, ms. */
  rampMs: number;
}

export const FSK_DEFAULTS: Readonly<Omit<FskConfig, 'sampleRate'>> = {
  baudRate: 50,
  freq0: 2000,
  freq1: 3000,
  amplitude: 0.5,
  rampMs: 5,
};

export function fskConfig(
  sampleRate: number,
  overrides: Partial<Omit<FskConfig, 'sampleRate'>> = {},
): FskConfig {
  const config: FskConfig = { ...FSK_DEFAULTS, ...overrides, sampleRate };
  validateFskConfig(config);
  return config;
}

export function validateFskConfig(c: FskConfig): void {
  const nyquist = c.sampleRate / 2;
  if (!(c.sampleRate > 0)) throw new RangeError('sampleRate must be positive');
  if (!(c.baudRate > 0 && c.baudRate < c.sampleRate / 4)) {
    throw new RangeError('baudRate must be positive and well below the sample rate');
  }
  for (const f of [c.freq0, c.freq1]) {
    if (!(f > 0 && f < nyquist)) throw new RangeError(`tone ${f} Hz must lie in (0, ${nyquist})`);
  }
  if (c.freq0 === c.freq1) throw new RangeError('freq0 and freq1 must differ');
  if (!(c.amplitude > 0 && c.amplitude <= 1)) throw new RangeError('amplitude must be in (0, 1]');
  if (!(c.rampMs >= 0)) throw new RangeError('rampMs must be ≥ 0');
}

/** Samples per symbol. Not necessarily an integer (44 100 / 200 = 220.5). */
export const samplesPerSymbol = (c: FskConfig): number => c.sampleRate / c.baudRate;
