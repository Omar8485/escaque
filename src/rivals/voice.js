// Cuándo y qué dice el rival (lógica pura, sin React; la usa useRivalVoice.js).
//
// Reglas (docs/HANDOFF.md, "v1.1 — personalidades de los rivales"):
// - Fin de partida (gana, pierde, tablas) y saludo inicial: siempre; ignoran el cooldown.
// - El resto respeta un cooldown: ≥ COOLDOWN.minMs desde la última frase y, además,
//   ≥ COOLDOWN.minPlies jugadas o ≥ COOLDOWN.maxMs.
// - Probabilidad por evento (PROBABILITIES): errores graves siempre (el "casi" lo ponen el
//   cooldown y el coach), errores a veces, buenas jugadas de vez en cuando.
// - Si llegan varios eventos a la vez, solo se considera el de mayor prioridad (PRIORITY).
// - Ninguna frase se repite en la misma partida (si se agotan las de un evento, calla).
// - No compite con el coach: un comentario sobre TU jugada espera mientras el coach la analiza
//   o te detiene; si eliges Retroceder (o deshaces), la jugada desaparece y el rival no la comenta.
import { getPersonality, RIVAL_EVENTS } from './personalities.js';

/** Prioridad cuando coinciden eventos (mayor gana). */
export const PRIORITY = Object.freeze({
  rival_wins: 100,
  rival_loses: 100,
  draw: 100,
  player_blunder: 80,
  rival_good_move: 60,
  player_mistake: 50,
  game_start: 40,
  player_good_move: 20,
});

/** Probabilidad de hablar ante cada evento (si el cooldown lo permite). */
export const PROBABILITIES = Object.freeze({
  game_start: 1,
  rival_wins: 1,
  rival_loses: 1,
  draw: 1,
  player_blunder: 1,
  player_mistake: 0.5,
  rival_good_move: 0.35,
  player_good_move: 0.1,
});
/** Probabilidad de elogio cuando el coach marca tu jugada como "gran jugada". */
export const GREAT_MOVE_PROBABILITY = 0.6;

/** Cooldown entre frases. */
export const COOLDOWN = Object.freeze({ minMs: 4000, minPlies: 3, maxMs: 15000 });

/** Eventos que ignoran el cooldown. */
export const UNTHROTTLED = Object.freeze(new Set(['game_start', 'rival_wins', 'rival_loses', 'draw']));

/** Ventana para juntar eventos simultáneos antes de decidir (ms). */
export const COALESCE_MS = 350;

/** Win% mínimo del rival tras su jugada para presumir de ella. */
export const RIVAL_GOOD_MOVE_WIN = 65;
/** Win% mínimo si la jugada es táctica (captura, jaque). */
export const RIVAL_TACTIC_WIN = 55;

/**
 * @typedef {import('./personalities.js').RivalEvent} RivalEvent
 * @typedef {{ type: RivalEvent, move?: string|null, great?: boolean }} VoiceEvent
 * @typedef {{ id:number, event:RivalEvent, index:number, move:string|null, text:string, level:number, ply:number, at:number }} Speech
 *   `text` va en español; `index` y `move` permiten mostrarla en otro idioma (speechText).
 * @typedef {{ lastAt:number, lastPly:number, used: Record<string, number[]>, count:number }} VoiceState
 */

/**
 * Generador pseudoaleatorio con semilla (mulberry32), para tests reproducibles.
 * @param {number} seed
 * @returns {() => number} números en [0, 1)
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @returns {VoiceState} */
export function initialVoiceState() {
  return { lastAt: -Infinity, lastPly: -Infinity, used: {}, count: 0 };
}

/**
 * Evento que dispara tu jugada según su clasificación (Best…Blunder de classify.js).
 * @param {string} label
 * @returns {RivalEvent|null}
 */
export function playerMoveEvent(label) {
  if (label === 'Blunder') return 'player_blunder';
  if (label === 'Mistake') return 'player_mistake';
  if (label === 'Best' || label === 'Excellent') return 'player_good_move';
  return null;
}

/**
 * ¿La jugada del rival merece que presuma? Mejor/Excelente y con ventaja clara para él
 * (o una captura/jaque con ventaja). Recibe la salida de classifyMove para SU jugada.
 * @param {{label:string, winAfter:number, moveSan?:string|null}|null|undefined} c
 */
export function isRivalGoodMove(c) {
  if (!c || (c.label !== 'Best' && c.label !== 'Excellent')) return false;
  if (typeof c.winAfter !== 'number') return false;
  if (c.winAfter >= RIVAL_GOOD_MOVE_WIN) return true;
  return /[x+#]/.test(c.moveSan ?? '') && c.winAfter >= RIVAL_TACTIC_WIN;
}

/**
 * Evento de fin de partida desde el punto de vista del rival.
 * @param {{winner:'w'|'b'|null}|null} result
 * @param {'w'|'b'} playerColor
 * @returns {RivalEvent|null}
 */
export function endEvent(result, playerColor) {
  if (!result) return null;
  if (!result.winner) return 'draw';
  return result.winner === playerColor ? 'rival_loses' : 'rival_wins';
}

/**
 * ¿Ya pasó el cooldown desde la última frase?
 * @param {VoiceState} state
 * @param {{now:number, ply:number}} at
 * @param {{minMs:number, minPlies:number, maxMs:number}} [cooldown]
 */
export function cooldownOver(state, { now, ply }, cooldown = COOLDOWN) {
  const elapsed = now - state.lastAt;
  if (elapsed < cooldown.minMs) return false;
  return ply - state.lastPly >= cooldown.minPlies || elapsed >= cooldown.maxMs;
}

/**
 * Sustituye las variables (`{move}`). Devuelve null si falta alguna.
 * @param {string} text
 * @param {{move?:string|null}} vars
 */
export function fillTemplate(text, vars = {}) {
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name];
    if (v === undefined || v === null || v === '') {
      missing = true;
      return '';
    }
    return String(v);
  });
  return missing ? null : out;
}

/**
 * Elige al azar una frase aún no usada en la partida.
 * @param {readonly string[]} lines
 * @param {number[]} used  índices ya dichos
 * @param {{move?:string|null}} vars
 * @param {() => number} rng
 * @returns {{index:number, text:string}|null}
 */
export function choosePhrase(lines, used, vars, rng) {
  const options = [];
  lines.forEach((line, index) => {
    if (used.includes(index)) return;
    const text = fillTemplate(line, vars);
    if (text !== null) options.push({ index, text });
  });
  if (!options.length) return null;
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

/**
 * Evento de mayor prioridad (a igualdad, el primero que llegó).
 * @param {VoiceEvent[]} events
 * @returns {VoiceEvent|null}
 */
export function topEvent(events) {
  let best = null;
  for (const e of events) {
    if (!RIVAL_EVENTS.includes(e.type)) continue;
    if (!best || PRIORITY[e.type] > PRIORITY[best.type]) best = e;
  }
  return best;
}

/**
 * Decide si el rival habla ante un grupo de eventos simultáneos.
 * @param {VoiceState} state
 * @param {VoiceEvent[]} events
 * @param {{ level:number, now:number, ply:number, rng:() => number,
 *   probabilities?:Record<string, number>, cooldown?:typeof COOLDOWN }} ctx
 * @returns {{ state: VoiceState, speech: Speech|null }}
 */
export function decide(state, events, { level, now, ply, rng, probabilities = PROBABILITIES, cooldown = COOLDOWN }) {
  const event = topEvent(events);
  if (!event) return { state, speech: null };
  const type = event.type;
  if (!UNTHROTTLED.has(type) && !cooldownOver(state, { now, ply }, cooldown)) return { state, speech: null };
  const p = type === 'player_good_move' && event.great ? GREAT_MOVE_PROBABILITY : probabilities[type] ?? 0;
  if (p < 1 && !(rng() < p)) return { state, speech: null };
  const used = state.used[type] ?? [];
  const phrase = choosePhrase(getPersonality(level).lines[type] ?? [], used, { move: event.move }, rng);
  if (!phrase) return { state, speech: null };
  const count = state.count + 1;
  return {
    state: { lastAt: now, lastPly: ply, used: { ...state.used, [type]: [...used, phrase.index] }, count },
    speech: { id: count, event: type, index: phrase.index, move: event.move ?? null, text: phrase.text, level, ply, at: now },
  };
}

/**
 * Regla con el coach para un comentario pendiente sobre TU jugada.
 *  - 'drop': la jugada ya no está en el tablero (Retroceder, deshacer, navegar atrás) o la
 *    reemplazó otra jugada tuya.
 *  - 'wait': aún no hay clasificación o el coach la está analizando / te tiene detenido.
 *  - 'release': ya puede hablar (el coach no detuvo la partida o elegiste Seguir).
 * @param {{key:string, ply:number}|null} pending
 * @param {{ plies:number, lastPlayerKey:string|null, classified:{key:string}|null, coachHolding:boolean }} ctx
 * @returns {'none'|'drop'|'wait'|'release'}
 */
export function gatePlayerMove(pending, { plies, lastPlayerKey, classified, coachHolding }) {
  if (!pending) return 'none';
  if (plies < pending.ply || lastPlayerKey !== pending.key) return 'drop';
  if (!classified || classified.key !== pending.key) return 'wait';
  if (coachHolding) return 'wait';
  return 'release';
}

/**
 * Controlador con estado de la voz del rival durante una sesión (varias partidas).
 * Los métodos encolan eventos; `flush()` decide y devuelve la frase (o null).
 * @param {{ rng?:() => number, now?:() => number, probabilities?:Record<string, number>, cooldown?:typeof COOLDOWN }} [opts]
 */
export function createVoiceController({ rng = Math.random, now = () => Date.now(), probabilities = PROBABILITIES, cooldown = COOLDOWN } = {}) {
  let state = initialVoiceState();
  /** @type {VoiceEvent[]} */
  let queue = [];
  let level = 1;
  let playerColor = /** @type {'w'|'b'} */ ('w');
  let gameId = null;
  let plies = 0;
  let lastKey = null;
  /** @type {{key:string, ply:number}|null} */
  let pending = null;
  /** Jugadas tuyas ya comentadas o descartadas por probabilidad (`key@ply`): no se repiten al navegar. */
  let handled = new Set();
  let endedWith = null;

  return {
    /** Nueva partida: olvida frases usadas, cooldown y pendientes; encola el saludo. */
    startGame({ gameId: id, level: lvl, playerColor: color }) {
      if (id === gameId) return false;
      gameId = id;
      level = lvl;
      playerColor = color;
      state = initialVoiceState();
      queue = [{ type: 'game_start' }];
      pending = null;
      handled = new Set();
      plies = 0;
      lastKey = null;
      endedWith = null;
      return true;
    },

    /**
     * Observa el tablero y la clasificación de tu última jugada.
     * @param {{ history: {color:'w'|'b', before:string, lan:string}[], classified: {key:string, label:string, moveSan?:string|null, great?:boolean}|null, coachHolding:boolean }} p
     * @returns {boolean} true si encoló algún evento
     */
    observe({ history, classified, coachHolding }) {
      if (gameId === null) return false;
      const prevPlies = plies;
      plies = history.length;
      const last = history.at(-1);
      lastKey = last ? `${last.before}|${last.lan}` : null;
      const lastPlayerIdx = history.findLastIndex((m) => m.color === playerColor);
      const lastPlayer = lastPlayerIdx >= 0 ? history[lastPlayerIdx] : null;
      const lastPlayerKey = lastPlayer ? `${lastPlayer.before}|${lastPlayer.lan}` : null;
      if (plies < prevPlies) endedWith = null; // deshacer tras el final reabre la partida
      // Jugada nueva tuya (aunque el rival ya haya respondido): pendiente hasta conocer su clasificación.
      if (lastPlayerIdx >= prevPlies && !handled.has(`${lastPlayerKey}@${lastPlayerIdx + 1}`)) {
        pending = { key: lastPlayerKey, ply: lastPlayerIdx + 1 };
      }
      const gate = gatePlayerMove(pending, { plies, lastPlayerKey, classified, coachHolding });
      if (gate === 'drop') pending = null;
      if (gate !== 'release') return false;
      handled.add(`${pending.key}@${pending.ply}`);
      pending = null;
      const type = playerMoveEvent(classified.label);
      if (!type) return false;
      queue.push({ type, move: classified.moveSan ?? null, great: Boolean(classified.great) });
      return true;
    },

    /**
     * Jugada del rival clasificada (salida de classifyMove). Solo cuenta si sigue siendo la
     * última jugada del tablero.
     * @returns {boolean} true si encoló el evento
     */
    notifyRivalMove(c) {
      if (gameId === null || !c || c.color === playerColor) return false;
      if (`${c.fenBefore}|${c.moveUci}` !== lastKey) return false;
      if (!isRivalGoodMove(c)) return false;
      queue.push({ type: 'rival_good_move', move: c.moveSan ?? null });
      return true;
    },

    /** Fin de partida (una vez por final; deshacer y volver a terminar cuenta como otro final). */
    end(result) {
      if (gameId === null || !result || endedWith === result) return false;
      const type = endEvent(result, playerColor);
      if (!type) return false;
      endedWith = result;
      pending = null;
      queue.push({ type });
      return true;
    },

    /** Decide sobre lo encolado. @returns {Speech|null} */
    flush() {
      if (!queue.length) return null;
      const events = queue;
      queue = [];
      const res = decide(state, events, { level, now: now(), ply: plies, rng, probabilities, cooldown });
      state = res.state;
      return res.speech;
    },

    /** Solo para tests/depuración. */
    snapshot() {
      return { state, queue: [...queue], pending, plies, lastKey, level, gameId };
    },
  };
}

/**
 * Texto de una frase en el idioma de la interfaz. La voz elige por índice y las frases inglesas
 * tienen `{move}` en los mismos índices, así que cambiar de idioma con el globo abierto muestra
 * la misma frase traducida. Si algo no cuadra, se queda el texto original.
 * @param {Speech} speech
 * @param {string} [lang]
 */
export function speechText(speech, lang = 'es') {
  if (typeof speech.index !== 'number') return speech.text;
  try {
    const line = getPersonality(speech.level, lang).lines[speech.event]?.[speech.index];
    return (line && fillTemplate(line, { move: speech.move })) ?? speech.text;
  } catch {
    return speech.text;
  }
}

/** Cuánto se muestra una frase (ms): más tiempo para frases largas. */
export function displayMs(text) {
  return Math.min(8000, Math.max(4000, 3000 + text.length * 50));
}
