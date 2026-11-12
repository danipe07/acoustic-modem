import { describe, expect, it } from 'vitest';
import { type LevelEvent, LinkLevelTracker, snrFromLevels } from './level-tracker.ts';

const FS = 48_000;
const CHUNK = 2048;
const NOISE = 1e-7; // −70 dBFS
const SIGNAL = 1e-3; // −30 dBFS

/** Feeds `seconds` of chunks with constant power; `events` go with the first chunk. */
function feed(
  tracker: LinkLevelTracker,
  power: number,
  seconds: number,
  events: LevelEvent[] = [],
) {
  const chunks = Math.round((seconds * FS) / CHUNK);
  for (let i = 0; i < chunks; i++) tracker.push(power, CHUNK, i === 0 ? events : []);
}

describe('LinkLevelTracker', () => {
  it('knows no levels before hearing enough audio', () => {
    const tracker = new LinkLevelTracker(FS);
    feed(tracker, NOISE, 0.3);
    expect(tracker.noisePower).toBeNaN();
    expect(tracker.signalPower).toBeNaN();
  });

  it('measures the noise floor while nothing is being received', () => {
    const tracker = new LinkLevelTracker(FS);
    feed(tracker, NOISE, 3);
    expect(tracker.noisePower).toBeCloseTo(NOISE, 12);
  });

  it('does not count the start of a transmission as noise', () => {
    // The tone is on the air for ~100 ms before the carrier event arrives.
    const tracker = new LinkLevelTracker(FS);
    feed(tracker, NOISE, 3);
    feed(tracker, SIGNAL, 0.1);
    feed(tracker, SIGNAL, 2, [{ type: 'carrier' }]);
    expect(tracker.receiving).toBe(true);
    expect(tracker.noisePower).toBeCloseTo(NOISE, 12);
    expect(tracker.signalPower).toBeCloseTo(SIGNAL, 9);
  });

  it('does not count the reverberation right after the end as noise', () => {
    const tracker = new LinkLevelTracker(FS);
    feed(tracker, NOISE, 3);
    feed(tracker, SIGNAL, 2, [{ type: 'carrier' }]);
    feed(tracker, SIGNAL / 10, 0.4, [{ type: 'end' }]); // decaying tail
    feed(tracker, NOISE, 3);
    expect(tracker.receiving).toBe(false);
    expect(tracker.noisePower).toBeCloseTo(NOISE, 12);
    // The signal level of the last transmission stays available.
    expect(tracker.signalPower).toBeCloseTo(SIGNAL, 9);
  });

  it('follows a noise floor that changes between transmissions', () => {
    const tracker = new LinkLevelTracker(FS);
    feed(tracker, NOISE, 3);
    feed(tracker, 100 * NOISE, 5);
    expect(10 * Math.log10(tracker.noisePower / (100 * NOISE))).toBeCloseTo(0, 1);
  });

  it('starts a fresh signal measurement for every transmission', () => {
    const tracker = new LinkLevelTracker(FS);
    feed(tracker, NOISE, 3);
    feed(tracker, SIGNAL, 1, [{ type: 'carrier' }]);
    feed(tracker, NOISE, 3, [{ type: 'end' }]);
    feed(tracker, SIGNAL / 100, 1, [{ type: 'carrier' }]);
    expect(tracker.signalPower).toBeCloseTo(SIGNAL / 100, 9);
  });
});

describe('snrFromLevels', () => {
  it('subtracts the noise contained in the signal measurement', () => {
    expect(snrFromLevels(-30, -70)).toBeCloseTo(40, 3);
    // S + N = 2N means S = N: 0 dB, not 3 dB.
    expect(snrFromLevels(-66.99, -70)).toBeCloseTo(0, 1);
  });

  it('is NaN when the signal is not above the noise or a level is unknown', () => {
    expect(snrFromLevels(-70, -70)).toBeNaN();
    expect(snrFromLevels(NaN, -70)).toBeNaN();
    expect(snrFromLevels(-30, NaN)).toBeNaN();
  });
});
