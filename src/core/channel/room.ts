import { dbToAmplitude, dbToPower } from '../math/db.ts';
import type { Rng } from '../math/rng.ts';

/** A discrete reflection: a delayed, attenuated copy of the direct sound. */
export interface Echo {
  delayMs: number;
  /** Gain relative to the direct path, dB (negative = weaker). */
  gainDb: number;
}

/**
 * Diffuse reverberation: thousands of overlapping reflections that blend into
 * a noise-like tail whose level decays exponentially.
 */
export interface Reverb {
  /** Time for the tail to decay by 60 dB, seconds (a living room: ~0.3–0.6 s). */
  rt60: number;
  /** Total energy of the tail relative to the direct sound, dB. */
  wetDb: number;
  /** Delay between the direct sound and the start of the tail, ms (default 5). */
  preDelayMs?: number;
}

/**
 * Builds the impulse response of a room: what the microphone would record if
 * the speaker emitted a single click. Its first sample (the direct path) is 1.
 */
export function roomImpulseResponse(
  sampleRate: number,
  echoes: readonly Echo[],
  reverb: Reverb | undefined,
  rng: Rng,
): Float64Array {
  let length = 1;
  for (const e of echoes) {
    length = Math.max(length, Math.round((e.delayMs * sampleRate) / 1000) + 1);
  }

  let tailStart = 0;
  let tailLength = 0;
  if (reverb) {
    if (!(reverb.rt60 > 0)) throw new RangeError('rt60 must be positive');
    tailStart = Math.max(1, Math.round(((reverb.preDelayMs ?? 5) * sampleRate) / 1000));
    tailLength = Math.ceil(reverb.rt60 * sampleRate);
    length = Math.max(length, tailStart + tailLength);
  }

  const h = new Float64Array(length);
  h[0] = 1;
  for (const e of echoes) {
    const delay = Math.round((e.delayMs * sampleRate) / 1000);
    if (delay < 1) throw new RangeError('echo delay must be at least one sample');
    h[delay] += dbToAmplitude(e.gainDb);
  }

  if (reverb) {
    // Amplitude falls by 60 dB (×1/1000) over rt60 seconds: exp(-ln(1000)·t/rt60).
    const decayPerSample = Math.log(1000) / (reverb.rt60 * sampleRate);
    const tail = new Float64Array(tailLength);
    let energy = 0;
    for (let n = 0; n < tailLength; n++) {
      tail[n] = rng.gaussian() * Math.exp(-decayPerSample * n);
      energy += tail[n] * tail[n];
    }
    const scale = Math.sqrt(dbToPower(reverb.wetDb) / energy);
    for (let n = 0; n < tailLength; n++) h[tailStart + n] += tail[n] * scale;
  }
  return h;
}
