/**
 * Leichte Soundeffekte via Web Audio API – keine externen Dateien.
 * Töne werden nur abgespielt, wenn der User Sounds aktiviert hat (localStorage).
 */

const STORAGE_KEY = "wissensdb_sounds_enabled";

export function isSoundsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null || stored === "true"; // Standard: an
  } catch {
    return true;
  }
}

export function setSoundsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    /* ignore */
  }
}

let audioContext: AudioContext | null = null;
let unlockAttempted = false;

function unlockAudio(): void {
  if (unlockAttempted || typeof window === "undefined") return;
  unlockAttempted = true;
  const handler = () => getContext();
  document.addEventListener("click", handler, { once: true });
  document.addEventListener("keydown", handler, { once: true });
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.15,
  ramp = true
): void {
  if (!isSoundsEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    /* Audio nicht verfügbar */
  }
}

/** Erfolg – aufsteigender Dreiklang */
export function playSuccess(): void {
  if (!isSoundsEnabled()) return;
  unlockAudio();
  const ctx = getContext();
  if (!ctx) return;

  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.12, "sine", 0.12), i * 80);
  });
}

/** Fehler – sanft abfallend */
export function playError(): void {
  if (!isSoundsEnabled()) return;
  unlockAudio();
  playTone(200, 0.2, "sine", 0.1);
  setTimeout(() => playTone(160, 0.25, "sine", 0.08), 80);
}

/** Warnung – kurzer mittlerer Ton */
export function playWarning(): void {
  if (!isSoundsEnabled()) return;
  unlockAudio();
  playTone(400, 0.1, "sine", 0.1);
}

/** Klick – sehr kurzer, dezenter Ton */
export function playClick(): void {
  if (!isSoundsEnabled()) return;
  unlockAudio();
  playTone(800, 0.04, "sine", 0.06, false);
}

/** Agent arbeitet – sanfter, dezenter Hinweis */
export function playWorking(): void {
  if (!isSoundsEnabled()) return;
  unlockAudio();
  playTone(520, 0.15, "sine", 0.07);
}
