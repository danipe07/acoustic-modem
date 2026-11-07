import type { ChannelConfig } from '../core/channel/channel.ts';
import { dbToPower, powerToDb } from '../core/math/db.ts';
import { FSK_DEFAULTS } from '../core/modem/fsk/config.ts';

/** Channel parameters as the user edits them. */
export interface ChannelSettings {
  /** Noise power in dBFS; NOISE_OFF disables it. */
  noiseDb: number;
  attenuationDb: number;
  /** 0 disables the echo. */
  echoDelayMs: number;
  echoGainDb: number;
  /** 0 disables the reverberation. */
  rt60: number;
  reverbDb: number;
  clockPpm: number;
  rxSampleRate: number;
  seed: number;
}

export const TX_SAMPLE_RATE = 48_000;
export const NOISE_OFF = -100;

export type PresetName = 'ideal' | 'quiet' | 'echoey' | 'noisy' | 'devices';

const base: Omit<ChannelSettings, 'seed'> = {
  noiseDb: NOISE_OFF,
  attenuationDb: 0,
  echoDelayMs: 0,
  echoGainDb: -6,
  rt60: 0,
  reverbDb: -12,
  clockPpm: 0,
  rxSampleRate: TX_SAMPLE_RATE,
};

export const PRESETS: Record<PresetName, Omit<ChannelSettings, 'seed'>> = {
  ideal: base,
  quiet: { ...base, noiseDb: -65, attenuationDb: 20, rt60: 0.4, reverbDb: -14, clockPpm: 40 },
  echoey: {
    ...base,
    noiseDb: -65,
    attenuationDb: 24,
    echoDelayMs: 7,
    echoGainDb: -4,
    rt60: 1.0,
    reverbDb: -6,
    clockPpm: 40,
  },
  noisy: { ...base, noiseDb: -32, attenuationDb: 20, rt60: 0.3, reverbDb: -16, clockPpm: 40 },
  devices: {
    ...base,
    noiseDb: -60,
    attenuationDb: 18,
    rt60: 0.4,
    reverbDb: -14,
    clockPpm: 250,
    rxSampleRate: 44_100,
  },
};

/** Converts the UI settings into the simulator's channel configuration. */
export function toChannelConfig(s: ChannelSettings): Omit<ChannelConfig, 'txSampleRate'> {
  return {
    rxSampleRate: s.rxSampleRate,
    clockOffsetPpm: s.clockPpm,
    attenuationDb: s.attenuationDb,
    echoes: s.echoDelayMs > 0 ? [{ delayMs: s.echoDelayMs, gainDb: s.echoGainDb }] : [],
    reverb: s.rt60 > 0 ? { rt60: s.rt60, wetDb: s.reverbDb } : undefined,
    noise: s.noiseDb > NOISE_OFF ? { powerDb: s.noiseDb } : undefined,
    leadingSilenceMs: 300,
    trailingSilenceMs: 400,
  };
}

/**
 * Expected full-band SNR before running anything: transmitted power
 * (a sine of amplitude A has power A²/2), minus attenuation, plus the energy
 * the room adds (echo and reverb tail), minus the noise power.
 */
export function estimateSnrDb(s: ChannelSettings): number {
  if (s.noiseDb <= NOISE_OFF) return Infinity;
  const txPower = FSK_DEFAULTS.amplitude ** 2 / 2;
  let roomGain = 1;
  if (s.echoDelayMs > 0) roomGain += dbToPower(s.echoGainDb);
  if (s.rt60 > 0) roomGain += dbToPower(s.reverbDb);
  return powerToDb(txPower * roomGain) - s.attenuationDb - s.noiseDb;
}
