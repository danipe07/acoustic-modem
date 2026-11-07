import { type ChannelConfig, type ChannelResult, simulateChannel } from '../channel/channel.ts';
import { utf8Encode } from '../codec/utf8.ts';
import { createRng } from '../math/rng.ts';
import { fskConfig, samplesPerSymbol } from '../modem/fsk/config.ts';
import {
  FskDemodulator,
  type FskDemodulatorOptions,
  type FskEvent,
} from '../modem/fsk/demodulator.ts';
import {
  byteEdges,
  collectBytes,
  encodeBytes,
  type TransmissionOptions,
} from '../modem/fsk/text-link.ts';
import { analyzeLink, type LinkReport } from './link-report.ts';
import { ebN0Db } from './theory.ts';

export interface FskTrialOptions {
  /** Payload: text (UTF-8 encoded) or raw bytes. */
  payload: string | Uint8Array;
  sampleRate: number;
  baudRate: number;
  channel?: Omit<ChannelConfig, 'txSampleRate'>;
  /** Seeds the channel (noise, reverb) and the chunk sizes. */
  seed: number;
  transmission?: Partial<TransmissionOptions>;
  demodulator?: Partial<FskDemodulatorOptions>;
  /** Feed the receiver in random chunks (64–4096 samples) like a live microphone. */
  chunked?: boolean;
}

export interface FskTrialResult {
  sent: Uint8Array;
  received: Uint8Array;
  events: FskEvent[];
  report: LinkReport;
  /** Transmitted audio, before the channel. */
  txAudio: Float32Array;
  /** Received audio, after the channel. */
  channel: ChannelResult;
  /** Eb/N0 per channel bit (start, data, stop and idle bits all count), dB. */
  ebN0Db: number;
}

/** One complete simulated transmission: encode → channel → receive → analyse. */
export function runFskTrial(o: FskTrialOptions): FskTrialResult {
  const sent = typeof o.payload === 'string' ? utf8Encode(o.payload) : o.payload;
  const txConfig = fskConfig(o.sampleRate, { baudRate: o.baudRate });
  const txAudio = encodeBytes(sent, txConfig, o.transmission);

  const rng = createRng(o.seed);
  const channel = simulateChannel(txAudio, { ...o.channel, txSampleRate: o.sampleRate }, rng);

  // The receiver only knows its own sample rate.
  const rxConfig = fskConfig(channel.sampleRate, { baudRate: o.baudRate });
  const demod = new FskDemodulator(rxConfig, o.demodulator);
  const events: FskEvent[] = [];
  if (o.chunked) {
    const chunkRng = createRng(o.seed ^ 0x5bd1e995);
    for (let i = 0; i < channel.samples.length;) {
      const size = chunkRng.int(64, 4096);
      events.push(...demod.push(channel.samples.subarray(i, i + size)));
      i += size;
    }
  } else {
    events.push(...demod.push(channel.samples));
  }

  const expectedEdges = byteEdges(sent.length, txConfig, o.transmission).map(
    (edge) => channel.delaySamples + edge * channel.timeScale,
  );
  return {
    sent,
    received: collectBytes(events),
    events,
    report: analyzeLink(sent, expectedEdges, events, samplesPerSymbol(rxConfig)),
    txAudio,
    channel,
    ebN0Db: ebN0Db(channel.snrDb, channel.sampleRate, o.baudRate),
  };
}
