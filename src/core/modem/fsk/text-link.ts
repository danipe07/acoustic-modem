import { utf8Encode } from '../../codec/utf8.ts';
import { uartFrameBits } from '../../framing/uart.ts';
import type { FskConfig } from './config.ts';
import type { FskEvent } from './demodulator.ts';
import { FskModulator } from './modulator.ts';

/** How bytes are wrapped into a phase-1 transmission. */
export interface TransmissionOptions {
  /** Steady "1" tone before the data, so the receiver can detect the signal. */
  leadInMs: number;
  /** Steady "1" tone after the data. */
  tailMs: number;
  stopBits: number;
}

export const TRANSMISSION_DEFAULTS: Readonly<TransmissionOptions> = {
  leadInMs: 300,
  tailMs: 100,
  stopBits: 1,
};

/** Bytes → UART bits → FSK audio. */
export function encodeBytes(
  bytes: Uint8Array,
  config: FskConfig,
  options: Partial<TransmissionOptions> = {},
): Float32Array {
  const o = { ...TRANSMISSION_DEFAULTS, ...options };
  const bits = uartFrameBits(bytes, {
    leadInSymbols: Math.ceil((o.leadInMs / 1000) * config.baudRate),
    tailSymbols: Math.ceil((o.tailMs / 1000) * config.baudRate),
    stopBits: o.stopBits,
  });
  return new FskModulator(config).modulate(bits);
}

/** Text → UTF-8 bytes → UART bits → FSK audio. */
export function encodeText(
  text: string,
  config: FskConfig,
  options: Partial<TransmissionOptions> = {},
): Float32Array {
  return encodeBytes(utf8Encode(text), config, options);
}

/** Extracts the received bytes, in order, from a list of demodulator events. */
export function collectBytes(events: readonly FskEvent[]): Uint8Array {
  const bytes: number[] = [];
  for (const e of events) if (e.type === 'byte') bytes.push(e.value);
  return Uint8Array.from(bytes);
}
