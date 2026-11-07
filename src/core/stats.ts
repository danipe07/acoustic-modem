/** Result of comparing what was sent with what was received. */
export interface BitErrorStats {
  /** Bits that were sent. */
  bitsSent: number;
  /** Wrong bits among the bytes that arrived. */
  bitErrors: number;
  /** Bytes that never arrived (each counts as 8 bit errors in the BER). */
  missingBytes: number;
  /** Unexpected extra bytes received. */
  extraBytes: number;
  /** Bit error rate: (bitErrors + 8·missingBytes) / bitsSent. */
  ber: number;
}

function popcount8(x: number): number {
  let count = 0;
  for (let v = x & 0xff; v; v &= v - 1) count++;
  return count;
}

/**
 * Bit error rate between sent and received bytes, aligned position by position.
 * (Phase 1 has no retransmission or resynchronisation of lost bytes, so a
 * positional comparison is the honest measure.)
 */
export function compareBytes(sent: Uint8Array, received: Uint8Array): BitErrorStats {
  const common = Math.min(sent.length, received.length);
  let bitErrors = 0;
  for (let i = 0; i < common; i++) bitErrors += popcount8(sent[i] ^ received[i]);
  const missingBytes = Math.max(0, sent.length - received.length);
  const extraBytes = Math.max(0, received.length - sent.length);
  const bitsSent = sent.length * 8;
  return {
    bitsSent,
    bitErrors,
    missingBytes,
    extraBytes,
    ber: bitsSent === 0 ? 0 : (bitErrors + 8 * missingBytes) / bitsSent,
  };
}
