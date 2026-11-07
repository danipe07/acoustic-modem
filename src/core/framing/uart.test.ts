import { describe, expect, it } from 'vitest';
import { uartBitsPerByte, uartFrameBits } from './uart.ts';

describe('uartFrameBits', () => {
  it('frames each byte as start bit, 8 data bits LSB first, stop bit', () => {
    const bits = uartFrameBits(Uint8Array.from([0x41]), { leadInSymbols: 0, tailSymbols: 0 });
    // 0x41 = 0100_0001 → LSB first: 1,0,0,0,0,0,1,0
    expect(Array.from(bits)).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
  });

  it('adds idle lead-in and tail symbols (mark = 1)', () => {
    const bits = uartFrameBits(Uint8Array.from([0x00]), { leadInSymbols: 3, tailSymbols: 2 });
    expect(Array.from(bits)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
  });

  it('supports several stop bits', () => {
    const bytes = Uint8Array.from([0xff, 0x00]);
    const bits = uartFrameBits(bytes, { leadInSymbols: 0, tailSymbols: 0, stopBits: 2 });
    expect(bits.length).toBe(2 * uartBitsPerByte(2));
    expect(bits[11]).toBe(0); // second byte's start bit right after two stop bits
  });
});
