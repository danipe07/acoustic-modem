import { AudioPlayer } from '../audio/player.ts';
import { ebN0Db } from '../core/analysis/theory.ts';
import { utf8Encode } from '../core/codec/utf8.ts';
import { TRANSMISSION_DEFAULTS } from '../core/modem/fsk/text-link.ts';
import { SimulationClient } from '../sim/client.ts';
import type { SimResponse } from '../sim/protocol.ts';
import {
  type ChannelSettings,
  estimateSnrDb,
  NOISE_OFF,
  PRESETS,
  type PresetName,
  toChannelConfig,
  TX_SAMPLE_RATE,
} from './channel-settings.ts';
import { select, slider } from './controls.ts';
import { h, setChildren } from './dom.ts';
import { getLang, type Lang, num, onLangChange, setLang, t } from './i18n/index.ts';
import { renderErrorTable, renderFinal, renderLegend, renderLive } from './receiver-panel.ts';
import { renderStats } from './stats-panel.ts';

const MAX_BYTES = 400;
const BAUD_RATES = [50, 100, 200];
const REPO_URL = 'https://github.com/danipe07/acoustic-modem';

interface AppState {
  text: string;
  baudRate: number;
  listen: boolean;
  preset: PresetName | 'custom';
  channel: ChannelSettings;
  busy: boolean;
  playing: boolean;
  result: SimResponse | null;
  /** Text and speed of the transmission shown in `result`. */
  resultText: string;
  resultBaud: number;
  revealSample: number;
  error: string | null;
}

export function startApp(root: HTMLElement): void {
  const sim = new SimulationClient();
  const player = new AudioPlayer();
  let rxBody: HTMLElement | null = null;
  let estimateLabel: HTMLElement | null = null;

  const state: AppState = {
    text: t('tx.defaultMessage'),
    baudRate: 50,
    listen: true,
    preset: 'quiet',
    channel: { ...PRESETS.quiet, seed: 1 },
    busy: false,
    playing: false,
    result: null,
    resultText: '',
    resultBaud: 50,
    revealSample: 0,
    error: null,
  };

  // The default message follows the language until the user edits it.
  let textIsDefault = true;
  onLangChange(() => {
    if (textIsDefault) state.text = t('tx.defaultMessage');
    render();
  });

  function estimateText(): string {
    const snr = estimateSnrDb(state.channel);
    if (!Number.isFinite(snr)) return `${t('ch.noise')}: ${t('ch.off')}`;
    const eb = ebN0Db(snr, TX_SAMPLE_RATE, state.baudRate);
    return t('ch.estimate', { snr: num(snr), ebn0: num(eb) });
  }

  function updateChannel(patch: Partial<ChannelSettings>): void {
    state.channel = { ...state.channel, ...patch };
    state.preset = 'custom';
    if (estimateLabel) estimateLabel.textContent = estimateText();
    const presetSelect = root.querySelector<HTMLSelectElement>('#preset select');
    if (presetSelect) presetSelect.value = 'custom';
  }

  function airtimeSeconds(): number {
    const bytes = utf8Encode(state.text).length;
    const { leadInMs, tailMs } = TRANSMISSION_DEFAULTS;
    return (leadInMs + tailMs) / 1000 + (bytes * 10) / state.baudRate;
  }

  async function send(): Promise<void> {
    if (state.busy) return;
    if (state.listen) player.unlock(); // must happen inside the click handler
    state.busy = true;
    state.error = null;
    render();
    try {
      const result = await sim.run({
        text: state.text,
        baudRate: state.baudRate,
        sampleRate: TX_SAMPLE_RATE,
        seed: state.channel.seed,
        channel: toChannelConfig(state.channel),
      });
      state.result = result;
      state.resultText = state.text;
      state.resultBaud = state.baudRate;
      if (state.listen) {
        state.playing = true;
        state.revealSample = 0;
        const startAt = player.play(result.rxAudio, result.rxSampleRate, () => {
          state.playing = false;
          render();
        });
        // A timer rather than requestAnimationFrame: rAF stops in background
        // tabs, while the audio (and the reveal) should keep going.
        const timer = setInterval(() => {
          if (!state.playing || state.result !== result) {
            clearInterval(timer);
            return;
          }
          state.revealSample = Math.max(0, (player.currentTime - startAt) * result.rxSampleRate);
          if (rxBody) setChildren(rxBody, renderLive(result, state.revealSample));
        }, 50);
      }
    } catch (error) {
      state.error = String(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  function stop(): void {
    player.stop();
    state.playing = false;
    render();
  }

  // ---------------------------------------------------------------- panels

  function header(): HTMLElement {
    const langButton = (lang: Lang, label: string) =>
      h(
        'button',
        {
          class: getLang() === lang ? 'lang active' : 'lang',
          'aria-pressed': getLang() === lang ? 'true' : 'false',
          onclick: () => setLang(lang),
        },
        label,
      );
    return h(
      'header',
      { class: 'app-header' },
      h('div', {}, h('h1', {}, t('app.title')), h('p', { class: 'subtitle' }, t('app.subtitle'))),
      h(
        'div',
        { class: 'lang-switch', role: 'group', 'aria-label': t('app.language') },
        langButton('es', 'ES'),
        langButton('en', 'EN'),
      ),
    );
  }

  function modeTabs(): HTMLElement {
    return h(
      'nav',
      { class: 'tabs' },
      h('button', { class: 'tab active', 'aria-current': 'page' }, t('mode.simulation')),
      h(
        'button',
        { class: 'tab', disabled: true, title: t('mode.airSoon') },
        t('mode.air'),
        h('span', { class: 'badge' }, t('mode.airSoon')),
      ),
    );
  }

  function transmitterPanel(): HTMLElement {
    const bytes = utf8Encode(state.text).length;
    const info = h(
      'p',
      { class: bytes > MAX_BYTES ? 'muted bad' : 'muted' },
      bytes > MAX_BYTES
        ? t('tx.tooLong', { max: MAX_BYTES })
        : t('tx.bytes', { bytes, seconds: num(airtimeSeconds()) }),
    );
    const textarea = h('textarea', { rows: 3, maxlength: 2000, 'aria-label': t('tx.message') });
    textarea.value = state.text;
    textarea.addEventListener('input', () => {
      state.text = textarea.value;
      textIsDefault = false;
      const n = utf8Encode(state.text).length;
      info.textContent =
        n > MAX_BYTES
          ? t('tx.tooLong', { max: MAX_BYTES })
          : t('tx.bytes', { bytes: n, seconds: num(airtimeSeconds()) });
      info.className = n > MAX_BYTES ? 'muted bad' : 'muted';
      sendButton.disabled = state.busy || n === 0 || n > MAX_BYTES;
    });

    const listen = h('input', { type: 'checkbox', checked: state.listen });
    listen.addEventListener('change', () => (state.listen = listen.checked));

    const sendButton = h(
      'button',
      {
        class: 'primary',
        disabled: state.busy || bytes === 0 || bytes > MAX_BYTES,
        onclick: () => void send(),
      },
      state.busy ? t('tx.sending') : t('tx.send'),
    );

    return h(
      'section',
      { class: 'card' },
      h('h2', {}, t('tx.title')),
      h(
        'label',
        { class: 'control' },
        h('span', { class: 'control-head' }, t('tx.message')),
        textarea,
      ),
      info,
      select({
        label: t('tx.baud'),
        value: state.baudRate,
        options: BAUD_RATES.map((b) => ({ value: b, label: `${b} ${t('tx.baudUnit')}` })),
        onChange: (b) => {
          state.baudRate = b;
          render();
        },
      }),
      h('label', { class: 'check' }, listen, t('tx.listen')),
      h(
        'div',
        { class: 'actions' },
        sendButton,
        state.playing && h('button', { onclick: stop }, t('tx.stop')),
      ),
      state.error && h('p', { class: 'bad' }, state.error),
    );
  }

  function channelPanel(): HTMLElement {
    const c = state.channel;
    const dbFmt = (v: number) => `${num(v, 0)} dB`;
    estimateLabel = h('p', { class: 'estimate' }, estimateText());
    const presetLabels: Record<PresetName | 'custom', string> = {
      ideal: t('ch.preset.ideal'),
      quiet: t('ch.preset.quiet'),
      echoey: t('ch.preset.echoey'),
      noisy: t('ch.preset.noisy'),
      devices: t('ch.preset.devices'),
      custom: t('ch.preset.custom'),
    };
    const preset = select<PresetName | 'custom'>({
      label: t('ch.preset'),
      value: state.preset,
      options: (Object.keys(presetLabels) as (PresetName | 'custom')[]).map((p) => ({
        value: p,
        label: presetLabels[p],
      })),
      onChange: (p) => {
        if (p === 'custom') return;
        state.preset = p;
        state.channel = { ...PRESETS[p], seed: state.channel.seed };
        render();
      },
    });
    preset.id = 'preset';

    const seedInput = h('input', { type: 'number', min: 0, step: 1, value: c.seed });
    seedInput.addEventListener('change', () => {
      state.channel.seed = Math.max(0, Math.floor(Number(seedInput.value) || 0));
    });
    const seedRow = h(
      'label',
      { class: 'control', title: t('ch.seedHelp') },
      h('span', { class: 'control-head' }, t('ch.seed')),
      h(
        'span',
        { class: 'seed-row' },
        seedInput,
        h(
          'button',
          {
            title: t('ch.randomSeed'),
            'aria-label': t('ch.randomSeed'),
            onclick: (e: Event) => {
              e.preventDefault();
              state.channel.seed = Math.floor(Math.random() * 1e6);
              seedInput.value = String(state.channel.seed);
            },
          },
          '🎲',
        ),
      ),
    );

    return h(
      'section',
      { class: 'card' },
      h('h2', {}, t('ch.title')),
      preset,
      estimateLabel,
      h(
        'div',
        { class: 'controls-grid' },
        slider({
          label: t('ch.noise'),
          help: t('ch.noiseHelp'),
          min: NOISE_OFF,
          max: -10,
          step: 1,
          value: c.noiseDb,
          format: (v) => (v <= NOISE_OFF ? t('ch.off') : `${num(v, 0)} dBFS`),
          onInput: (v) => updateChannel({ noiseDb: v }),
        }),
        slider({
          label: t('ch.attenuation'),
          help: t('ch.attenuationHelp'),
          min: 0,
          max: 60,
          step: 1,
          value: c.attenuationDb,
          format: dbFmt,
          onInput: (v) => updateChannel({ attenuationDb: v }),
        }),
        slider({
          label: t('ch.echoDelay'),
          min: 0,
          max: 100,
          step: 1,
          value: c.echoDelayMs,
          format: (v) => (v === 0 ? t('ch.off') : `${v} ms`),
          onInput: (v) => updateChannel({ echoDelayMs: v }),
        }),
        slider({
          label: t('ch.echoGain'),
          min: -30,
          max: 0,
          step: 1,
          value: c.echoGainDb,
          format: dbFmt,
          onInput: (v) => updateChannel({ echoGainDb: v }),
        }),
        slider({
          label: t('ch.reverbTime'),
          help: t('ch.reverbTimeHelp'),
          min: 0,
          max: 1.5,
          step: 0.05,
          value: c.rt60,
          format: (v) => (v === 0 ? t('ch.off') : `${num(v, 2)} s`),
          onInput: (v) => updateChannel({ rt60: v }),
        }),
        slider({
          label: t('ch.reverbLevel'),
          help: t('ch.reverbLevelHelp'),
          min: -30,
          max: 0,
          step: 1,
          value: c.reverbDb,
          format: dbFmt,
          onInput: (v) => updateChannel({ reverbDb: v }),
        }),
        slider({
          label: t('ch.clock'),
          help: t('ch.clockHelp'),
          min: -2000,
          max: 2000,
          step: 10,
          value: c.clockPpm,
          format: (v) => `${v > 0 ? '+' : ''}${v} ppm`,
          onInput: (v) => updateChannel({ clockPpm: v }),
        }),
        select({
          label: t('ch.rxRate'),
          value: c.rxSampleRate,
          options: [
            { value: TX_SAMPLE_RATE, label: t('ch.rxRateSame') },
            { value: 44_100, label: '44,1 kHz' },
          ],
          onChange: (v) => updateChannel({ rxSampleRate: v }),
        }),
        seedRow,
      ),
    );
  }

  function receiverPanel(): HTMLElement {
    rxBody = h('div', { class: 'rx-body' });
    const r = state.result;
    if (!r) {
      rxBody.append(h('p', { class: 'muted' }, state.busy ? t('rx.listening') : t('rx.waiting')));
    } else if (state.playing) {
      rxBody.append(renderLive(r, state.revealSample));
    } else {
      rxBody.append(renderFinal(r, state.resultText));
    }
    const finished = r && !state.playing;
    return h(
      'section',
      { class: 'card wide' },
      h('h2', {}, t('rx.title')),
      rxBody,
      finished && r.report.carrierDetected && renderLegend(),
      finished && renderErrorTable(r),
    );
  }

  function statsPanel(): HTMLElement {
    const r = state.playing ? null : state.result;
    return h(
      'section',
      { class: 'card' },
      h('h2', {}, t('stats.title')),
      renderStats(r, state.resultBaud),
    );
  }

  function footer(): HTMLElement {
    return h(
      'footer',
      {},
      h('a', { href: REPO_URL }, t('footer.source')),
      ' · ',
      h('a', { href: `${REPO_URL}/blob/main/docs/TEORIA.md` }, t('footer.theory')),
      ' · ',
      t('footer.license'),
    );
  }

  function render(): void {
    document.title = t('app.title');
    setChildren(
      root,
      header(),
      modeTabs(),
      h('p', { class: 'hint' }, t('mode.simulationHint')),
      h(
        'main',
        { class: 'grid' },
        transmitterPanel(),
        channelPanel(),
        receiverPanel(),
        statsPanel(),
      ),
      footer(),
    );
  }

  document.documentElement.lang = getLang();
  render();
}
