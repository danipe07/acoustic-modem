/**
 * Receiver worker: gets microphone chunks directly from the capture worklet
 * (through a MessagePort), runs the streaming FSK demodulator on them and
 * reports events and audio levels to the main thread. It also keeps the last
 * minute of raw audio so a failed test can be downloaded as a WAV file.
 */
import { encodeWav } from '../core/codec/wav.ts';
import { amplitudeToDb, powerToDb } from '../core/math/db.ts';
import { fskConfig } from '../core/modem/fsk/config.ts';
import { FskDemodulator } from '../core/modem/fsk/demodulator.ts';
import type { RxCommand, RxMessage } from './protocol.ts';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RxCommand>) => void) | null;
  postMessage(message: RxMessage, transfer?: Transferable[]): void;
};

const RECORD_SECONDS = 60;

let demod: FskDemodulator | null = null;
let port: MessagePort | null = null;
let sampleRate = 48_000;
let processed = 0;
let recording: Float32Array[] = [];
let recordedSamples = 0;

// Level meter state.
let blockPower = 0;
let blockPeak = 0;
let blockCount = 0;
let noisePower = NaN;
let signalPowerSum = 0;
let signalBlocks = 0;
let inTransmission = false;

function stop(): void {
  port?.close();
  port = null;
  demod = null;
}

function handleChunk(chunk: Float32Array): void {
  if (!demod) return;

  // Keep the most recent RECORD_SECONDS of audio.
  recording.push(chunk);
  recordedSamples += chunk.length;
  while (recordedSamples - (recording[0]?.length ?? 0) >= RECORD_SECONDS * sampleRate) {
    recordedSamples -= recording.shift()?.length ?? 0;
  }

  const events = demod.push(chunk);
  processed += chunk.length;
  for (const e of events) {
    if (e.type === 'carrier') {
      inTransmission = true;
      signalPowerSum = 0;
      signalBlocks = 0;
    } else if (e.type === 'end') {
      inTransmission = false;
    }
  }
  if (events.length > 0) scope.postMessage({ type: 'events', events });

  // Levels, reported about ten times per second.
  let power = 0;
  let peak = 0;
  for (const v of chunk) {
    power += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  blockPower += power / chunk.length;
  blockPeak = Math.max(blockPeak, peak);
  blockCount++;
  const meanPower = power / chunk.length;
  if (inTransmission) {
    signalPowerSum += meanPower;
    signalBlocks++;
  } else {
    noisePower = Number.isNaN(noisePower) ? meanPower : 0.9 * noisePower + 0.1 * meanPower;
  }
  if (blockCount * chunk.length >= sampleRate / 10) {
    // Digital silence would give −∞ dB: clamp to a floor no real microphone reaches.
    const floor = (db: number) => Math.max(-120, db);
    scope.postMessage({
      type: 'level',
      rmsDb: floor(powerToDb(blockPower / blockCount)),
      peakDb: floor(amplitudeToDb(blockPeak)),
      noiseDb: floor(powerToDb(noisePower)),
      signalDb: signalBlocks > 0 ? floor(powerToDb(signalPowerSum / signalBlocks)) : NaN,
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
    sampleRate = command.sampleRate;
    demod = new FskDemodulator(fskConfig(sampleRate, { baudRate: command.baudRate }));
    processed = 0;
    recording = [];
    recordedSamples = 0;
    noisePower = NaN;
    signalBlocks = 0;
    inTransmission = false;
    port = command.port;
    port.onmessage = (e: MessageEvent<Float32Array>) => handleChunk(e.data);
  } else if (command.type === 'stop') {
    stop();
  } else {
    const all = new Float32Array(recordedSamples);
    let offset = 0;
    for (const chunk of recording) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    const bytes = encodeWav(all, sampleRate);
    scope.postMessage({ type: 'wav', bytes, seconds: all.length / sampleRate }, [bytes.buffer]);
  }
};
