/**
 * Asynchronous serial framing, the scheme used by UARTs / RS-232 ports.
 *
 * - While idle, the line stays at 1 ("mark").
 * - Every byte is sent as: one start bit (0), 8 data bits least-significant
 *   bit first, and one or more stop bits (1). This is called "8N1".
 *
 * The 1 → 0 transition of the start bit tells the receiver exactly where a byte
 * begins, so it re-synchronises on every byte and tolerates small clock
 * differences between transmitter and receiver.
 */
export const UART_DATA_BITS = 8;

export interface UartFramingOptions {
  /** Idle (mark) symbols sent before the first byte so the receiver can detect the signal. */
  leadInSymbols: number;
  /** Idle symbols appended after the last byte. */
  tailSymbols: number;
  /** Stop bits per byte (default 1). */
  stopBits?: number;
}

export const uartBitsPerByte = (stopBits = 1): number => 1 + UART_DATA_BITS + stopBits;

export function uartFrameBits(bytes: Uint8Array, options: UartFramingOptions): Uint8Array {
  const stopBits = options.stopBits ?? 1;
  const perByte = uartBitsPerByte(stopBits);
  const bits = new Uint8Array(
    options.leadInSymbols + bytes.length * perByte + options.tailSymbols,
  ).fill(1);
  let k = options.leadInSymbols;
  for (const byte of bytes) {
    bits[k] = 0; // start bit
    for (let b = 0; b < UART_DATA_BITS; b++) bits[k + 1 + b] = (byte >> b) & 1;
    k += perByte; // stop bits are already 1
  }
  return bits;
}
