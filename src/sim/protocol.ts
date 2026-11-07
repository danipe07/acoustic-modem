import type { LinkReport } from '../core/analysis/link-report.ts';
import type { ChannelConfig } from '../core/channel/channel.ts';
import type { FskEvent } from '../core/modem/fsk/demodulator.ts';

/** Message from the UI to the simulation worker. */
export interface SimRequest {
  id: number;
  text: string;
  baudRate: number;
  sampleRate: number;
  seed: number;
  channel: Omit<ChannelConfig, 'txSampleRate'>;
}

/** Reply from the simulation worker. */
export interface SimResponse {
  id: number;
  sent: Uint8Array;
  events: FskEvent[];
  report: LinkReport;
  /** Audio as the receiver hears it (after the channel). */
  rxAudio: Float32Array;
  rxSampleRate: number;
  /** Duration of the transmitted signal, seconds. */
  airtime: number;
  /** Number of symbols on the channel (lead-in, start/stop and data bits, tail). */
  channelBits: number;
  snrDb: number;
  ebN0Db: number;
  /** When the receiver's timeline starts relative to the transmitter's (silence before). */
  delaySamples: number;
  computeMs: number;
}

export interface SimError {
  id: number;
  error: string;
}
