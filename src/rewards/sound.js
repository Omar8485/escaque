import { bell } from '../utils/sound.js';
let context;
/** A short quiet chime; unavailable or blocked audio never interrupts training. */
export function playAchievementSound(enabled) {
  if (!enabled) return;
  try {
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    context.resume().then(() => bell(context, context.currentTime, 880, { gain: 0.035, decay: 0.3 })).catch(() => {});
  } catch { /* Browser audio can be unavailable until a user gesture. */ }
}
