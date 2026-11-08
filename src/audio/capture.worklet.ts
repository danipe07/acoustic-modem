/**
 * AudioWorklet processor that captures microphone samples.
 *
 * It runs on the browser's real-time audio thread and is called with blocks
 * of 128 samples (≈ 2.7 ms at 48 kHz). It must never block, so it does no
 * signal processing at all: it only gathers blocks into chunks of 2048
 * samples and transfers them (zero-copy) through a MessagePort straight to
 * the receiver worker, without going through the main thread.
 */

// The AudioWorkletGlobalScope types are not part of the DOM library.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(inputs: Float32Array[][]): boolean;
  },
): void;

const CHUNK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  private target: MessagePort | null = null;
  private chunk = new Float32Array(CHUNK);
  private filled = 0;

  constructor() {
    super();
    // The main thread sends the port that leads to the receiver worker.
    this.port.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
      this.target = event.data.port;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    // First input, channel 0 only. The node is created with channelCountMode
    // "max" and "discrete" interpretation, so a stereo microphone arrives as
    // two separate channels and is NOT averaged before reaching us.
    const samples = inputs[0]?.[0];
    if (!samples || !this.target) return true;
    let offset = 0;
    while (offset < samples.length) {
      const n = Math.min(samples.length - offset, CHUNK - this.filled);
      this.chunk.set(samples.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === CHUNK) {
        this.target.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(CHUNK);
        this.filled = 0;
      }
    }
    return true; // keep the processor alive
  }
}

registerProcessor('capture-processor', CaptureProcessor);
