/**
 * One AudioContext shared by playback and capture.
 *
 * Browsers (Safari on iOS in particular) only let audio start from a user
 * gesture, so `unlockAudio()` must be called synchronously inside a click
 * handler, before any `await`.
 *
 * iOS also suspends ("suspended") or interrupts ("interrupted", Safari) the
 * context when the screen locks, the app goes to the background or a call
 * comes in; while that lasts nothing is played or captured. Listeners
 * registered with `onAudioStateChange` hear about it.
 */
let context: AudioContext | null = null;
const stateListeners = new Set<() => void>();

export function unlockAudio(): AudioContext {
  if (!context) {
    context = new AudioContext();
    context.addEventListener('statechange', () => {
      for (const listener of stateListeners) listener();
    });
  }
  if (context.state !== 'running') void context.resume();
  return context;
}

export function audioContext(): AudioContext | null {
  return context;
}

/** "running", "suspended", "interrupted" (Safari) or "closed"; null before the first unlock. */
export function audioState(): string | null {
  return context ? (context.state as string) : null;
}

export function onAudioStateChange(listener: () => void): void {
  stateListeners.add(listener);
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
