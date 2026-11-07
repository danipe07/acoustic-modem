import type { Modulator } from '../types.ts';
import { type FskConfig, validateFskConfig } from './config.ts';

/**
 * Continuous-phase binary FSK (CPFSK) modulator.
 *
 * A phase accumulator advances by 2π·f/fs every sample, where f is the tone of
 * the current bit. Switching tones only changes the *speed* at which the phase
 * advances, never the phase itself, so the waveform has no jumps: no clicks and
 * no spectral splatter outside the two tones.
 *
 * Raised-cosine ramps fade the signal in and out to avoid clicks at the edges.
 */
export class FskModulator implements Modulator {
  readonly config: FskConfig;

  constructor(config: FskConfig) {
    validateFskConfig(config);
    this.config = config;
  }

  get sampleRate(): number {
    return this.config.sampleRate;
  }

  modulate(bits: Uint8Array): Float32Array {
    const { sampleRate, baudRate, freq0, freq1, amplitude, rampMs } = this.config;
    // Symbol k occupies samples [k·fs/R, (k+1)·fs/R), which also works when
    // fs/R is not an integer.
    const total = Math.round((bits.length * sampleRate) / baudRate);
    const out = new Float32Array(total);
    const step0 = (2 * Math.PI * freq0) / sampleRate;
    const step1 = (2 * Math.PI * freq1) / sampleRate;
    const twoPi = 2 * Math.PI;

    let phase = 0;
    for (let n = 0; n < total; n++) {
      const symbol = Math.min(bits.length - 1, Math.floor((n * baudRate) / sampleRate));
      out[n] = amplitude * Math.sin(phase);
      phase += bits[symbol] ? step1 : step0;
      if (phase >= twoPi) phase -= twoPi;
    }

    const rampLength = Math.min(Math.round((rampMs * sampleRate) / 1000), Math.floor(total / 2));
    for (let i = 0; i < rampLength; i++) {
      const gain = 0.5 * (1 - Math.cos((Math.PI * i) / rampLength));
      out[i] *= gain;
      out[total - 1 - i] *= gain;
    }
    return out;
  }
}
