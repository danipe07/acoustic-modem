/**
 * Bit error statistics between what was sent and what was received.
 *
 * Bytes can be lost (a start bit went unnoticed) or invented (noise looked
 * like a start bit). Comparing position by position would then mark every
 * following byte as wrong, so the two sequences are first ALIGNED with the
 * edit distance (Levenshtein): the cheapest way of turning one into the other
 * using substitutions (a byte with bit errors), deletions (a lost byte) and
 * insertions (an invented byte).
 */
export interface BitErrorStats {
  /** Data bits that were sent (8 per byte). */
  bitsSent: number;
  /** Bytes received and aligned with a sent byte. */
  matchedBytes: number;
  /** Wrong bits inside matched bytes (bit-decision errors). */
  bitErrors: number;
  /** Sent bytes with no received counterpart. */
  lostBytes: number;
  /** Received bytes with no sent counterpart. */
  inventedBytes: number;
  /** bitErrors / (8 · matchedBytes): quality of the bit decisions alone. */
  decisionBer: number;
  /**
   * Overall bit error rate: (bitErrors + 8 · lostBytes) / bitsSent. A lost
   * byte counts as 8 wrong bits; invented bytes are reported separately
   * because they are not bits that were sent.
   */
  ber: number;
}

export function popcount8(x: number): number {
  let count = 0;
  for (let v = x & 0xff; v; v &= v - 1) count++;
  return count;
}

export function makeStats(
  bitsSent: number,
  matchedBytes: number,
  bitErrors: number,
  lostBytes: number,
  inventedBytes: number,
): BitErrorStats {
  return {
    bitsSent,
    matchedBytes,
    bitErrors,
    lostBytes,
    inventedBytes,
    decisionBer: matchedBytes === 0 ? NaN : bitErrors / (8 * matchedBytes),
    ber: bitsSent === 0 ? 0 : (bitErrors + 8 * lostBytes) / bitsSent,
  };
}

/** One step of an alignment between sent and received bytes. */
export type AlignmentOp =
  | { op: 'match'; sentIndex: number; receivedIndex: number; bitErrors: number }
  | { op: 'lost'; sentIndex: number }
  | { op: 'invented'; receivedIndex: number };

/**
 * Aligns two byte sequences with the edit distance. Substituting a byte costs
 * 1, losing or inventing one also costs 1, so a byte with bit errors in the
 * right place is matched rather than counted as lost + invented (cost 2).
 * O(n·m) time and memory: fine for messages of a few kilobytes.
 */
export function alignBytes(sent: Uint8Array, received: Uint8Array): AlignmentOp[] {
  const n = sent.length;
  const m = received.length;
  const width = m + 1;
  const cost = new Uint32Array((n + 1) * width);
  for (let i = 0; i <= n; i++) cost[i * width] = i;
  for (let j = 0; j <= m; j++) cost[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const substitute = cost[(i - 1) * width + j - 1] + (sent[i - 1] === received[j - 1] ? 0 : 1);
      const lose = cost[(i - 1) * width + j] + 1;
      const invent = cost[i * width + j - 1] + 1;
      cost[i * width + j] = Math.min(substitute, lose, invent);
    }
  }

  // Walk back from the end, preferring matches on ties.
  const ops: AlignmentOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = cost[i * width + j];
    if (i > 0 && j > 0) {
      const diff = sent[i - 1] === received[j - 1] ? 0 : 1;
      if (here === cost[(i - 1) * width + j - 1] + diff) {
        ops.push({
          op: 'match',
          sentIndex: i - 1,
          receivedIndex: j - 1,
          bitErrors: popcount8(sent[i - 1] ^ received[j - 1]),
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && here === cost[(i - 1) * width + j] + 1) {
      ops.push({ op: 'lost', sentIndex: i - 1 });
      i--;
    } else {
      ops.push({ op: 'invented', receivedIndex: j - 1 });
      j--;
    }
  }
  return ops.reverse();
}

/** Bit error statistics after aligning the received bytes with the sent ones. */
export function compareBytes(sent: Uint8Array, received: Uint8Array): BitErrorStats {
  let matched = 0;
  let bitErrors = 0;
  let lost = 0;
  let invented = 0;
  for (const step of alignBytes(sent, received)) {
    if (step.op === 'match') {
      matched++;
      bitErrors += step.bitErrors;
    } else if (step.op === 'lost') {
      lost++;
    } else {
      invented++;
    }
  }
  return makeStats(sent.length * 8, matched, bitErrors, lost, invented);
}
