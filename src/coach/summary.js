// Estadísticas de fin de partida (pestaña Entrenar). Funciones puras, sin React ni motor:
// reciben la línea jugada (FEN inicial + SAN), las clasificaciones ya calculadas (las del
// usuario y las del rival, clave "<FEN antes>|<UCI>") y los tiempos del reloj.
//
// Lo usan `useMoveLedger` (qué jugadas clasificar) y `GameSummary.jsx` (la tarjeta).
import { Chess } from 'chess.js';
import { LABELS } from '../engine/classify.js';
import { gameAccuracy } from './accuracy.js';

/** FEN de la posición inicial estándar. */
export const START_FEN = new Chess().fen();

/** @typedef {'w'|'b'} Color */
/** @typedef {ReturnType<typeof import('../engine/classify.js').classifyMove>} Classification */
/**
 * Jugada de la línea, en el formato de chess.js + su número de medio movimiento.
 * @typedef {{ply:number, color:Color, san:string, uci:string, before:string, after:string,
 *   moveNumber:number}} LineMove
 */

/** Clave de una jugada (la misma que usan App y useCoach): "<FEN antes>|<UCI>". */
export const moveKey = (move) => `${move.before}|${move.uci ?? move.lan}`;

/**
 * Reconstruye la línea jugada (jugadas verbosas) desde el FEN inicial y las SAN.
 * Se detiene en la primera jugada ilegal.
 * @param {string} startFen
 * @param {string[]} sans
 * @returns {LineMove[]}
 */
export function lineFromSans(startFen = START_FEN, sans = []) {
  const chess = new Chess(startFen);
  const out = [];
  for (const san of sans) {
    let m;
    try {
      m = chess.move(san);
    } catch {
      break;
    }
    const moveNumber = Number(m.before.split(' ')[5]) || 1;
    out.push({ ply: out.length + 1, color: m.color, san: m.san, uci: m.lan, before: m.before, after: m.after, moveNumber });
  }
  return out;
}

/** Contador vacío por etiqueta. */
export function emptyCounts() {
  return Object.fromEntries(LABELS.map((l) => [l, 0]));
}

/**
 * Número de jugadas (como se cuentan en ajedrez: blancas + negras = 1) de una línea de `plies`
 * medios movimientos que empieza con `startColor`.
 * @param {number} plies
 * @param {Color} startColor
 */
export function fullMoveCount(plies, startColor = 'w') {
  if (plies <= 0) return 0;
  return startColor === 'w' ? Math.ceil(plies / 2) : 1 + Math.floor(plies / 2);
}

/**
 * Evaluaciones (perspectiva de blancas) de cada posición de la línea: n jugadas → n + 1
 * posiciones. La posición i sale de la clasificación de la jugada i (antes) o, si falta, de la
 * jugada i − 1 (después). null donde no hay evaluación.
 * @param {(Classification|null)[]} classes  una por jugada, en orden
 */
export function positionScores(classes) {
  const n = classes.length;
  const scores = [];
  for (let i = 0; i <= n; i++) {
    scores.push(classes[i]?.evalBefore ?? classes[i - 1]?.evalAfter ?? null);
  }
  return scores;
}

/**
 * Resumen de la partida.
 * @param {object} p
 * @param {LineMove[]} p.line          jugadas de la partida (lineFromSans)
 * @param {Record<string, Classification>} p.classifications  por moveKey
 * @param {{w:number, b:number}} [p.timeUsedMs]  tiempo de reloj usado por cada bando
 * @param {number|null} [p.durationMs]  tiempo real de inicio a fin (incluye pausas y avisos)
 * @param {import('./useGameLoop.js').GameResult|null} [p.result]
 * @param {Color} [p.playerColor]
 * @param {Color} [p.startColor]  bando que mueve primero (por defecto, el de la primera jugada)
 */
export function summarizeGame({ line, classifications = {}, timeUsedMs = { w: 0, b: 0 }, durationMs = null, result = null, playerColor = 'w', startColor }) {
  const first = startColor ?? line[0]?.color ?? 'w';
  const counts = { w: emptyCounts(), b: emptyCounts() };
  const movesByColor = { w: 0, b: 0 };
  const classified = { w: 0, b: 0 };
  const classes = line.map((m) => classifications[moveKey(m)] ?? null);

  line.forEach((m, i) => {
    movesByColor[m.color] += 1;
    const c = classes[i];
    if (c && counts[m.color][c.label] !== undefined) {
      counts[m.color][c.label] += 1;
      classified[m.color] += 1;
    }
  });

  const pending = line.length - classified.w - classified.b;
  const complete = pending === 0;
  // Precisión con la fórmula de Lichess (accuracy.js), solo con la partida entera evaluada.
  const accuracy = complete && line.length > 0 ? gameAccuracy(positionScores(classes), first) : { w: null, b: null };

  const used = { w: Math.max(0, timeUsedMs.w ?? 0), b: Math.max(0, timeUsedMs.b ?? 0) };
  return {
    plies: line.length,
    fullMoves: fullMoveCount(line.length, first),
    movesByColor,
    counts,
    classified,
    pending,
    complete,
    accuracy,
    time: { totalMs: used.w + used.b, w: used.w, b: used.b },
    durationMs,
    result,
    playerColor,
    rivalColor: playerColor === 'w' ? 'b' : 'w',
  };
}

/**
 * Duración legible: "4:05" (min:s) o "1:02:03" (h:min:s).
 * @param {number|null|undefined} ms
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
