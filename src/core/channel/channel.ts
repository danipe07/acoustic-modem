import { dbToAmplitude, dbToPower, meanPower, powerToDb } from '../math/db.ts';
import { convolve } from '../math/fft.ts';
import type { Rng } from '../math/rng.ts';
import { resample } from './resample.ts';
import { type Echo, type Reverb, roomImpulseResponse } from './room.ts';

/**
 * Additive white Gaussian noise (AWGN), either relative to the received signal
 * (`snrDb`) or at a fixed absolute level (`powerDb`, dB relative to a
 * full-scale power of 1). With a fixed level, attenuation lowers the SNR just
 * as moving the phones apart would.
 */
export type NoiseSpec = { snrDb: number } | { powerDb: number };

export interface ChannelConfig {
  /** Sample rate the transmitter believes it is using. */
  txSampleRate: number;
  /** Sample rate of the receiver (default: same as the transmitter). */
  rxSampleRate?: number;
  /**
   * Transmitter clock error in parts per million: +1000 ppm means its clock
   * runs 0.1 % fast, so the received signal is 0.1 % shorter and higher pitched.
   */
  clockOffsetPpm?: number;
  /** Discrete reflections. */
  echoes?: readonly Echo[];
  /** Diffuse reverberation tail. */
  reverb?: Reverb;
  /** Path loss, dB (positive = quieter). */
  attenuationDb?: number;
  noise?: NoiseSpec;
  /** Silence (noise only) before and after the signal, ms. */
  leadingSilenceMs?: number;
  trailingSilenceMs?: number;
}

export interface ChannelResult {
  samples: Float32Array;
  sampleRate: number;
  /** Mean power of the received signal over its own duration (without noise). */
  signalPower: number;
  noisePower: number;
  /** Full-band signal-to-noise ratio, dB (Infinity without noise). */
  snrDb: number;
}

/**
 * Simulated acoustic channel, applied in physical order:
 * clock/sample-rate mismatch → room (echoes + reverb) → attenuation →
 * surrounding silence → noise.
 *
 * All randomness comes from `rng`, so the same seed reproduces the same channel.
 */
export function simulateChannel(
  input: Float32Array,
  config: ChannelConfig,
  rng: Rng,
): ChannelResult {
  const rxRate = config.rxSampleRate ?? config.txSampleRate;

  // 1. The transmitter really plays at txRate·(1 + ppm·1e-6); the receiver
  //    samples at rxRate. Resampling by their ratio models both effects.
  const actualTxRate = config.txSampleRate * (1 + (config.clockOffsetPpm ?? 0) * 1e-6);
  const ratio = rxRate / actualTxRate;
  let signal: ArrayLike<number> = Math.abs(ratio - 1) > 1e-12 ? resample(input, ratio) : input;

  // 2. Room acoustics: convolution with the room impulse response.
  const echoes = config.echoes ?? [];
  if (echoes.length > 0 || config.reverb) {
    signal = convolve(signal, roomImpulseResponse(rxRate, echoes, config.reverb, rng));
  }

  // 3. Attenuation.
  const gain = dbToAmplitude(-(config.attenuationDb ?? 0));
  const signalPower = meanPower(signal) * gain * gain;

  // 4. Silence around the signal.
  const lead = Math.round(((config.leadingSilenceMs ?? 0) * rxRate) / 1000);
  const trail = Math.round(((config.trailingSilenceMs ?? 0) * rxRate) / 1000);
  const out = new Float32Array(lead + signal.length + trail);
  for (let i = 0; i < signal.length; i++) out[lead + i] = signal[i] * gain;

  // 5. Noise over the whole recording.
  let noisePower = 0;
  if (config.noise) {
    noisePower =
      'snrDb' in config.noise
        ? signalPower / dbToPower(config.noise.snrDb)
        : dbToPower(config.noise.powerDb);
    const sigma = Math.sqrt(noisePower);
    for (let i = 0; i < out.length; i++) out[i] += sigma * rng.gaussian();
  }

  return {
    samples: out,
    sampleRate: rxRate,
    signalPower,
    noisePower,
    snrDb: noisePower > 0 ? powerToDb(signalPower / noisePower) : Infinity,
  };
}
