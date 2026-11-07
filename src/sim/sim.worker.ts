/**
 * Simulation worker: runs transmitter → channel → receiver off the main
 * thread, so long messages or long reverberation never freeze the UI.
 */
import { runFskTrial } from '../core/analysis/fsk-trial.ts';
import type { SimError, SimRequest, SimResponse } from './protocol.ts';

// The project is type-checked with the DOM library, which conflicts with the
// WebWorker one; describe the few worker-scope members used here instead.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
  postMessage(message: SimResponse | SimError, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  try {
    const started = performance.now();
    const trial = runFskTrial({
      payload: request.text,
      sampleRate: request.sampleRate,
      baudRate: request.baudRate,
      seed: request.seed,
      channel: request.channel,
      chunked: true, // feed the receiver like a live microphone
    });
    const rxAudio = trial.channel.samples;
    const response: SimResponse = {
      id: request.id,
      sent: trial.sent,
      events: trial.events,
      report: trial.report,
      rxAudio,
      rxSampleRate: trial.channel.sampleRate,
      airtime: trial.txAudio.length / request.sampleRate,
      channelBits: Math.round((trial.txAudio.length * request.baudRate) / request.sampleRate),
      snrDb: trial.channel.snrDb,
      ebN0Db: trial.ebN0Db,
      delaySamples: trial.channel.delaySamples,
      computeMs: performance.now() - started,
    };
    scope.postMessage(response, [rxAudio.buffer]);
  } catch (error) {
    scope.postMessage({ id: request.id, error: String(error) });
  }
};
