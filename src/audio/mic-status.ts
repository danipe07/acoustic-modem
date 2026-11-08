/**
 * Interpreting `MediaStreamTrack.getSettings()` for the processing we asked the
 * browser to switch off. Browsers differ: Safari on iOS, for instance, reports
 * only `echoCancellation` and `volume`, and says nothing about noise
 * suppression or automatic gain control. Saying nothing is not the same as
 * "off", so it gets its own status.
 */
export type MicFlag = 'echoCancellation' | 'noiseSuppression' | 'autoGainControl';
export type MicFlagStatus = 'off' | 'on' | 'unreported';

export const MIC_FLAGS: readonly MicFlag[] = [
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
];

export function micFlagStatus(
  applied: Readonly<Record<string, unknown>>,
  flag: MicFlag,
): MicFlagStatus {
  const value = applied[flag];
  if (value === false) return 'off';
  if (value === true) return 'on';
  return 'unreported'; // missing, or not a boolean
}

/** Number of channels the browser delivers, if it says (we request 1). */
export function appliedChannelCount(applied: Readonly<Record<string, unknown>>): number | null {
  const value = applied.channelCount;
  return typeof value === 'number' ? value : null;
}
