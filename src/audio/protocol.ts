import type { FskEvent } from '../core/modem/fsk/demodulator.ts';

/** Main thread → receiver worker. */
export type RxCommand =
  | { type: 'start'; sampleRate: number; baudRate: number; port: MessagePort }
  | { type: 'stop' }
  | { type: 'export-wav' };

/** Receiver worker → main thread. */
export type RxMessage =
  | { type: 'events'; events: FskEvent[] }
  | {
      type: 'level';
      /** RMS and peak of the last ~100 ms, dBFS. */
      rmsDb: number;
      peakDb: number;
      /** Smoothed level while no transmission is being received, dBFS. */
      noiseDb: number;
      /** Mean level during the current/last transmission, dBFS (NaN if none yet). */
      signalDb: number;
      /** Samples processed since `start`. */
      samples: number;
    }
  | { type: 'wav'; bytes: Uint8Array; seconds: number };
