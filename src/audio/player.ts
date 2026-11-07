/**
 * Plays sample buffers through the speakers with the Web Audio API.
 *
 * Browsers (Safari on iOS in particular) only allow audio to start from a
 * user gesture, so `unlock()` must be called synchronously inside the click
 * handler; playback itself may happen later.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  /** Creates or resumes the AudioContext. Call from a user-gesture handler. */
  unlock(): void {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /**
   * Starts playing `samples`, normalised to a comfortable level (the simulated
   * received signal may be 60 dB quieter than the transmitted one).
   * Returns the AudioContext time at which playback starts.
   */
  play(samples: Float32Array, sampleRate: number, onEnded: () => void): number {
    this.unlock();
    const ctx = this.context as AudioContext;
    this.stop();

    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    const gain = peak > 0 ? 0.5 / peak : 1;

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
