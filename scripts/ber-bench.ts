/**
 * BER bench for the FSK modem in simulation.
 *
 * Runs many seeded transmissions per operating point and prints Markdown
 * tables with the error breakdown by cause, next to the theoretical BER of
 * non-coherent binary FSK. Uses TUNING_SEEDS only (never the test seeds).
 *
 *   node scripts/ber-bench.ts [output.md]
 */
import { writeFileSync } from 'node:fs';
import { runFskTrial } from '../src/core/analysis/fsk-trial.ts';
import { TUNING_SEEDS } from '../src/core/analysis/seeds.ts';
import { berNoncoherentBfsk, ebN0Db } from '../src/core/analysis/theory.ts';
import type { ChannelConfig } from '../src/core/channel/channel.ts';
import { createRng } from '../src/core/math/rng.ts';

const SAMPLE_RATE = 48_000;
const PAYLOAD_BYTES = 100;
const payloadRng = createRng(42);
const PAYLOAD = Uint8Array.from({ length: PAYLOAD_BYTES }, () => payloadRng.int(0, 255));

interface Totals {
  bitsSent: number;
  matchedBits: number;
  bitErrors: number;
  lostBytes: number;
  carrierMissed: number; // transmissions with no carrier at all
  lostWithoutCarrier: number;
  lostStartBits: number;
  invented: number;
  stopBitErrors: number;
}

function runPoint(baudRate: number, channel: Omit<ChannelConfig, 'txSampleRate'>): Totals {
  const t: Totals = {
    bitsSent: 0,
    matchedBits: 0,
    bitErrors: 0,
    lostBytes: 0,
    carrierMissed: 0,
    lostWithoutCarrier: 0,
    lostStartBits: 0,
    invented: 0,
    stopBitErrors: 0,
  };
  for (const seed of TUNING_SEEDS) {
    const { report } = runFskTrial({
      payload: PAYLOAD,
      sampleRate: SAMPLE_RATE,
      baudRate,
      seed,
      channel: { leadingSilenceMs: 300, trailingSilenceMs: 300, ...channel },
    });
    t.bitsSent += report.stats.bitsSent;
    t.matchedBits += report.stats.matchedBytes * 8;
    t.bitErrors += report.stats.bitErrors;
    t.lostBytes += report.stats.lostBytes;
    t.carrierMissed += report.carrierDetected ? 0 : 1;
    t.lostWithoutCarrier += report.lostWithoutCarrier;
    t.lostStartBits += report.lostStartBits;
    t.invented += report.inventedBytes;
    t.stopBitErrors += report.stopBitErrors;
  }
  return t;
}

const fmt = (x: number): string =>
  Number.isNaN(x) ? '—' : x === 0 ? '0' : x < 1e-3 ? x.toExponential(1) : x.toPrecision(2);

function row(cells: (string | number)[]): string {
  return `| ${cells.join(' | ')} |`;
}

const out: string[] = [];
const log = (line = '') => {
  out.push(line);
  console.log(line);
};

const trials = TUNING_SEEDS.length;
log('# FSK BER bench (phase 1)');
log();
log(
  `Simulation, fs = ${SAMPLE_RATE} Hz, ${PAYLOAD_BYTES} random bytes × ${trials} seeds per point ` +
    `(${PAYLOAD_BYTES * 8 * trials} data bits). SNR is measured over the full band 0–fs/2; ` +
    'Eb/N0 = SNR + 10·log10(fs / 2Rb) with Rb = baud rate. ' +
    '"Decision BER" counts wrong data bits in bytes received at the right time; ' +
    '"total BER" also counts each lost byte as 8 wrong bits.',
);

const HEADER = row([
  'SNR (dB)',
  'Eb/N0 (dB)',
  'Theory BER',
  'Decision BER',
  'Total BER',
  'No carrier (tx)',
  'Lost, no carrier',
  'Lost, start bit missed',
  'Invented',
  'Stop-bit errors',
  'Bit errors',
]);

for (const baudRate of [50, 100, 200]) {
  log();
  log(`## AWGN, ${baudRate} Bd`);
  log();
  log(HEADER);
  log(row(Array(11).fill('---')));
  for (let snr = -18; snr <= -4; snr++) {
    const t = runPoint(baudRate, { noise: { snrDb: snr } });
    const eb = ebN0Db(snr, SAMPLE_RATE, baudRate);
    log(
      row([
        snr,
        eb.toFixed(1),
        fmt(berNoncoherentBfsk(eb)),
        fmt(t.matchedBits ? t.bitErrors / t.matchedBits : NaN),
        fmt((t.bitErrors + 8 * t.lostBytes) / t.bitsSent),
        `${t.carrierMissed}/${trials}`,
        t.lostWithoutCarrier,
        t.lostStartBits,
        t.invented,
        t.stopBitErrors,
        t.bitErrors,
      ]),
    );
  }
}

log();
log('## Reverberation (RT60 = 0.6 s, SNR = 20 dB)');
log();
log(
  row([
    'Baud',
    'Reverb level (dB)',
    'Decision BER',
    'Total BER',
    'Lost, no carrier',
    'Lost, start bit missed',
    'Invented',
    'Stop-bit errors',
    'Bit errors',
  ]),
);
log(row(Array(9).fill('---')));
for (const baudRate of [50, 100, 200]) {
  for (const wetDb of [-12, -9, -6, -3, 0]) {
    const t = runPoint(baudRate, { noise: { snrDb: 20 }, reverb: { rt60: 0.6, wetDb } });
    log(
      row([
        baudRate,
        wetDb,
        fmt(t.matchedBits ? t.bitErrors / t.matchedBits : NaN),
        fmt((t.bitErrors + 8 * t.lostBytes) / t.bitsSent),
        t.lostWithoutCarrier,
        t.lostStartBits,
        t.invented,
        t.stopBitErrors,
        t.bitErrors,
      ]),
    );
  }
}

const target = process.argv[2];
if (target) writeFileSync(target, out.join('\n') + '\n');
