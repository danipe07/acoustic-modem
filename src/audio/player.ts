import { unlockAudio } from './context.ts';

/** Plays sample buffers through the speakers with the Web Audio API. */
export class AudioPlayer {
  private source: AudioBufferSourceNode | null = null;
  private context: AudioContext | null = null;

  /** Creates or resumes the shared AudioContext. Call from a user-gesture handler. */
  unlock(): AudioContext {
    this.context = unlockAudio();
    return this.context;
  }

  /**
   * Starts playing `samples`. With `normalize`, scales them to a comfortable
   * level (a simulated received signal may be 60 dB quieter than the
   * transmitted one); otherwise plays them exactly as given.
   * Returns the AudioContext time at which playback starts.
   */
  play(
    samples: Float32Array,
    sampleRate: number,
    onEnded: () => void,
    { normalize = true } = {},
  ): number {
    const ctx = this.unlock();
    this.stop();

    let gain = 1;
    if (normalize) {
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      gain = peak > 0 ? 0.5 / peak : 1;
    }

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] * gain;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
      onEnded();
    };
    const startAt = ctx.currentTime + 0.05;
    source.start(startAt);
    this.source = source;
    return startAt;
  }

  /** Current AudioContext time, in seconds. */
  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  stop(): void {
    if (this.source) {
      const source = this.source;
      this.source = null;
      source.stop();
    }
  }
}
