import { berNoncoherentBfsk } from '../core/analysis/theory.ts';
import type { SimResponse } from '../sim/protocol.ts';
import { h } from './dom.ts';
import { type MessageKey, num, t } from './i18n/index.ts';

function ber(x: number): string {
  if (Number.isNaN(x)) return '—';
  if (x === 0) return '0';
  if (x >= 0.01) return num(x, 3);
  const [mantissa, exponent] = x.toExponential(1).split('e');
  return `${num(Number(mantissa))}·10${superscript(exponent)}`;
}

function superscript(exponent: string): string {
  const map: Record<string, string> = { '-': '⁻', '+': '' };
  for (const [i, s] of [...'⁰¹²³⁴⁵⁶⁷⁸⁹'].entries()) map[String(i)] = s;
  return [...exponent].map((c) => map[c] ?? c).join('');
}

function db(x: number): string {
  return Number.isFinite(x) ? `${num(x)} dB` : '∞';
}

export function renderStats(result: SimResponse | null, baudRate: number): HTMLElement {
  if (!result) return h('p', { class: 'muted' }, t('stats.empty'));
  const { report } = result;
  const s = report.stats;
  const dataBitsOk = s.matchedBytes * 8 - s.bitErrors;
  const rows: [MessageKey, string, string?][] = [
    ['stats.bitsSent', String(s.bitsSent)],
    ['stats.channelBits', String(result.channelBits)],
    ['stats.bitErrors', String(s.bitErrors)],
    ['stats.decisionBer', ber(s.decisionBer)],
    ['stats.lostNoCarrier', String(report.lostWithoutCarrier)],
    ['stats.lostStartBit', String(report.lostStartBits)],
    ['stats.invented', String(report.inventedBytes)],
    ['stats.stopBitErrors', String(report.stopBitErrors)],
    ['stats.ber', ber(s.ber), t('stats.berHelp')],
    ['stats.snr', db(result.snrDb)],
    ['stats.ebn0', db(result.ebN0Db)],
    ['stats.theoryBer', ber(berNoncoherentBfsk(result.ebN0Db))],
    ['stats.nominalRate', `${baudRate} bit/s`],
    ['stats.throughput', `${num(dataBitsOk / result.airtime)} bit/s`],
    ['stats.airtime', `${num(result.airtime, 2)} s`],
    ['stats.corrected', t('stats.correctedSoon')],
  ];
  return h(
    'dl',
    { class: 'stats' },
    ...rows.flatMap(([key, value, help]) => [
      h('dt', { title: help }, t(key)),
      h('dd', { class: key === 'stats.ber' && s.ber > 0 ? 'bad' : undefined }, value),
    ]),
  );
}
