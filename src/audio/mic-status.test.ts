import { describe, expect, it } from 'vitest';
import { appliedChannelCount, MIC_FLAGS, micFlagStatus } from './mic-status.ts';

describe('micFlagStatus', () => {
  it('Safari on iOS: only echoCancellation is reported', () => {
    // What an iPhone returned from getSettings() in the first over-the-air test.
    const ios = { echoCancellation: false, volume: 1 };
    expect(MIC_FLAGS.map((f) => micFlagStatus(ios, f))).toEqual([
      'off',
      'unreported',
      'unreported',
    ]);
  });

  it('distinguishes off, left on and unreported', () => {
    const chrome = { echoCancellation: false, noiseSuppression: true, autoGainControl: false };
    expect(MIC_FLAGS.map((f) => micFlagStatus(chrome, f))).toEqual(['off', 'on', 'off']);
  });

  it('never treats a non-boolean value as "off"', () => {
    expect(micFlagStatus({ noiseSuppression: 'false' }, 'noiseSuppression')).toBe('unreported');
    expect(micFlagStatus({ autoGainControl: 0 }, 'autoGainControl')).toBe('unreported');
  });
});

describe('appliedChannelCount', () => {
  it('reports the delivered channel count when the browser gives it', () => {
    expect(appliedChannelCount({ channelCount: 2 })).toBe(2);
    expect(appliedChannelCount({})).toBeNull();
  });
});
