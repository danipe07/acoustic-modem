import { Biquad } from '../../math/biquad.ts';
import { meanPower } from '../../math/db.ts';
import { goertzelPower } from '../../math/goertzel.ts';
import { UART_DATA_BITS } from '../../framing/uart.ts';
import type { Demodulator } from '../types.ts';
import { type FskConfig, samplesPerSymbol, validateFskConfig } from './config.ts';

/**
 * Streaming, non-coherent binary FSK demodulator with UART-style byte sync.
 *
 * Pipeline for every incoming chunk:
 *  1. Band-pass filter (high-pass + low-pass) around the two tones.
 *  2. Slide a one-symbol window in steps of 1/8 symbol and measure, with
 *     Goertzel, the power p0 at freq0 and p1 at freq1. From them:
 *       purity  = (p0 + p1) / (2·total power)  → ≈1 if our tones dominate, ≈0 for noise
 *       balance = (p1 − p0) / (p1 + p0)        → +1 = clearly "1", −1 = clearly "0"
 *     Both are ratios, so they do not depend on volume or distance.
 *  3. State machine:
 *     search → wait for a steady "1" tone (the lead-in): carrier detected.
 *     hunt   → wait for balance to cross from + to − : a start bit begins.
 *              The crossing happens when the window is half inside the start
 *              bit, so the bit edge is half a symbol earlier.
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
}

export const FSK_DEMOD_DEFAULTS: Readonly<FskDemodulatorOptions> = {
  detectOn: 0.35,
  detectOff: 0.15,
  minLeadInSymbols: 3,
  hopsPerSymbol: 8,
  endAfterSymbols: 2,
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
  purity: number;
  balance: number;
}

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

  constructor(config: FskConfig, options: Partial<FskDemodulatorOptions> = {}) {
    validateFskConfig(config);
    this.config = config;
    this.options = { ...FSK_DEMOD_DEFAULTS, ...options };
    this.symbolLength = samplesPerSymbol(config);
    this.windowLength = Math.round(this.symbolLength);
    this.hop = this.symbolLength / this.options.hopsPerSymbol;

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
    return {
      // A sine of amplitude A has power A²/2 while Goertzel reports A², hence the 2.
      purity: total > 1e-12 ? Math.min(1, tone / (2 * total)) : 0,
      balance: tone > 0 ? (p1 - p0) / tone : 0,
    };
  }

  private stepSliding(events: FskEvent[]): void {
    const o = this.options;
    const m = this.measure(this.cursor);

    if (this.state === 'search') {
      const steadyMark = m.purity > o.detectOn && m.balance > 0.5;
      this.markRun = steadyMark ? this.markRun + 1 : 0;
      if (this.markRun >= o.minLeadInSymbols * o.hopsPerSymbol) {
        events.push({ type: 'carrier', sample: Math.round(this.cursor) });
        this.state = 'hunt';
        this.quietRun = 0;
        this.previousBalance = m.balance;
      }
      this.cursor += this.hop;
      return;
    }

    // hunt: looking for the next start bit, or for the end of the transmission.
    if (m.purity < o.detectOff) {
      this.previousBalance = 0;
      if (++this.quietRun >= o.endAfterSymbols * o.hopsPerSymbol) {
        events.push({ type: 'end', sample: Math.round(this.cursor) });
        this.state = 'search';
        this.markRun = 0;
      }
      this.cursor += this.hop;
      return;
    }
    this.quietRun = 0;

    if (this.previousBalance > 0 && m.balance <= 0) {
      // Linear interpolation between the last two windows locates the crossing
      // more precisely than the hop size.
      const fraction = this.previousBalance / (this.previousBalance - m.balance);
      const crossing = this.cursor - this.hop + fraction * this.hop;
      this.edge = crossing - this.symbolLength / 2;
      this.crossingCursor = this.cursor;
      this.state = 'byte';
      this.bitIndex = 0;
      this.byteValue = 0;
      this.confidence = 1;
      return;
    }
    this.previousBalance = m.balance;
    this.cursor += this.hop;
  }

  /** Decodes the next bit of the current byte. Returns false if more samples are needed. */
  private stepByte(events: FskEvent[]): boolean {
    const windowEnd = this.edge + (this.bitIndex + 1) * this.symbolLength;
    if (Math.round(windowEnd) > this.received) return false;
    const m = this.measure(windowEnd);
    const bit = m.balance > 0 ? 1 : 0;

    if (this.bitIndex === 0) {
      if (bit !== 0) {
        // False start (noise glitch): resume hunting just after it.
        this.state = 'hunt';
        this.cursor = this.crossingCursor + this.hop;
        this.previousBalance = 0;
        return true;
      }
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
