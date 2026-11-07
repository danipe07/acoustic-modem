import { utf8Decode, utf8Encode } from '../core/codec/utf8.ts';
import type { FskEvent } from '../core/modem/fsk/demodulator.ts';
import type { SimResponse } from '../sim/protocol.ts';
import { h } from './dom.ts';
import { t } from './i18n/index.ts';

type ByteEvent = Extract<FskEvent, { type: 'byte' }>;

const bits8 = (v: number): string => v.toString(2).padStart(8, '0');

/**
 * Corrupted bytes often decode to invisible control characters; show them as
 * Unicode "control pictures" (0x01 → ␁) so the error is visible.
 */
function visible(text: string): string {
  let out = '';
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp === 0x7f) out += '␡';
    else if (cp < 0x20 && cp !== 0x0a) out += String.fromCodePoint(0x2400 + cp);
    else out += char;
  }
  return out;
}
const hex2 = (v: number): string => v.toString(16).padStart(2, '0').toUpperCase();

/** Number of bytes at the end of `bytes` that start a UTF-8 character not yet complete. */
function incompleteTail(bytes: number[]): number {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const b = bytes[bytes.length - back];
    if ((b & 0xc0) === 0x80) continue; // continuation byte: keep looking for the lead byte
    const needed = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return needed > back ? back : 0;
  }
  return 0;
}

/** Text received so far, while the signal is still playing. */
export function renderLive(result: SimResponse, uptoSample: number): HTMLElement {
  const received = result.events
    .filter((e): e is ByteEvent => e.type === 'byte' && e.sample <= uptoSample)
    .map((e) => e.value);
  // Wait for the rest of a multi-byte character (e.g. an emoji) before showing it.
  const complete = received.slice(0, received.length - incompleteTail(received));
  return h(
    'div',
    { class: 'rx-text live' },
    visible(utf8Decode(Uint8Array.from(complete))),
    h('span', { class: 'cursor' }, '▌'),
  );
}

/**
 * Final view: the message character by character, aligned with what was sent,
 * colouring each character by what happened to its bytes.
 */
export function renderFinal(result: SimResponse, text: string): HTMLElement {
  const { report } = result;
  if (!report.carrierDetected) return h('p', { class: 'rx-empty' }, t('rx.noCarrier'));

  // Where to show each invented byte: after the last real byte received before it.
  const inventedAfter = new Map<number, ByteEvent[]>();
  for (const e of report.invented) {
    let after = -1;
    for (const b of report.bytes) {
      if (b.receivedSample !== undefined && b.receivedSample < e.sample) after = b.sentIndex;
    }
    inventedAfter.set(after, [...(inventedAfter.get(after) ?? []), e]);
  }
  const inventedMarks = (index: number) =>
    (inventedAfter.get(index) ?? []).map((e) =>
      h(
        'span',
        { class: 'ch invented', title: t('rx.inventedTooltip', { hex: hex2(e.value) }) },
        '+',
      ),
    );

  const out = h('div', { class: 'rx-text' }, ...inventedMarks(-1));
  let offset = 0;
  for (const char of text) {
    const length = utf8Encode(char).length;
    const outcomes = report.bytes.slice(offset, offset + length);
    const display = char === '\n' ? '↵\n' : char;
    if (outcomes.every((b) => b.status === 'ok')) {
      out.append(h('span', { class: 'ch ok' }, display));
    } else if (outcomes.some((b) => b.status === 'lost')) {
      out.append(
        h('span', { class: 'ch lost', title: t('rx.charTooltipLost', { sent: char }) }, '▯'),
      );
    } else {
      const got = visible(utf8Decode(Uint8Array.from(outcomes.map((b) => b.received ?? 0))));
      out.append(
        h(
          'span',
          { class: 'ch error', title: t('rx.charTooltipError', { sent: char, received: got }) },
          got,
        ),
      );
    }
    offset += length;
    out.append(...inventedMarks(offset - 1));
  }
  return out;
}

export function renderLegend(): HTMLElement {
  return h(
    'div',
    { class: 'legend' },
    h('span', { class: 'ch ok' }, 'a'),
    ` ${t('rx.legend.ok')} `,
    h('span', { class: 'ch error' }, 'a'),
    ` ${t('rx.legend.error')} `,
    h('span', { class: 'ch lost' }, '▯'),
    ` ${t('rx.legend.lost')} `,
    h('span', { class: 'ch invented' }, '+'),
    ` ${t('rx.legend.invented')}`,
  );
}

/** Table of the bytes that arrived with wrong bits, highlighting each flipped bit. */
export function renderErrorTable(result: SimResponse, maxRows = 12): HTMLElement | null {
  const wrong = result.report.bytes.filter((b) => b.status === 'bit-errors');
  if (wrong.length === 0) return null;
  const bitCells = (value: number, reference: number) =>
    h(
      'code',
      {},
      ...[...bits8(value)].map((bit, i) =>
        bit === bits8(reference)[i] ? bit : h('mark', {}, bit),
      ),
    );
  return h(
    'details',
    { class: 'error-table' },
    h('summary', {}, `${t('rx.errorTable')} (${wrong.length})`),
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, t('rx.byte')),
          h('th', {}, t('rx.sentBits')),
          h('th', {}, t('rx.receivedBits')),
          h('th', {}, t('rx.stopBit')),
        ),
      ),
      h(
        'tbody',
        {},
        ...wrong
          .slice(0, maxRows)
          .map((b) =>
            h(
              'tr',
              {},
              h('td', {}, `#${b.sentIndex}`),
              h('td', {}, h('code', {}, bits8(b.sent))),
              h('td', {}, bitCells(b.received ?? 0, b.sent)),
              h('td', {}, b.framingError ? t('rx.stopBad') : t('rx.stopOk')),
            ),
          ),
      ),
    ),
  );
}
