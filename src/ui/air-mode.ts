import { AirReceiver, MIC_CONSTRAINTS, type MicReport } from '../audio/air-receiver.ts';
import { setAudioSessionType, unlockAudio } from '../audio/context.ts';
import { snrFromLevels } from '../audio/level-tracker.ts';
import {
  appliedChannelCount,
  MIC_FLAGS,
  type MicFlag,
  micFlagStatus,
} from '../audio/mic-status.ts';
import { AudioPlayer } from '../audio/player.ts';
import type { RxMessage } from '../audio/protocol.ts';
import { utf8Encode } from '../core/codec/utf8.ts';
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
  /** Listening session: sample numbers restart at 0 every time listening starts. */
  session: number;
  startSample: number;
  /** Wall-clock time of the carrier (ISO 8601): names the recording file. */
  receivedAt: string;
  /** Closed without an end: listening stopped, or another carrier arrived first. */
  interrupted?: boolean;
  endSample?: number;
  /** Levels measured by the receiver worker, dBFS (NaN if unknown). */
  signalDb: number;
  noiseDb: number;
  /** This reception's own audio; arrives shortly after it ends. */
  recording?: { bytes: Uint8Array; seconds: number; firstSample: number };
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
    session: 0,
  };

  // Elements updated in place (10 times per second) without re-rendering.
  let meterFill: HTMLElement | null = null;
  let meterPeak: HTMLElement | null = null;
  let levelText: HTMLElement | null = null;
  let statusText: HTMLElement | null = null;
  let liveText: HTMLElement | null = null;
  let snrValue: HTMLElement | null = null;
  let snrDetail: HTMLElement | null = null;
  let confidenceValue: HTMLElement | null = null;
  let confidenceDetail: HTMLElement | null = null;

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
    if (message.type === 'recording') {
      const owner = [state.current, ...state.history].find(
        (r) => r?.session === message.session && r.startSample === message.carrierSample,
      );
      if (owner) {
        owner.recording = {
          bytes: message.bytes,
          seconds: message.seconds,
          firstSample: message.firstSample,
        };
        requestRender();
      }
      return;
    }
    if (message.type !== 'events') return;
    let structural = false;
    for (const e of message.events) {
      if (e.type === 'carrier') {
        if (state.current) {
          // Defensive: the receiver never starts a transmission inside another,
          // but if it did, keep the open one instead of silently replacing it.
          state.history = [{ ...state.current, interrupted: true }, ...state.history].slice(
            0,
            HISTORY,
          );
          structural = true;
        }
        state.current = {
          session: state.session,
          startSample: e.sample,
          receivedAt: new Date().toISOString(),
          signalDb: NaN,
          noiseDb: NaN,
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
        // Final levels of this reception, before it stops being the current one.
        state.current.signalDb = message.signalDb;
        state.current.noiseDb = message.noiseDb;
        state.history = [state.current, ...state.history].slice(0, HISTORY);
        state.current = null;
        structural = true;
      }
    }
    if (state.current) {
      state.current.signalDb = message.signalDb;
      state.current.noiseDb = message.noiseDb;
    }
    if (structural) requestRender();
    else updateLive();
  }

  const dbText = (db: number, digits = 0) => (Number.isFinite(db) ? num(db, digits) : '—');
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  function updateLevel(): void {
    const level = state.level;
    if (!level) return;
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
    if (meterFill) meterFill.style.width = pct(level.rmsDb);
    if (meterPeak) meterPeak.style.left = pct(level.peakDb);
    if (levelText) {
      levelText.textContent = t('air.levels', {
        peak: dbText(level.peakDb),
        noise: dbText(level.noiseDb),
      });
    }
    // Ten times per second while receiving; between receptions the SNR shown
    // is the one of the last reception.
    if (state.current) {
      state.current.signalDb = level.signalDb;
      state.current.noiseDb = level.noiseDb;
      updateMetrics();
    }
  }

  /** Live SNR and confidence of the reception in progress (or of the last one). */
  function updateMetrics(): void {
    const shown = state.current ?? state.history[0];
    const signalDb = shown?.signalDb ?? NaN;
    const noiseDb = shown?.noiseDb ?? NaN;
    const snr = snrFromLevels(signalDb, noiseDb);
    if (snrValue) snrValue.textContent = Number.isFinite(snr) ? `${num(snr, 0)} dB` : '—';
    if (snrDetail) {
      snrDetail.textContent = t('air.snrDetail', {
        signal: dbText(signalDb),
        noise: dbText(noiseDb),
      });
    }
    const conf = shown?.confidences ?? [];
    if (confidenceValue) {
      confidenceValue.textContent = conf.length ? num(mean(conf), 2) : '—';
    }
    if (confidenceDetail) {
      confidenceDetail.textContent = t('air.confidenceDetail', {
        last: conf.length ? num(conf[conf.length - 1], 2) : '—',
        min: conf.length ? num(Math.min(...conf), 2) : '—',
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
    updateMetrics();
  }

  async function toggleListening(): Promise<void> {
    if (state.listening) {
      // The worker answers with the recording of the unfinished reception.
      receiver.stop();
      state.listening = false;
      if (state.current) {
        state.history = [{ ...state.current, interrupted: true }, ...state.history].slice(
          0,
          HISTORY,
        );
      }
      state.current = null;
      requestRender();
      return;
    }
    unlockAudio(); // inside the click handler, before any await
    state.starting = true;
    state.error = null;
    requestRender();
    try {
      state.session++;
      state.mic = await receiver.start(state.baudRate, state.session);
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
    const snr = snrFromLevels(r.signalDb, r.noiseDb);
    // JSON has no NaN: unknown levels are reported as null.
    const known = (value: number) => (Number.isFinite(value) ? value : null);
    return {
      session: r.session,
      receivedAt: r.receivedAt,
      interrupted: r.interrupted ?? false,
      // The file name the recording gets when downloaded, to pair WAV and JSON.
      recording: r.recording
        ? {
            file: recordingFileName(r),
            seconds: r.recording.seconds,
            firstSample: r.recording.firstSample,
          }
        : null,
      signalDb: known(r.signalDb),
      noiseDb: known(r.noiseDb),
      snrDb: known(snr),
      startSample: r.startSample,
      endSample: r.endSample ?? null,
      durationSeconds:
        r.endSample !== undefined ? (r.endSample - r.startSample) / r.sampleRate : null,
      baudRate: r.baudRate,
      bytesReceived: r.bytes.length,
      framingErrors: r.framingErrors,
      meanConfidence: conf.length ? mean(conf) : null,
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

  const fileStamp = (isoDate: string) => isoDate.replace(/[:.]/g, '-');

  /** Named after the moment the carrier arrived, not the moment of the download. */
  const recordingFileName = (r: Reception) => `acoustic-modem-rx-${fileStamp(r.receivedAt)}.wav`;

  function saveWav(bytes: Uint8Array, name: string): void {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** The last minute of audio, whatever it contains (e.g. no carrier was detected). */
  async function downloadWav(): Promise<void> {
    const { bytes } = await receiver.exportWav();
    saveWav(bytes, `acoustic-modem-last-minute-${fileStamp(new Date().toISOString())}.wav`);
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
      [t('air.snrEstimate'), s.snrDb === null ? '—' : `${num(s.snrDb, 1)} dB`],
      [t('air.signalNoise'), `${dbText(r.signalDb, 1)} / ${dbText(r.noiseDb, 1)} dBFS`],
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

  /** Every reception kept in memory, newest first, each with its own recording. */
  function receptionList(): HTMLElement | null {
    if (state.history.length === 0) return null;
    const item = (r: Reception) => {
      const s = receptionSummary(r);
      const parts = [
        new Date(r.receivedAt).toLocaleTimeString(),
        t('air.rxBytes', { bytes: s.bytesReceived }),
        s.snrDb !== null && `SNR ≈ ${num(s.snrDb, 0)} dB`,
        s.meanConfidence !== null &&
          t('air.rxConfidence', {
            mean: num(s.meanConfidence, 2),
            min: num(s.minConfidence ?? 0, 2),
          }),
        s.vsExpected && `BER ${s.vsExpected.ber === 0 ? '0' : num(s.vsExpected.ber, 4)}`,
        r.interrupted && t('air.rxInterrupted'),
      ];
      const recording = r.recording;
      return h(
        'li',
        { class: 'rx-item' },
        h('p', { class: 'rx-item-head' }, parts.filter(Boolean).join(' · ')),
        h('p', { class: 'rx-item-text' }, decodeForDisplay(r.bytes) || '—'),
        h(
          'button',
          {
            class: 'small',
            disabled: !recording,
            onclick: () => recording && saveWav(recording.bytes, recordingFileName(r)),
          },
          recording
            ? t('air.downloadRx', { seconds: num(recording.seconds, 1) })
            : t('air.recordingPending'),
        ),
      );
    };
    return h(
      'div',
      { class: 'rx-history' },
      h('h3', {}, t('air.history')),
      h('p', { class: 'muted small' }, t('air.historyHelp', { count: HISTORY })),
      h('ol', { class: 'rx-list' }, ...state.history.map(item)),
    );
  }

  function metric(label: string, value: HTMLElement, detail: HTMLElement): HTMLElement {
    return h(
      'div',
      { class: 'metric' },
      h('span', { class: 'metric-label' }, label),
      value,
      detail,
    );
  }

  function micSettings(): HTMLElement | null {
    const mic = state.mic;
    if (!mic) return null;
    const applied = mic.applied as Record<string, unknown>;
    const flag = (key: MicFlag) => {
      const status = micFlagStatus(applied, key);
      if (status === 'unreported') return h('span', { class: 'muted' }, t('air.micUnknown'));
      return status === 'on'
        ? h('span', { class: 'bad' }, t('air.micIgnored'))
        : h('span', { class: 'ok-text' }, t('air.micOk'));
    };
    const channels = appliedChannelCount(applied);
    const rows: [string, Node | string][] = [
      ...MIC_FLAGS.map((key): [string, Node] => [key, flag(key)]),
      [
        t('air.channels'),
        t('air.channelsValue', {
          requested: MIC_CONSTRAINTS.channelCount,
          applied: channels ?? t('air.micUnknown'),
        }),
      ],
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
    snrValue = h('span', { class: 'metric-value' });
    snrDetail = h('span', { class: 'metric-detail' });
    confidenceValue = h('span', { class: 'metric-value' });
    confidenceDetail = h('span', { class: 'metric-detail' });

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
      (state.listening || state.history.length > 0) &&
        h(
          'div',
          { class: 'metrics', 'aria-live': 'off' },
          metric(t('air.snrLive'), snrValue, snrDetail),
          metric(t('air.confidenceLive'), confidenceValue, confidenceDetail),
        ),
      liveText,
      h(
        'label',
        { class: 'control' },
        h('span', { class: 'control-head' }, t('air.expected')),
        expected,
      ),
      last && h('h3', {}, t('air.lastRx')),
      last && receptionStats(last),
      receptionList(),
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
