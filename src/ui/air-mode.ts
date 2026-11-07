import { AirReceiver, MIC_CONSTRAINTS, type MicReport } from '../audio/air-receiver.ts';
import { setAudioSessionType, unlockAudio } from '../audio/context.ts';
import { AudioPlayer } from '../audio/player.ts';
import type { RxMessage } from '../audio/protocol.ts';
import { utf8Encode } from '../core/codec/utf8.ts';
import { dbToPower, powerToDb } from '../core/math/db.ts';
import { fskConfig } from '../core/modem/fsk/config.ts';
import { encodeText, TRANSMISSION_DEFAULTS } from '../core/modem/fsk/text-link.ts';
import { compareBytes } from '../core/stats.ts';
import { select } from './controls.ts';
import { h, setChildren } from './dom.ts';
import { num, onLangChange, t } from './i18n/index.ts';
import { decodeForDisplay } from './receiver-panel.ts';

const BAUD_RATES = [50, 100, 200];
/** Louder than in simulation: phone speakers are weak. A single tone never clips. */
const AIR_AMPLITUDE = 0.8;
const HISTORY = 5;

type LevelMessage = Extract<RxMessage, { type: 'level' }>;

interface Reception {
  startSample: number;
  endSample?: number;
  bytes: number[];
  framingErrors: number;
  confidences: number[];
  sampleRate: number;
  baudRate: number;
}

export interface AirMode {
  render(): HTMLElement[];
}

export function createAirMode(requestRender: () => void): AirMode {
  const player = new AudioPlayer();
  const receiver = new AirReceiver(onReceiverMessage);

  const state = {
    text: t('air.testMessage'),
    textIsDefault: true,
    expected: t('air.testMessage'),
    expectedIsDefault: true,
    baudRate: 50,
    sending: false,
    listening: false,
    starting: false,
    mic: null as MicReport | null,
    error: null as string | null,
    notice: null as string | null,
    level: null as LevelMessage | null,
    current: null as Reception | null,
    history: [] as Reception[],
  };

  // Elements updated in place (10 times per second) without re-rendering.
  let meterFill: HTMLElement | null = null;
  let meterPeak: HTMLElement | null = null;
  let levelText: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let liveText: HTMLElement | null = null;

  onLangChange(() => {
    if (state.textIsDefault) state.text = t('air.testMessage');
    if (state.expectedIsDefault) state.expected = t('air.testMessage');
  });

  // ------------------------------------------------------------- receiver

  function onReceiverMessage(message: RxMessage): void {
    if (message.type === 'level') {
      state.level = message;
      updateLevel();
      return;
    }
    if (message.type !== 'events') return;
    let structural = false;
    for (const e of message.events) {
      if (e.type === 'carrier') {
        state.current = {
          startSample: e.sample,
          bytes: [],
          framingErrors: 0,
          confidences: [],
          sampleRate: state.mic?.contextSampleRate ?? 48_000,
          baudRate: state.baudRate,
        };
      } else if (e.type === 'byte' && state.current) {
        state.current.bytes.push(e.value);
        state.current.confidences.push(e.confidence);
        if (e.framingError) state.current.framingErrors++;
      } else if (e.type === 'end' && state.current) {
        state.current.endSample = e.sample;
        state.history = [state.current, ...state.history].slice(0, HISTORY);
        state.current = null;
        structural = true;
      }
    }
    if (structural) requestRender();
    else updateLive();
  }

  function snrEstimate(level: LevelMessage): number {
    // Signal level includes the noise underneath it: S = (S+N) − N.
    const s = dbToPower(level.signalDb) - dbToPower(level.noiseDb);
    return s > 0 ? powerToDb(s) - level.noiseDb : -Infinity;
  }

  function updateLevel(): void {
    const level = state.level;
    if (!level) return;
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
    if (meterFill) meterFill.style.width = pct(level.rmsDb);
    if (meterPeak) meterPeak.style.left = pct(level.peakDb);
    if (levelText) {
      const snr = snrEstimate(level);
      levelText.textContent = t('air.levels', {
        peak: num(level.peakDb, 0),
        noise: num(level.noiseDb, 0),
        signal: Number.isNaN(level.signalDb) ? '—' : num(level.signalDb, 0),
        snr: Number.isFinite(snr) ? num(snr, 0) : '—',
      });
    }
  }

  function statusLabel(): string {
    if (!state.listening) return t('air.status.idle');
    if (state.current) return t('air.status.receiving');
    return state.history.length > 0 ? t('air.status.ended') : t('air.status.waiting');
  }

  function updateLive(): void {
    if (statusText) statusText.textContent = statusLabel();
    if (liveText) {
      const shown = state.current ?? state.history[0];
      setChildren(
        liveText,
        shown ? decodeForDisplay(shown.bytes) : '',
        state.current && h('span', { class: 'cursor' }, '▌'),
      );
    }
  }

  async function toggleListening(): Promise<void> {
    if (state.listening) {
      receiver.stop();
      state.listening = false;
      state.current = null;
      requestRender();
      return;
    }
    unlockAudio(); // inside the click handler, before any await
    state.starting = true;
    state.error = null;
    requestRender();
    try {
      state.mic = await receiver.start(state.baudRate);
      state.listening = true;
    } catch (error) {
      state.error = window.isSecureContext
        ? t('air.micError', { error: String(error) })
        : t('air.httpsNeeded');
    } finally {
      state.starting = false;
      requestRender();
    }
  }

  // ---------------------------------------------------------- transmitter

  function transmit(): void {
    if (state.sending) {
      player.stop();
      return;
    }
    const ctx = unlockAudio();
    if (!state.listening) setAudioSessionType('playback');
    const config = fskConfig(ctx.sampleRate, {
      baudRate: state.baudRate,
      amplitude: AIR_AMPLITUDE,
    });
    const samples = encodeText(state.text, config);
    state.sending = true;
    player.play(
      samples,
      ctx.sampleRate,
      () => {
        state.sending = false;
        requestRender();
      },
      { normalize: false },
    );
    requestRender();
  }

  // ---------------------------------------------------------- diagnostics

  function receptionSummary(r: Reception) {
    const stats = state.expected
      ? compareBytes(utf8Encode(state.expected), Uint8Array.from(r.bytes))
      : null;
    const conf = r.confidences;
    return {
      startSample: r.startSample,
      endSample: r.endSample ?? null,
      durationSeconds:
        r.endSample !== undefined ? (r.endSample - r.startSample) / r.sampleRate : null,
      baudRate: r.baudRate,
      bytesReceived: r.bytes.length,
      framingErrors: r.framingErrors,
      meanConfidence: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null,
      minConfidence: conf.length ? Math.min(...conf) : null,
      text: decodeForDisplay(r.bytes),
      hex: r.bytes
        .slice(0, 256)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' '),
      vsExpected: stats,
    };
  }

  async function copyDiagnostics(): Promise<void> {
    const ctx = unlockAudio();
    const report = {
      app: 'acoustic-modem',
      phase: 1,
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      audioContext: {
        sampleRate: ctx.sampleRate,
        baseLatency: ctx.baseLatency,
        state: ctx.state,
      },
      micRequested: MIC_CONSTRAINTS,
      mic: state.mic,
      baudRate: state.baudRate,
      lastLevel: state.level,
      expectedText: state.expected,
      receptions: [...(state.current ? [state.current] : []), ...state.history].map(
        receptionSummary,
      ),
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    state.notice = t('air.copied');
    requestRender();
  }

  async function downloadWav(): Promise<void> {
    const { bytes } = await receiver.exportWav();
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const link = h('a', {
      href: url,
      download: `acoustic-modem-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`,
    });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ---------------------------------------------------------------- views

  function speedSelect(): HTMLElement {
    const el = select({
      label: t('tx.baud'),
      help: t('air.speedHint'),
      value: state.baudRate,
      options: BAUD_RATES.map((b) => ({ value: b, label: `${b} ${t('tx.baudUnit')}` })),
      onChange: (b) => {
        state.baudRate = b;
        requestRender();
      },
    });
    // The receiver is configured when it starts: lock the speed while listening.
    if (state.listening) el.querySelector('select')?.setAttribute('disabled', '');
    return el;
  }

  function transmitterCard(): HTMLElement {
    const textarea = h('textarea', { rows: 3, maxlength: 400, 'aria-label': t('tx.message') });
    textarea.value = state.text;
    const info = h('p', { class: 'muted' });
    const updateInfo = () => {
      const bytes = utf8Encode(state.text).length;
      const { leadInMs, tailMs } = TRANSMISSION_DEFAULTS;
      const seconds = (leadInMs + tailMs) / 1000 + (bytes * 10) / state.baudRate;
      info.textContent = t('tx.bytes', { bytes, seconds: num(seconds) });
    };
    updateInfo();
    textarea.addEventListener('input', () => {
      state.text = textarea.value;
      state.textIsDefault = false;
      updateInfo();
    });
    return h(
      'section',
      { class: 'card' },
      h('h2', {}, t('air.txTitle')),
      h(
        'label',
        { class: 'control' },
        h('span', { class: 'control-head' }, t('tx.message')),
        textarea,
      ),
      info,
      speedSelect(),
      h('p', { class: 'muted small' }, t('air.txTip')),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'primary',
            disabled: !state.sending && state.text.length === 0,
            onclick: transmit,
          },
          state.sending ? t('tx.stop') : t('air.send'),
        ),
        h(
          'button',
          {
            onclick: () => {
              state.text = t('air.testMessage');
              state.textIsDefault = true;
              requestRender();
            },
          },
          t('air.useTest'),
        ),
      ),
    );
  }

  function receptionStats(r: Reception): HTMLElement {
    const s = receptionSummary(r);
    const rows: [string, string][] = [
      [t('air.bytesReceived'), String(s.bytesReceived)],
      [t('air.framingErrors'), String(s.framingErrors)],
      [
        t('air.confidence'),
        s.meanConfidence === null
          ? '—'
          : `${num(s.meanConfidence, 2)} / ${num(s.minConfidence ?? 0, 2)}`,
      ],
      [t('air.duration'), s.durationSeconds === null ? '—' : `${num(s.durationSeconds, 2)} s`],
    ];
    if (s.vsExpected) {
      const v = s.vsExpected;
      rows.push(
        [t('stats.bitErrors'), String(v.bitErrors)],
        [t('stats.lostStartBit'), String(v.lostBytes)],
        [t('stats.invented'), String(v.inventedBytes)],
        [t('stats.ber'), v.ber === 0 ? '0' : num(v.ber, 4)],
      );
    }
    return h(
      'dl',
      { class: 'stats' },
      ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
    );
  }

  function micSettings(): HTMLElement | null {
    const mic = state.mic;
    if (!mic) return null;
    const flag = (key: 'echoCancellation' | 'noiseSuppression' | 'autoGainControl') => {
      const value = mic.applied[key];
      if (value === undefined) return h('span', { class: 'muted' }, t('air.micUnknown'));
      return value
        ? h('span', { class: 'bad' }, t('air.micIgnored'))
        : h('span', { class: 'ok-text' }, t('air.micOk'));
    };
    const rows: [string, Node | string][] = [
      ['echoCancellation', flag('echoCancellation')],
      ['noiseSuppression', flag('noiseSuppression')],
      ['autoGainControl', flag('autoGainControl')],
      [t('air.sampleRate'), `${mic.applied.sampleRate ?? mic.contextSampleRate} Hz`],
      [t('air.latency'), `${num(mic.baseLatency * 1000, 1)} ms`],
      [t('air.device'), mic.label || '—'],
    ];
    return h(
      'details',
      { class: 'mic-settings', open: true },
      h('summary', {}, t('air.micSettings')),
      h('dl', { class: 'stats' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    );
  }

  function receiverCard(): HTMLElement {
    meterFill = h('div', { class: 'meter-fill' });
    meterPeak = h('div', { class: 'meter-peak' });
    levelText = h('p', { class: 'muted small levels' });
    statusText = h('p', { class: 'status' }, statusLabel());
    liveText = h('div', { class: 'rx-text' });

    const expected = h('input', { type: 'text', 'aria-label': t('air.expected') });
    expected.value = state.expected;
    expected.addEventListener('change', () => {
      state.expected = expected.value;
      state.expectedIsDefault = false;
      requestRender();
    });

    const last = state.history[0];
    const card = h(
      'section',
      { class: 'card' },
      h('h2', {}, t('air.rxTitle')),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'primary',
            disabled: state.starting,
            onclick: () => void toggleListening(),
          },
          state.listening ? t('air.stopListening') : t('air.listen'),
        ),
      ),
      state.error && h('p', { class: 'bad' }, state.error),
      statusText,
      state.listening &&
        h(
          'div',
          { class: 'meter', role: 'meter', 'aria-label': t('air.level') },
          meterFill,
          meterPeak,
        ),
      state.listening && levelText,
      liveText,
      h(
        'label',
        { class: 'control' },
        h('span', { class: 'control-head' }, t('air.expected')),
        expected,
      ),
      last && h('h3', {}, t('air.lastRx')),
      last && receptionStats(last),
      micSettings(),
      h(
        'div',
        { class: 'actions wrap' },
        h('button', { onclick: () => void copyDiagnostics() }, t('air.copyDiagnostics')),
        state.mic && h('button', { onclick: () => void downloadWav() }, t('air.downloadWav')),
      ),
      state.notice && h('p', { class: 'muted small' }, state.notice),
    );
    updateLive();
    updateLevel();
    return card;
  }

  return {
    render: () => [transmitterCard(), receiverCard()],
  };
}
