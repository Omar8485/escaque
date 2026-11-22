// Clasificación pura de jugadas a partir de evaluaciones FINALES del motor.
// Sin React ni Worker: recibe los resultados de `analyze()` de la posición
// anterior y posterior a la jugada y devuelve la etiqueta + los datos crudos
// (que luego usará el coach para comentar solo hechos calculados por el motor).
import { Chess } from 'chess.js';
import { sideToMove, winPercentFor } from './uci.js';

/** Etiquetas posibles, de mejor a peor. */
export const LABELS = ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];

/** Umbrales de pérdida de win% (puntos porcentuales) del jugador que movió. */
export const THRESHOLDS = Object.freeze({ Excellent: 2, Good: 5, Inaccuracy: 10, Mistake: 20 });

/** Cantidad de medias jugadas de la variante principal que se devuelven en SAN. */
export const DEFAULT_PV_PLIES = 6;

/** Etiqueta según la pérdida (pp) cuando la jugada no es la mejor del motor. */
export function labelForLoss(loss) {
  if (loss <= THRESHOLDS.Excellent) return 'Excellent';
  if (loss <= THRESHOLDS.Good) return 'Good';
  if (loss <= THRESHOLDS.Inaccuracy) return 'Inaccuracy';
  if (loss <= THRESHOLDS.Mistake) return 'Mistake';
  return 'Blunder';
}

function parseUci(uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

/**
 * Convierte una secuencia de jugadas UCI a SAN desde `fen`.
 * Se detiene en la primera jugada ilegal o mal formada.
 * @param {string} fen
 * @param {string[]} uciMoves
 * @param {number} [maxPlies=Infinity]
 * @returns {string[]}
 */
export function uciLineToSan(fen, uciMoves, maxPlies = Infinity) {
  const chess = new Chess(fen);
  const san = [];
  for (const uci of uciMoves ?? []) {
    if (san.length >= maxPlies) break;
    const move = parseUci(uci);
    if (!move) break;
    try {
      san.push(chess.move(move).san);
    } catch {
      break;
    }
  }
  return san;
}

/** UCI → SAN de una sola jugada (null si es ilegal). */
export function uciToSan(fen, uci) {
  return uciLineToSan(fen, [uci], 1)[0] ?? null;
}

function finalScore(analysis, which) {
  const score = analysis?.lines?.[0]?.score;
  if (!score) throw new Error(`Falta la evaluación final de la posición ${which}`);
  return score;
}

/**
 * Clasifica una jugada comparando la evaluación final antes y después.
 *
 * @param {object} params
 * @param {string} params.fenBefore  FEN de la posición antes de la jugada
 * @param {string} params.moveUci    jugada en UCI (p. ej. "e2e4", "e7e8q")
 * @param {{fen:string, bestMove:string|null, lines:{score:object, pv:string[]}[]}} params.before
 *        resultado final de analyze(fenBefore)
 * @param {{fen:string, lines:{score:object}[]}} params.after  resultado final de analyze(fenAfter)
 * @param {number} [params.pvPlies]
 * @returns {{
 *   label: 'Best'|'Excellent'|'Good'|'Inaccuracy'|'Mistake'|'Blunder',
 *   color: 'w'|'b', moveUci: string, moveSan: string|null,
 *   fenBefore: string, fenAfter: string,
 *   evalBefore: object, evalAfter: object,     // perspectiva de blancas
 *   winBefore: number, winAfter: number,       // win% (0–100) del jugador que movió
 *   loss: number,                              // pp de win% perdidos (≥ 0)
 *   isBest: boolean, bestMoveUci: string|null, bestMoveSan: string|null,
 *   pvSan: string[],                           // variante principal del motor antes de la jugada
 *   depthBefore: number, depthAfter: number,
 * }}
 */
export function classifyMove({ fenBefore, moveUci, before, after, pvPlies = DEFAULT_PV_PLIES }) {
  const color = sideToMove(fenBefore);
  const evalBefore = finalScore(before, 'anterior');
  const evalAfter = finalScore(after, 'posterior');

  const winBefore = winPercentFor(evalBefore, color);
  const winAfter = winPercentFor(evalAfter, color);
  const loss = Math.max(0, winBefore - winAfter);

  const bestMoveUci = before.bestMove ?? before.lines[0].pv?.[0] ?? null;
  const isBest = bestMoveUci !== null && bestMoveUci === moveUci;
  const label = isBest ? 'Best' : labelForLoss(loss);

  return {
    label,
    color,
    moveUci,
    moveSan: uciToSan(fenBefore, moveUci),
    fenBefore,
    fenAfter: after.fen ?? null,
    evalBefore,
    evalAfter,
    winBefore,
    winAfter,
    loss,
    isBest,
    bestMoveUci,
    bestMoveSan: bestMoveUci ? uciToSan(fenBefore, bestMoveUci) : null,
    pvSan: uciLineToSan(fenBefore, before.lines[0].pv, pvPlies),
    depthBefore: before.depth ?? null,
    depthAfter: after.depth ?? null,
  };
}
