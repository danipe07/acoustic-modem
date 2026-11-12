/**
 * Receiver worker: gets microphone chunks directly from the capture worklet
 * (through a MessagePort), runs the streaming FSK demodulator on them and
 * reports events and audio levels to the main thread.
 *
 * It also keeps the last minute of raw audio. From it, every reception gets
 * its own recording (from a little before its carrier to a little after its
 * end), sent to the main thread even if nothing could be decoded, so a failed
 * test can always be downloaded and replayed offline.
 */
import { encodeWav } from '../core/codec/wav.ts';
import { amplitudeToDb, powerToDb } from '../core/math/db.ts';
import { fskConfig } from '../core/modem/fsk/config.ts';
import { FskDemodulator } from '../core/modem/fsk/demodulator.ts';
import { LinkLevelTracker } from './level-tracker.ts';
import type { RxCommand, RxMessage } from './protocol.ts';
import { RecordingBuffer } from './recording-buffer.ts';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RxCommand>) => void) | null;
  postMessage(message: RxMessage, transfer?: Transferable[]): void;
};

const RECORD_SECONDS = 60;
/** Audio kept before the carrier of each reception (the noise floor before it). */
const PRE_ROLL_SECONDS = 1;
/** Audio kept after the end of each reception (the room's reverberation). */
const POST_ROLL_SECONDS = 0.5;

let demod: FskDemodulator | null = null;
let port: MessagePort | null = null;
let session = 0;
let sampleRate = 48_000;
let processed = 0;
let recording = new RecordingBuffer(RECORD_SECONDS * sampleRate);
let levels = new LinkLevelTracker(sampleRate);

/** Reception whose carrier was seen and whose end has not arrived yet. */
let openCarrier: number | null = null;
/** Finished reception waiting for its post-roll before being cut out. */
let closing: { carrierSample: number; cutAt: number } | null = null;

// Level meter state.
let blockPower = 0;
let blockPeak = 0;
let blockCount = 0;

/** Digital silence would give −∞ dB: clamp to a floor no real microphone reaches. */
const floorDb = (db: number) => Math.max(-120, db);

function sendRecording(carrierSample: number, to: number): void {
  const from = carrierSample - PRE_ROLL_SECONDS * sampleRate;
  const { samples, firstSample } = recording.slice(from, to);
  const bytes = encodeWav(samples, sampleRate);
  scope.postMessage(
    {
      type: 'recording',
      session,
      carrierSample,
      firstSample,
      bytes,
      seconds: samples.length / sampleRate,
    },
    [bytes.buffer],
  );
}

/** Sends the recordings that are still owed, with whatever audio there is. */
function flushRecordings(): void {
  if (closing) sendRecording(closing.carrierSample, closing.cutAt);
  if (openCarrier !== null) sendRecording(openCarrier, processed);
  closing = null;
  openCarrier = null;
}

function stop(): void {
  flushRecordings();
  port?.close();
  port = null;
  demod = null;
}

function handleChunk(chunk: Float32Array): void {
  if (!demod) return;
  recording.push(chunk);
  const events = demod.push(chunk);
  processed += chunk.length;

  let power = 0;
  let peak = 0;
  for (const v of chunk) {
    power += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const meanPower = power / chunk.length;
  levels.push(meanPower, chunk.length, events);

  for (const e of events) {
    if (e.type === 'carrier') {
      // Never keep two receptions waiting: cut the previous one now.
      flushRecordings();
      openCarrier = e.sample;
    } else if (e.type === 'end' && openCarrier !== null) {
      closing = {
        carrierSample: openCarrier,
        cutAt: e.sample + POST_ROLL_SECONDS * sampleRate,
      };
      openCarrier = null;
    }
  }
  if (events.length > 0) {
    scope.postMessage({
      type: 'events',
      events,
      noiseDb: floorDb(powerToDb(levels.noisePower)),
      signalDb: floorDb(powerToDb(levels.signalPower)),
    });
  }
  if (closing && processed >= closing.cutAt) {
    sendRecording(closing.carrierSample, closing.cutAt);
    closing = null;
  }

  // Levels, reported about ten times per second.
  blockPower += meanPower;
  blockPeak = Math.max(blockPeak, peak);
  blockCount++;
  if (blockCount * chunk.length >= sampleRate / 10) {
    scope.postMessage({
      type: 'level',
      rmsDb: floorDb(powerToDb(blockPower / blockCount)),
      peakDb: floorDb(amplitudeToDb(blockPeak)),
      noiseDb: floorDb(powerToDb(levels.noisePower)),
      signalDb: floorDb(powerToDb(levels.signalPower)),
      samples: processed,
    });
    blockPower = 0;
    blockPeak = 0;
    blockCount = 0;
  }
}

scope.onmessage = (event) => {
  const command = event.data;
  if (command.type === 'start') {
    stop();
    session = command.session;
    sampleRate = command.sampleRate;
    demod = new FskDemodulator(fskConfig(sampleRate, { baudRate: command.baudRate }));
    processed = 0;
    recording = new RecordingBuffer(RECORD_SECONDS * sampleRate);
    levels = new LinkLevelTracker(sampleRate);
    blockPower = 0;
    blockPeak = 0;
    blockCount = 0;
    port = command.port;
    port.onmessage = (e: MessageEvent<Float32Array>) => handleChunk(e.data);
  } else if (command.type === 'stop') {
    stop();
  } else {
    const { samples } = recording.slice();
    const bytes = encodeWav(samples, sampleRate);
    scope.postMessage({ type: 'wav', bytes, seconds: samples.length / sampleRate }, [bytes.buffer]);
  }
};
