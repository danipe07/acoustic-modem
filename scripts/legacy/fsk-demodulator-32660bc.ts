// Snapshot of src/core/modem/fsk/demodulator.ts at commit 32660bc, the receiver
// that passed the first over-the-air tests. Only the import paths were changed.
// Kept so `npm run replay` can compare it with the current one. Do not edit.
import { Biquad } from '../../src/core/math/biquad.ts';
import { meanPower } from '../../src/core/math/db.ts';
import { goertzelPower } from '../../src/core/math/goertzel.ts';
import { UART_DATA_BITS, uartBitsPerByte } from '../../src/core/framing/uart.ts';
import type { Demodulator } from '../../src/core/modem/types.ts';
import {
  type FskConfig,
  samplesPerSymbol,
  validateFskConfig,
} from '../../src/core/modem/fsk/config.ts';

/**
 * Streaming, non-coherent binary FSK demodulator with UART-style byte sync.
 *
 * Pipeline for every incoming chunk:
 *  1. Band-pass filter (high-pass + low-pass) around the two tones.
 *  2. Slide a one-symbol window in steps of 1/8 symbol and measure, with
 *     Goertzel, the power p0 at freq0 and p1 at freq1. From them:
 *       purity  = (p0 + p1) / (2·total power)  → ≈1 if our tones dominate, ≈0 for noise
 *       balance = (q1 − q0) / (q1 + q0)        → +1 = clearly "1", −1 = clearly "0"
 *     where q0, q1 are p0, p1 divided by each tone's measured level (twist
 *     compensation). Both are ratios, so they do not depend on volume or distance.
 *  3. State machine:
 *     search → wait for a steady "1" tone (the lead-in): carrier detected.
 *     hunt   → wait for balance to cross from + to − : a start bit begins.
 *              The crossing happens when the window is half inside the start
 *              bit, so the bit edge is half a symbol earlier. After a good
 *              byte, a "flywheel" predicts the next edge and the measurement
 *              only nudges the prediction.
 *     byte   → measure each of the next 10 symbols over its full window
 *              (start, 8 data bits, stop) and decide bit = balance > 0.
 *     Losing the tones for a while ends the transmission and returns to search.
 */
export interface FskDemodulatorOptions {
  /** Purity above which a steady tone counts as signal. */
  detectOn: number;
  /** Purity below which the signal counts as gone (hysteresis). */
  detectOff: number;
  /** Symbols of steady "1" required to declare a carrier. */
  minLeadInSymbols: number;
  /** Window positions evaluated per symbol while searching (time resolution). */
  hopsPerSymbol: number;
  /** Symbols without signal after which the transmission is considered over. */
  endAfterSymbols: number;
  /** Stop bits per byte used by the transmitter. */
  stopBits: number;
}

export const FSK_DEMOD_DEFAULTS: Readonly<FskDemodulatorOptions> = {
  detectOn: 0.35,
  detectOff: 0.15,
  minLeadInSymbols: 3,
  hopsPerSymbol: 8,
  endAfterSymbols: 2,
  stopBits: 1,
};

export type FskEvent =
  | { type: 'carrier'; sample: number }
  | {
      type: 'byte';
      /** Absolute sample index of the start-bit edge. */
      sample: number;
      value: number;
      /** True if the stop bit was not a 1: the byte is probably corrupt. */
      framingError: boolean;
      /** Smallest |balance| among the 8 data bits: 1 = very clear, 0 = coin toss. */
      confidence: number;
    }
  | { type: 'end'; sample: number };

interface Measurement {
  p0: number;
  p1: number;
  purity: number;
  balance: number;
}

/** Weight of each new pilot observation in the per-tone gain estimates. */
const GAIN_SMOOTHING = 0.25;
/** Fraction of the measured timing error applied to the predicted start-bit edge. */
const TIMING_LOOP_GAIN = 0.25;
/** Tone power below this fraction of the transmission's level counts as "gone" (≈ −8 dB). */
const LEVEL_DROP = 0.15;
/** A start bit's tone-0 power must reach this fraction (≈ −5 dB) of the measured level. */
const START_BIT_MIN_LEVEL = 0.3;
/** Fraction of quiet windows (over `endAfterSymbols`) that ends a transmission. */
const END_QUIET_FRACTION = 0.75;
/** During the echo guard, a new carrier must be at least this fraction (−3 dB) of the last one. */
const ECHO_GUARD_LEVEL = 0.5;

type State = 'search' | 'hunt' | 'byte';

export class FskDemodulator implements Demodulator<FskEvent> {
  readonly config: FskConfig;
  readonly options: FskDemodulatorOptions;

  private readonly symbolLength: number; // may be fractional
  private readonly windowLength: number; // integer number of samples
  private readonly hop: number;
  private readonly highpass: Biquad;
  private readonly lowpass: Biquad;

  /** Filtered samples still needed; buffer[0] is absolute sample `bufferStart`. */
  private buffer = new Float32Array(0);
  private bufferStart = 0;
  private received = 0;

  private state: State = 'search';
  /** Absolute position of the end of the sliding window (search / hunt). */
  private cursor = 0;
  private markRun = 0;
  private quietRun = 0;
  private previousBalance = 0;
  /** Cursor value at which the current start bit was detected. */
  private crossingCursor = 0;
  /** Absolute position of the current start-bit edge (byte state). */
  private edge = 0;
  private bitIndex = 0;
  private byteValue = 0;
  private confidence = 1;
  /**
   * Received power of each tone ("twist" compensation). Rooms, speakers and
   * microphones never reproduce two frequencies equally loud; comparing raw
   * powers would bias every decision and every edge towards the louder tone.
   * Start bits (always 0) and stop bits (always 1) act as pilots of known
   * value to measure each tone's level.
   */
  private gain0 = 1;
  private gain1 = 1;
  private gain0Measured = false;
  private leadInPowerSum = 0;
  /** Samples from one start bit to the next when bytes are sent back to back. */
  private readonly bytePeriod: number;
  /**
   * "Flywheel" timing: after a good byte, where the next start bit should be.
   * Transmitters send bytes back to back, so the next edge is very predictable,
   * while the measured edge jitters with noise and reverberation.
   */
  private predictedEdge: number | null = null;
  /** Ring buffer of the most recent "quiet" decisions in the hunt state. */
  private readonly quietHistory: Uint8Array;
  private quietIndex = 0;
  private quietCount = 0;
  /** Level of the transmission that just ended (0 = no echo guard active). */
  private echoGuardLevel = 0;

  constructor(config: FskConfig, options: Partial<FskDemodulatorOptions> = {}) {
    validateFskConfig(config);
    this.config = config;
    this.options = { ...FSK_DEMOD_DEFAULTS, ...options };
    this.symbolLength = samplesPerSymbol(config);
    this.windowLength = Math.round(this.symbolLength);
    this.hop = this.symbolLength / this.options.hopsPerSymbol;
    this.bytePeriod = uartBitsPerByte(this.options.stopBits) * this.symbolLength;
    this.quietHistory = new Uint8Array(
      Math.max(1, Math.round(this.options.endAfterSymbols * this.options.hopsPerSymbol)),
    );

    const low = Math.min(config.freq0, config.freq1);
    const high = Math.max(config.freq0, config.freq1);
    this.highpass = new Biquad('highpass', low * 0.7, config.sampleRate);
    this.lowpass = new Biquad(
      'lowpass',
      Math.min(high * 1.3, config.sampleRate * 0.45),
      config.sampleRate,
    );
    this.reset();
  }

  reset(): void {
    this.highpass.reset();
    this.lowpass.reset();
    this.buffer = new Float32Array(0);
    this.bufferStart = 0;
    this.received = 0;
    this.state = 'search';
    this.cursor = this.windowLength;
    this.markRun = 0;
    this.quietRun = 0;
    this.previousBalance = 0;
    this.echoGuardLevel = 0;
    this.resetTracking();
  }

  private clearQuietHistory(): void {
    this.quietHistory.fill(0);
    this.quietIndex = 0;
    this.quietCount = 0;
    this.quietRun = 0;
  }

  private resetTracking(): void {
    this.gain0 = 1;
    this.gain1 = 1;
    this.gain0Measured = false;
    this.leadInPowerSum = 0;
    this.predictedEdge = null;
  }

  push(samples: Float32Array): FskEvent[] {
    this.append(this.lowpass.process(this.highpass.process(samples)));
    const events: FskEvent[] = [];
    for (;;) {
      if (this.state === 'byte') {
        if (!this.stepByte(events)) break;
      } else {
        if (Math.round(this.cursor) > this.received) break;
        this.stepSliding(events);
      }
    }
    this.discardOldSamples();
    return events;
  }

  /** Measures the one-symbol window that ends at absolute position `windowEnd`. */
  private measure(windowEnd: number): Measurement {
    const end = Math.round(windowEnd) - this.bufferStart;
    const start = end - this.windowLength;
    const { sampleRate, freq0, freq1 } = this.config;
    const p0 = goertzelPower(this.buffer, freq0, sampleRate, start, this.windowLength);
    const p1 = goertzelPower(this.buffer, freq1, sampleRate, start, this.windowLength);
    const total = meanPower(this.buffer, start, end);
    const tone = p0 + p1;
    const q0 = p0 / this.gain0;
    const q1 = p1 / this.gain1;
    return {
      p0,
      p1,
      // A sine of amplitude A has power A²/2 while Goertzel reports A², hence the 2.
      purity: total > 1e-12 ? Math.min(1, tone / (2 * total)) : 0,
      balance: q0 + q1 > 0 ? (q1 - q0) / (q0 + q1) : 0,
    };
  }

  private stepSliding(events: FskEvent[]): void {
    const o = this.options;
    const m = this.measure(this.cursor);

    if (this.state === 'search') {
      if (this.echoGuardLevel > 0 && m.purity < o.detectOff) {
        // Our tones have sunk into the noise: the room has fallen silent.
        // (A level drop alone is not enough: a decaying reverb tail is still
        // a clean tone, just a quiet one.)
        this.echoGuardLevel = 0;
      }
      const steadyMark =
        m.purity > o.detectOn && m.balance > 0.5 && m.p1 >= ECHO_GUARD_LEVEL * this.echoGuardLevel;
      if (steadyMark) {
        this.markRun++;
        this.leadInPowerSum += m.p1;
      } else {
        this.markRun = 0;
        this.leadInPowerSum = 0;
      }
      if (this.markRun >= o.minLeadInSymbols * o.hopsPerSymbol) {
        events.push({ type: 'carrier', sample: Math.round(this.cursor) });
        // Until a start bit is seen, assume both tones arrive equally loud.
        this.gain1 = this.leadInPowerSum / this.markRun;
        this.gain0 = this.gain1;
        this.gain0Measured = false;
        this.echoGuardLevel = 0;
        this.state = 'hunt';
        this.clearQuietHistory();
        this.previousBalance = m.balance;
      }
      this.cursor += this.hop;
      return;
    }

    // hunt: looking for the next start bit, or for the end of the transmission.
    // The end is either the tones vanishing into noise (low purity) or their
    // level collapsing: once the transmitter stops, the room's reverberation
    // still contains our tones, but much weaker than the direct sound was.
    const quiet = m.purity < o.detectOff || this.isWeak(m);
    this.quietRun = quiet ? this.quietRun + 1 : 0;
    if (this.recordQuiet(quiet)) {
      events.push({ type: 'end', sample: Math.round(this.cursor) });
      // Until the room falls silent, ignore anything much weaker than this
      // transmission: it is its own reverberation, not a new transmitter.
      this.echoGuardLevel = Math.max(this.gain0, this.gain1);
      this.state = 'search';
      this.markRun = 0;
      this.resetTracking();
      this.cursor += this.hop;
      return;
    }
    if (this.quietRun >= o.hopsPerSymbol / 2) {
      // Quiet for a while: the balance is meaningless, forget it so noise
      // cannot fake a crossing. A single quiet window is NOT enough: at a bit
      // transition the window holds half of each tone and the purity dips.
      this.previousBalance = 0;
      this.cursor += this.hop;
      return;
    }

    const halfSymbol = this.symbolLength / 2;
    if (this.predictedEdge !== null && this.cursor - halfSymbol > this.predictedEdge + halfSymbol) {
      // No start bit where the flywheel expected one: the transmitter paused.
      // Fall back to free-running edge detection.
      this.predictedEdge = null;
    }

    if (
      this.predictedEdge !== null &&
      this.previousBalance <= 0 &&
      m.balance <= 0 &&
      this.cursor >= this.predictedEdge + halfSymbol
    ) {
      // The stop bit was drowned (so no + → − crossing could appear), but we
      // are already inside a "0" exactly where a start bit was expected.
      this.startByte(this.predictedEdge);
      return;
    }

    if (this.previousBalance > 0 && m.balance <= 0) {
      // Linear interpolation between the last two windows locates the crossing
      // more precisely than the hop size.
      const fraction = this.previousBalance / (this.previousBalance - m.balance);
      const crossing = this.cursor - this.hop + fraction * this.hop;
      let edge = crossing - halfSymbol;
      if (this.predictedEdge !== null) {
        const error = edge - this.predictedEdge;
        if (error < -halfSymbol) {
          // Far too early to be the next start bit: a glitch (e.g. reverb)
          // inside the stop bit. Ignore it.
          this.previousBalance = m.balance;
          this.cursor += this.hop;
          return;
        }
        // Flywheel: trust the prediction and correct it only partially with
        // the noisy measurement (a first-order timing loop).
        edge = this.predictedEdge + TIMING_LOOP_GAIN * error;
      }
      this.startByte(edge);
      return;
    }
    this.previousBalance = m.balance;
    this.cursor += this.hop;
  }

  /**
   * Records whether the latest window was quiet and returns true when most of
   * the last `endAfterSymbols` symbols were quiet: the transmission is over.
   * A fraction (not an unbroken run) tolerates noise that flickers around the
   * detection threshold.
   */
  private recordQuiet(quiet: boolean): boolean {
    const history = this.quietHistory;
    const slot = this.quietIndex;
    this.quietCount += (quiet ? 1 : 0) - history[slot];
    history[slot] = quiet ? 1 : 0;
    this.quietIndex = (slot + 1) % history.length;
    return this.quietCount >= END_QUIET_FRACTION * history.length;
  }

  /** True if the tones are far below the level measured during this transmission. */
  private isWeak(m: Measurement): boolean {
    return m.p0 + m.p1 < LEVEL_DROP * Math.max(this.gain0, this.gain1);
  }

  private startByte(edge: number): void {
    this.clearQuietHistory();
    this.edge = edge;
    this.crossingCursor = this.cursor;
    this.state = 'byte';
    this.bitIndex = 0;
    this.byteValue = 0;
    this.confidence = 1;
  }

  /** Decodes the next bit of the current byte. Returns false if more samples are needed. */
  private stepByte(events: FskEvent[]): boolean {
    const windowEnd = this.edge + (this.bitIndex + 1) * this.symbolLength;
    if (Math.round(windowEnd) > this.received) return false;
    const m = this.measure(windowEnd);
    const bit = m.balance > 0 ? 1 : 0;

    if (this.bitIndex === 0) {
      if (bit !== 0 || m.p0 < START_BIT_MIN_LEVEL * this.gain0) {
        // False start (noise glitch, or a "0" far weaker than this
        // transmission's tone 0): resume hunting just after it.
        this.state = 'hunt';
        this.cursor = this.crossingCursor + this.hop;
        this.previousBalance = 0;
        return true;
      }
      // Valid start bit: a pilot for the level of tone 0.
      this.gain0 = this.gain0Measured ? smooth(this.gain0, m.p0) : m.p0;
      this.gain0Measured = true;
    } else if (this.bitIndex <= UART_DATA_BITS) {
      this.byteValue |= bit << (this.bitIndex - 1); // LSB first
      this.confidence = Math.min(this.confidence, Math.abs(m.balance));
    } else {
      events.push({
        type: 'byte',
        sample: Math.round(this.edge),
        value: this.byteValue,
        framingError: bit !== 1,
        confidence: this.confidence,
      });
      if (bit === 1) {
        // Valid stop bit: a pilot for the level of tone 1, and a byte we trust
        // enough to predict where the next one should start.
        this.gain1 = smooth(this.gain1, m.p1);
        this.predictedEdge = this.edge + this.bytePeriod;
      } else {
        this.predictedEdge = null; // possibly out of sync: re-acquire freely
      }
      // The next start bit can begin right after this stop bit.
      this.state = 'hunt';
      this.cursor = windowEnd + this.hop;
      this.previousBalance = m.balance;
      this.quietRun = 0;
      return true;
    }
    this.bitIndex++;
    return true;
  }

  private append(samples: Float32Array): void {
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;
    this.received += samples.length;
  }

  /** Drops samples that no future window can reach, keeping memory bounded. */
  private discardOldSamples(): void {
    const oldestNeeded =
      this.state === 'byte'
        ? Math.min(this.edge, this.crossingCursor + this.hop - this.windowLength)
        : this.cursor - this.windowLength;
    const keepFrom = Math.floor(oldestNeeded) - 2;
    const drop = keepFrom - this.bufferStart;
    if (drop > 4 * this.windowLength) {
      this.buffer = this.buffer.slice(drop);
      this.bufferStart = keepFrom;
    }
  }
}

/** Exponential moving average step. */
function smooth(current: number, observation: number): number {
  return current + GAIN_SMOOTHING * (observation - current);
}
