/**
 * Live estimate of the signal and noise levels of an over-the-air link, from
 * the power of each microphone chunk and the demodulator's events.
 *
 *  - Signal: mean power between a `carrier` event and its `end` (it contains
 *    the noise underneath: it is really S + N).
 *  - Noise: smoothed power of the chunks heard outside transmissions.
 *
 * The carrier is only announced some tens of milliseconds after the tone
 * starts, and the room keeps ringing after the end. Counting those chunks as
 * noise would inflate the noise estimate by tens of dB exactly while a
 * transmission is being received. So quiet chunks wait in a queue for
 * `holdSeconds` before they count as noise: a carrier arriving in the meantime
 * throws the queue away, and nothing is queued for `holdSeconds` after an end.
 */
export interface LevelEvent {
  type: 'carrier' | 'byte' | 'end';
}

/** Time constant of the noise average, seconds. */
const NOISE_TIME_CONSTANT = 0.4;

export class LinkLevelTracker {
  private readonly sampleRate: number;
  private readonly holdSamples: number;
  private pending: { power: number; length: number }[] = [];
  private pendingSamples = 0;
  private holdOff = 0;
  private inTransmission = false;
  private noise = NaN;
  private signalEnergy = 0;
  private signalSamples = 0;

  constructor(sampleRate: number, holdSeconds = 0.5) {
    this.sampleRate = sampleRate;
    this.holdSamples = Math.round(holdSeconds * sampleRate);
  }

  /** Noise power (NaN until `holdSeconds` of audio without a transmission were heard). */
  get noisePower(): number {
    return this.noise;
  }

  /** Mean power of the current or last transmission, noise included (NaN if none yet). */
  get signalPower(): number {
    return this.signalSamples > 0 ? this.signalEnergy / this.signalSamples : NaN;
  }

  get receiving(): boolean {
    return this.inTransmission;
  }

  /**
   * Accounts for one chunk of `length` samples and mean power `power`, with
   * the events the demodulator produced while processing it.
   */
  push(power: number, length: number, events: readonly LevelEvent[]): void {
    for (const e of events) {
      if (e.type === 'carrier') {
        this.inTransmission = true;
        this.signalEnergy = 0;
        this.signalSamples = 0;
        // The queued chunks already contain the start of this transmission.
        this.pending = [];
        this.pendingSamples = 0;
        this.holdOff = 0;
      } else if (e.type === 'end') {
        this.inTransmission = false;
        this.holdOff = this.holdSamples;
      }
    }

    if (this.inTransmission) {
      this.signalEnergy += power * length;
      this.signalSamples += length;
      return;
    }
    if (this.holdOff > 0) {
      this.holdOff -= length;
      return;
    }
    this.pending.push({ power, length });
    this.pendingSamples += length;
    for (;;) {
      const [chunk] = this.pending;
      if (!chunk || this.pendingSamples - chunk.length < this.holdSamples) break;
      this.pending.shift();
      this.pendingSamples -= chunk.length;
      const weight = 1 - Math.exp(-chunk.length / (NOISE_TIME_CONSTANT * this.sampleRate));
      this.noise = Number.isNaN(this.noise)
        ? chunk.power
        : this.noise + weight * (chunk.power - this.noise);
    }
  }
}

/**
 * SNR in dB from a signal level that includes the noise (S + N) and the noise
 * level, both in dBFS. NaN when it cannot be estimated.
 */
export function snrFromLevels(signalDb: number, noiseDb: number): number {
  const signal = 10 ** (signalDb / 10) - 10 ** (noiseDb / 10);
  return signal > 0 ? 10 * Math.log10(signal) - noiseDb : NaN;
}
