import captureWorkletUrl from './capture.worklet.ts?worker&url';
import { setAudioSessionType, unlockAudio } from './context.ts';
import type { RxCommand, RxMessage } from './protocol.ts';

/** Processing we ask the browser to switch off: it would distort the modem signal. */
export const MIC_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
} as const;

export interface MicReport {
  /** Device name, if the browser reveals it. */
  label: string;
  /** What the browser actually applied (may ignore some of our requests). */
  applied: MediaTrackSettings;
  /** Constraints the browser claims to support at all. */
  supported: MediaTrackSupportedConstraints;
  contextSampleRate: number;
  baseLatency: number;
}

/**
 * Live reception from the microphone:
 *
 *   mic → MediaStreamSource → AudioWorklet (capture) ══MessagePort══▶ Worker (demodulator)
 *
 * The audio thread only copies samples; the demodulator runs in a worker, and
 * the main thread only receives events and levels for the UI.
 */
export class AirReceiver {
  private readonly worker = new Worker(new URL('./rx.worker.ts', import.meta.url), {
    type: 'module',
  });
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private workletLoaded: Promise<void> | null = null;
  private wavWaiter: ((r: { bytes: Uint8Array; seconds: number }) => void) | null = null;

  constructor(onMessage: (message: RxMessage) => void) {
    this.worker.onmessage = (event: MessageEvent<RxMessage>) => {
      const message = event.data;
      if (message.type === 'wav') {
        this.wavWaiter?.(message);
        this.wavWaiter = null;
      } else {
        onMessage(message);
      }
    };
  }

  get listening(): boolean {
    return this.stream !== null;
  }

  /**
   * Opens the microphone and starts demodulating. Call `unlockAudio()` in the
   * click handler before awaiting this.
   */
  async start(baudRate: number): Promise<MicReport> {
    const ctx = unlockAudio();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia unavailable (the microphone needs HTTPS or localhost)');
    }
    setAudioSessionType('play-and-record');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS } });
    this.workletLoaded ??= ctx.audioWorklet.addModule(captureWorkletUrl);
    await this.workletLoaded;
    if (ctx.state === 'suspended') await ctx.resume();

    const capture = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    // A private channel from the worklet straight to the worker.
    const channel = new MessageChannel();
    capture.port.postMessage({ port: channel.port1 }, [channel.port1]);
    const command: RxCommand = {
      type: 'start',
      sampleRate: ctx.sampleRate,
      baudRate,
      port: channel.port2,
    };
    this.worker.postMessage(command, [channel.port2]);

    const source = ctx.createMediaStreamSource(stream);
    // Some browsers only run a worklet that is connected to the output, so
    // route it to the speakers through a silent gain node.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(capture).connect(mute).connect(ctx.destination);
    this.nodes = [source, capture, mute];
    this.stream = stream;

    const track = stream.getAudioTracks()[0];
    return {
      label: track?.label ?? '',
      applied: track?.getSettings() ?? {},
      supported: navigator.mediaDevices.getSupportedConstraints(),
      contextSampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency,
    };
  }

  stop(): void {
    this.worker.postMessage({ type: 'stop' } satisfies RxCommand);
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    setAudioSessionType('playback');
  }

  /** The last minute of raw microphone audio as a WAV file. */
  exportWav(): Promise<{ bytes: Uint8Array; seconds: number }> {
    return new Promise((resolve) => {
      this.wavWaiter = resolve;
      this.worker.postMessage({ type: 'export-wav' } satisfies RxCommand);
    });
  }
}
