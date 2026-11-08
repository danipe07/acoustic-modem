/**
 * Replays a recorded WAV through the legacy receiver (commit 32660bc) and the
 * current one, and compares what each of them decoded.
 *
 *   npm run replay <file.wav>
 *   npm run replay -- <file.wav> --baud 50 --expected "¡Hola, mundo! 👋"
 *
 * Only for checking regressions: thresholds must never be tuned on recordings.
 * The WAV is what the microphone delivered, so changes upstream of the
 * demodulator (capture, browser, device, position) cannot show up here.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { utf8Decode, utf8Encode } from '../src/core/codec/utf8.ts';
import { decodeWav } from '../src/core/codec/wav.ts';
import { fskConfig } from '../src/core/modem/fsk/config.ts';
import { FskDemodulator, type FskEvent } from '../src/core/modem/fsk/demodulator.ts';
import { compareBytes } from '../src/core/stats.ts';
import { FskDemodulator as LegacyFskDemodulator } from './legacy/fsk-demodulator-32660bc.ts';

/** Same chunk size as the capture worklet. */
const CHUNK = 2048;

interface Reception {
  carrierSample: number | null;
  bytes: number[];
  confidences: number[];
  framingErrors: number;
  ended: boolean;
}

function decode(
  demod: { push(samples: Float32Array): FskEvent[] },
  samples: Float32Array,
): FskEvent[] {
  const events: FskEvent[] = [];
  for (let i = 0; i < samples.length; i += CHUNK) {
    events.push(...demod.push(samples.subarray(i, i + CHUNK)));
  }
  return events;
}

function groupReceptions(events: readonly FskEvent[]): Reception[] {
  const receptions: Reception[] = [];
  let open: Reception | null = null;
  for (const e of events) {
    if (e.type === 'carrier') {
      open = {
        carrierSample: e.sample,
        bytes: [],
        confidences: [],
        framingErrors: 0,
        ended: false,
      };
      receptions.push(open);
    } else if (e.type === 'byte' && open) {
      open.bytes.push(e.value);
      open.confidences.push(e.confidence);
      if (e.framingError) open.framingErrors++;
    } else if (e.type === 'end' && open) {
      open.ended = true;
      open = null;
    }
  }
  return receptions;
}

const hex = (bytes: Iterable<number>) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

function summarize(r: Reception, expected: Uint8Array, sampleRate: number): string[] {
  const bytes = Uint8Array.from(r.bytes);
  const start = r.carrierSample === null ? '?' : (r.carrierSample / sampleRate).toFixed(3);
  const lines = [
    `  carrier at ${start} s${r.ended ? '' : ' (never ended)'}, ${bytes.length} bytes`,
  ];
  lines.push(`    hex:  ${hex(bytes)}`);
  lines.push(`    text: ${JSON.stringify(utf8Decode(bytes))}`);
  if (r.bytes.length > 0) {
    const mean = r.confidences.reduce((a, c) => a + c, 0) / r.confidences.length;
    lines.push(
      `    confidence mean ${mean.toFixed(2)} / min ${Math.min(...r.confidences).toFixed(2)}` +
        ` · wrong stop bits ${r.framingErrors}`,
    );
  }
  const s = compareBytes(expected, bytes);
  lines.push(
    `    vs expected: ${s.bitErrors} bit errors, ${s.lostBytes} lost, ${s.inventedBytes} invented,` +
      ` BER ${s.ber.toFixed(4)}`,
  );
  return lines;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    baud: { type: 'string', default: '50' },
    expected: { type: 'string', default: '¡Hola, mundo! 👋' },
  },
});

const [file] = positionals;
if (!file) {
  console.error('Usage: npm run replay -- <file.wav> [--baud 50] [--expected "text"]');
  process.exit(1);
}

const { samples, sampleRate } = decodeWav(readFileSync(file));
const config = fskConfig(sampleRate, { baudRate: Number(values.baud) });
const expected = utf8Encode(values.expected);

console.log(`${file}`);
console.log(`${(samples.length / sampleRate).toFixed(2)} s at ${sampleRate} Hz, ${values.baud} Bd`);
console.log(`expected: ${hex(expected)}\n`);

const results = [
  ['legacy (32660bc)', decode(new LegacyFskDemodulator(config), samples)],
  ['current', decode(new FskDemodulator(config), samples)],
] as const;

const best: number[] = [];
for (const [name, events] of results) {
  const receptions = groupReceptions(events);
  console.log(`${name}: ${receptions.length} reception(s)`);
  for (const r of receptions) console.log(summarize(r, expected, sampleRate).join('\n'));
  best.push(
    Math.min(
      Infinity,
      ...receptions.map((r) => compareBytes(expected, Uint8Array.from(r.bytes)).ber),
    ),
  );
  console.log('');
}

const [legacyBer, currentBer] = best;
if (currentBer > legacyBer) console.log(`REGRESSION: best BER ${legacyBer} → ${currentBer}`);
else if (currentBer < legacyBer) console.log(`IMPROVED: best BER ${legacyBer} → ${currentBer}`);
else console.log(`SAME best BER for both receivers: ${currentBer}`);
