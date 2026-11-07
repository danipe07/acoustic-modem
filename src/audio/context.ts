/**
 * One AudioContext shared by playback and capture.
 *
 * Browsers (Safari on iOS in particular) only let audio start from a user
 * gesture, so `unlockAudio()` must be called synchronously inside a click
 * handler, before any `await`.
 */
let context: AudioContext | null = null;

export function unlockAudio(): AudioContext {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function audioContext(): AudioContext | null {
  return context;
}

/**
 * Safari's Audio Session API (iOS 16.4+): "play-and-record" while the
 * microphone is open, "playback" otherwise. Without it, iOS may route the
 * sound to the quiet earpiece as soon as the microphone is active.
 * Other browsers do not implement it, and that is fine.
 */
export function setAudioSessionType(type: 'playback' | 'play-and-record' | 'auto'): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = type;
}
