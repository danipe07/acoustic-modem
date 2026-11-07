import type { FskEvent } from '../modem/fsk/demodulator.ts';
import { type BitErrorStats, makeStats, popcount8 } from '../stats.ts';

/** What happened to one transmitted byte. */
export interface ByteOutcome {
  sentIndex: number;
  sent: number;
  status: 'ok' | 'bit-errors' | 'lost';
  received?: number;
  bitErrors: number;
  /** The received stop bit was 0. */
  framingError: boolean;
  /** Received start-bit edge (sample index at the receiver). */
  receivedSample?: number;
  /** Received start-bit edge minus the true edge, in samples. */
  timingError?: number;
  /** Lost while the receiver had no carrier (not yet detected, or ended early). */
  lostWithoutCarrier?: boolean;
}

/**
 * Error breakdown of a simulated transmission. Unlike `compareBytes`, which
 * only sees the two byte sequences, this uses the ground-truth timing known in
 * simulation, so every problem gets its real cause:
 *  - carrier not detected → bytes lost without carrier
 *  - start bit missed     → byte lost although the carrier was on
 *  - false start          → invented byte (no real byte at that time)
 *  - stop bit wrong       → framing error in a correctly timed byte
 *  - decision errors      → wrong data bits in a correctly timed byte
 */
export interface LinkReport {
  stats: BitErrorStats;
  carrierDetected: boolean;
  lostWithoutCarrier: number;
  lostStartBits: number;
  inventedBytes: number;
  stopBitErrors: number;
  bytes: ByteOutcome[];
  /** Received byte events that matched no real byte. */
  invented: Extract<FskEvent, { type: 'byte' }>[];
}

/**
 * @param sent           transmitted bytes
 * @param expectedEdges  true start-bit edge of each byte, in RECEIVED samples
 * @param events         demodulator output
 * @param symbolLength   samples per symbol at the receiver
 */
export function analyzeLink(
  sent: Uint8Array,
  expectedEdges: readonly number[],
  events: readonly FskEvent[],
  symbolLength: number,
): LinkReport {
  const bytes: ByteOutcome[] = Array.from(sent, (value, sentIndex) => ({
    sentIndex,
    sent: value,
    status: 'lost',
    bitErrors: 0,
    framingError: false,
  }));
  const invented: LinkReport['invented'] = [];

  // Periods during which the receiver believed a transmission was on.
  const carrierOn: [number, number][] = [];
  let carrierStart: number | null = null;

  for (const e of events) {
    if (e.type === 'carrier') {
      carrierStart = e.sample;
    } else if (e.type === 'end') {
      if (carrierStart !== null) carrierOn.push([carrierStart, e.sample]);
      carrierStart = null;
    } else {
      const k = nearestIndex(expectedEdges, e.sample);
      const outcome = k >= 0 ? bytes[k] : undefined;
      const error = k >= 0 ? e.sample - expectedEdges[k] : Infinity;
      if (outcome && outcome.status === 'lost' && Math.abs(error) <= symbolLength / 2) {
        outcome.received = e.value;
        outcome.bitErrors = popcount8(outcome.sent ^ e.value);
        outcome.status = outcome.bitErrors === 0 ? 'ok' : 'bit-errors';
        outcome.framingError = e.framingError;
        outcome.receivedSample = e.sample;
        outcome.timingError = error;
      } else {
        invented.push(e);
      }
    }
  }
  if (carrierStart !== null) carrierOn.push([carrierStart, Infinity]);

  let matched = 0;
  let bitErrors = 0;
  let stopBitErrors = 0;
  let lostWithoutCarrier = 0;
  let lostStartBits = 0;
  for (const b of bytes) {
    if (b.status === 'lost') {
      const edge = expectedEdges[b.sentIndex];
      b.lostWithoutCarrier = !carrierOn.some(([from, to]) => edge >= from && edge <= to);
      if (b.lostWithoutCarrier) lostWithoutCarrier++;
      else lostStartBits++;
    } else {
      matched++;
      bitErrors += b.bitErrors;
      if (b.framingError) stopBitErrors++;
    }
  }

  return {
    stats: makeStats(sent.length * 8, matched, bitErrors, sent.length - matched, invented.length),
    carrierDetected: events.some((e) => e.type === 'carrier'),
    lostWithoutCarrier,
    lostStartBits,
    inventedBytes: invented.length,
    stopBitErrors,
    bytes,
    invented,
  };
}

/** Index of the value in the sorted array closest to x (−1 if empty). */
function nearestIndex(sorted: readonly number[], x: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - x) <= Math.abs(sorted[lo] - x)) return lo - 1;
  return lo;
}
