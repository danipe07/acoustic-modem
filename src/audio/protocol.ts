import type { FskEvent } from '../core/modem/fsk/demodulator.ts';

/** Main thread → receiver worker. */
export type RxCommand =
  | {
      type: 'start';
      /** Listening session number, echoed back with every recording. */
      session: number;
      sampleRate: number;
      baudRate: number;
      port: MessagePort;
    }
  | { type: 'stop' }
  | { type: 'export-wav' };

/** Receiver worker → main thread. */
export type RxMessage =
  | {
      type: 'events';
      events: FskEvent[];
      /** Levels when the events were produced, dBFS (NaN if unknown). */
      noiseDb: number;
      signalDb: number;
    }
  | {
      type: 'level';
      /** RMS and peak of the last ~100 ms, dBFS. */
      rmsDb: number;
      peakDb: number;
      /** Smoothed level while no transmission is being received, dBFS (NaN at first). */
      noiseDb: number;
      /** Mean level during the current/last transmission, dBFS (NaN if none yet). */
      signalDb: number;
      /** Samples processed since `start`. */
      samples: number;
    }
  | {
      /**
       * The audio of one reception, sent shortly after it ends (or when
       * listening stops), whether or not anything could be decoded.
       */
      type: 'recording';
      session: number;
      /** `sample` of the reception's carrier event: identifies the reception. */
      carrierSample: number;
      /** Sample index (since `start`) of the first sample in the file. */
      firstSample: number;
      bytes: Uint8Array;
      seconds: number;
    }
  | { type: 'wav'; bytes: Uint8Array; seconds: number };
