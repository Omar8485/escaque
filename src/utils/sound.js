// Sonido de pieza de madera sobre el tablero, sintetizado con Web Audio (sin archivos de audio:
// nada que descargar ni licenciar, y no choca con COEP require-corp).
//  - 'move': golpe seco grave (el cuerpo de la pieza) + chasquido corto filtrado (la madera).
//  - 'capture': dos golpes muy seguidos y algo más fuertes.
//  - Campanillas (`playChime`): 'start' al empezar la partida (dos notas ascendentes) y 'end' al
//    terminarla (tres notas descendentes, de cierre). Senos inarmónicos con caída exponencial.
// El navegador solo deja sonar audio tras un gesto del usuario: el contexto se crea/reanuda en
// el primer clic o tecla (unlockAudio), y a partir de ahí suenan también las jugadas del rival.

let ctx = null;

function audioContext() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/** Llamar desde un gesto del usuario (clic/tecla) para habilitar el audio. */
export function unlockAudio() {
  const c = audioContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/**
 * Ejecuta `draw(c)` con el contexto en marcha. Si está suspendido (p. ej. el clic que empieza la
 * partida acaba de pedir `resume()` y aún no se resolvió), espera a que arranque; si el
 * navegador no lo deja arrancar, no suena nada.
 * @param {(c: AudioContext) => void} draw
 */
function whenRunning(draw) {
  const c = audioContext();
  if (!c) return;
  if (c.state === 'running') {
    draw(c);
  } else if (c.state === 'suspended') {
    c.resume()
      .then(() => {
        if (c.state === 'running') draw(c);
      })
      .catch(() => {});
  }
}

/**
 * Dibuja un golpe de madera en `c` (AudioContext u OfflineAudioContext) en el instante `t`.
 * @param {BaseAudioContext} c
 * @param {number} t
 * @param {number} [strength] 0–1
 */
export function knock(c, t, strength = 0.8) {
  const out = c.createGain();
  out.gain.value = strength;
  out.connect(c.destination);

  // Cuerpo: seno grave que cae rápido de tono (el "toc").
  const body = c.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(190, t);
  body.frequency.exponentialRampToValueAtTime(95, t + 0.07);
  const bodyGain = c.createGain();
  bodyGain.gain.setValueAtTime(0.0001, t);
  bodyGain.gain.exponentialRampToValueAtTime(0.9, t + 0.003);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  body.connect(bodyGain).connect(out);
  body.start(t);
  body.stop(t + 0.1);

  // Madera: ráfaga de ruido filtrada en banda (el "clac").
  const length = Math.floor(c.sampleRate * 0.05);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1700;
  band.Q.value = 1.4;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.7, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  noise.connect(band).connect(noiseGain).connect(out);
  noise.start(t);
}

/**
 * Reproduce el sonido de una jugada.
 * @param {'move'|'capture'} kind
 */
export function playMoveSound(kind = 'move') {
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime + 0.005;
  if (kind === 'capture') {
    knock(c, t, 0.85);
    knock(c, t + 0.045, 0.55);
  } else {
    knock(c, t, 0.75);
  }
}

// ---------- Campanillas de inicio y fin de partida ----------

/** Parciales de una campana pequeña: [múltiplo de la fundamental, ganancia relativa, caída relativa]. */
const BELL_PARTIALS = [
  [1, 1, 1],
  [2, 0.45, 0.7],
  [2.76, 0.3, 0.5],
  [5.4, 0.12, 0.3],
];

/**
 * Dibuja una nota de campanilla (suma de senos inarmónicos con ataque corto y caída exponencial).
 * @param {BaseAudioContext} c
 * @param {number} t        instante de inicio
 * @param {number} freq     fundamental en Hz
 * @param {{gain?:number, decay?:number}} [opts]  ganancia (0–1) y duración de la caída (s)
 */
export function bell(c, t, freq, { gain = 0.25, decay = 1.2 } = {}) {
  const out = c.createGain();
  out.gain.value = gain;
  out.connect(c.destination);
  for (const [ratio, level, decayFactor] of BELL_PARTIALS) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, t);
    const g = c.createGain();
    const end = t + decay * decayFactor;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(end + 0.02);
  }
}

/** Notas (Hz) y separación (s) de cada campanilla. */
export const CHIMES = Object.freeze({
  // Inicio: dos notas ascendentes, brillantes y cortas ("din-din").
  start: { notes: [784, 1175], gap: 0.11, gain: 0.22, decay: 1.1 },
  // Fin: tres notas descendentes, más suaves y largas (cierre).
  end: { notes: [1047, 784, 523], gap: 0.2, gain: 0.2, decay: 1.7 },
});

/**
 * Campanilla de inicio o de fin de partida. Quien llama decide si el sonido está activo.
 * @param {'start'|'end'} kind
 */
export function playChime(kind) {
  const chime = CHIMES[kind];
  if (!chime) return;
  whenRunning((c) => {
    const t = c.currentTime + 0.01;
    chime.notes.forEach((freq, i) => bell(c, t + i * chime.gap, freq, { gain: chime.gain, decay: chime.decay }));
  });
}

/** Campanilla al empezar una partida. */
export const playGameStartSound = () => playChime('start');
/** Campanilla (distinta, de cierre) al terminar una partida. */
export const playGameEndSound = () => playChime('end');

const KEY = 'coach-chess:sound';

/** Preferencia guardada (por defecto, con sonido). */
export function readSoundPref() {
  try {
    return globalThis.localStorage?.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeSoundPref(on) {
  try {
    globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Sin almacenamiento: dura la sesión.
  }
}
