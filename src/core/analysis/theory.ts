import { dbToPower, powerToDb } from '../math/db.ts';

/**
 * Converts the simulator's full-band SNR into Eb/N0, the figure of merit used
 * to compare modulations independently of sample rate and bit rate.
 *
 *   SNR   = S / σ²            (σ² = noise power over 0 … fs/2)
 *   N0    = 2σ² / fs          (one-sided noise power spectral density)
 *   Eb    = S · Tb = S / Rb   (energy per bit)
 *   Eb/N0 = SNR · fs / (2·Rb)
 *
 * Example: fs = 48 kHz, Rb = 50 bit/s → Eb/N0 = SNR + 26.8 dB. A slow modem
 * collects energy for longer per bit, so the same SNR is worth more.
 */
export function ebN0Db(snrDb: number, sampleRate: number, bitRate: number): number {
  return snrDb + powerToDb(sampleRate / (2 * bitRate));
}

/** Inverse of `ebN0Db`. */
export function snrDbFromEbN0(ebN0: number, sampleRate: number, bitRate: number): number {
  return ebN0 - powerToDb(sampleRate / (2 * bitRate));
}

/**
 * Theoretical bit error probability of binary FSK with orthogonal tones and
 * non-coherent (energy) detection in AWGN, with perfect synchronisation:
 *   Pb = ½ · exp(−Eb / 2N0)
 */
export function berNoncoherentBfsk(ebN0: number): number {
  return 0.5 * Math.exp(-dbToPower(ebN0) / 2);
}
