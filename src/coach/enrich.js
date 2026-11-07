// Hechos del coach sobre la salida de `classifyMove` (diseño §4.2).
// Funciones puras: sin React ni acceso al worker; reciben análisis ya terminados.
// La etiqueta (`label`) de classifyMove no se modifica: aquí solo se añaden banderas.
import { THRESHOLDS } from '../engine/classify.js';
import { winPercentFor } from '../engine/uci.js';

/**
 * @typedef {import('../engine/uci.js').Score} Score
 * @typedef {{multipv:number, score:Score, pv:string[]}} AnalysisLine
 * @typedef {{lines: AnalysisLine[], bestMove?: string|null}} Analysis
 * @typedef {ReturnType<typeof import('../engine/classify.js').classifyMove>} ClassifiedMove
 * @typedef {'ganando'|'ventaja clara'|'ligera ventaja'|'igualdad'|'ligera desventaja'
 *   |'desventaja clara'|'perdiendo'} EvalLabel
 * @typedef {{to: string, capture: string|null}} RivalMoveRef  basta con `to` y `capture`
 *   (mismo formato que `lastRivalMove` del contrato, §4.3)
 * @typedef {{
 *   greatMove: boolean,
 *   playedRank: 1|2|3|null,
 *   stillWinning: boolean,
 *   mateAllowed: boolean,
 *   mateMissed: boolean,
 *   evalLabelBefore: EvalLabel,
 *   evalLabelAfter: EvalLabel,
 * }} CoachFacts
 */

/** Pérdida mínima (pp de Win%) de la 2.ª línea respecto de la 1.ª para que la mejor sea "gran jugada". */
export const GREAT_MOVE_GAP = 10;
/** Win% (del jugador) a partir del cual se considera que sigue ganando. */
export const STILL_WINNING = 90;
/** Rango máximo de `playedRank` (MultiPV 3 en la posición previa). */
export const MAX_PLAYED_RANK = 3;
/** Margen (pp) sobre el umbral inferior de Mistake/Blunder que pide confirmar a más profundidad. */
export const CONFIRM_MARGIN = 3;
/** Profundidad de la confirmación de §4.2. */
export const CONFIRM_DEPTH = 18;

/**
 * Cortes de las etiquetas de evaluación (Win% del jugador, cota inferior incluida).
 * ≥ 90 ganando; 70–90 ventaja clara; 57–70 ligera ventaja; 43–57 igualdad;
 * 30–43 ligera desventaja; 10–30 desventaja clara; < 10 perdiendo.
 */
export const EVAL_LABEL_CUTS = Object.freeze([
  [90, 'ganando'],
  [70, 'ventaja clara'],
  [57, 'ligera ventaja'],
  [43, 'igualdad'],
  [30, 'ligera desventaja'],
  [10, 'desventaja clara'],
]);

/**
 * Etiqueta verbal de un Win% (0–100) ya expresado en la perspectiva del jugador.
 * @param {number} win
 * @returns {EvalLabel}
 */
export function evalLabel(win) {
  for (const [cut, label] of EVAL_LABEL_CUTS) {
    if (win >= cut) return label;
  }
  return 'perdiendo';
}

const opponent = (color) => (color === 'w' ? 'b' : 'w');

/** true si `score` es mate a favor de `color` (incluye la posición ya mateada). */
export function isMateFor(score, color) {
  return score?.type === 'mate' && score.winner === color;
}

function sortedLines(analysis) {
  return [...(analysis?.lines ?? [])].sort((a, b) => a.multipv - b.multipv);
}

/**
 * Posición (1–3) de la jugada entre las líneas del MultiPV previo, o null.
 * @param {Analysis|null|undefined} before
 * @param {string} moveUci
 * @returns {1|2|3|null}
 */
export function playedRank(before, moveUci) {
  const idx = sortedLines(before).findIndex((l) => l.pv?.[0] === moveUci);
  if (idx < 0 || idx >= MAX_PLAYED_RANK) return null;
  return /** @type {1|2|3} */ (idx + 1);
}

/**
 * "Gran jugada" (§4.2): es la mejor del motor, la 2.ª línea del MultiPV previo pierde
 * ≥ GREAT_MOVE_GAP puntos de Win% respecto de la 1.ª y no es una recaptura en la casilla
 * de la última captura del rival. Sin 2.ª línea (MultiPV 1 o jugada única) → false.
 *
 * @param {Pick<ClassifiedMove, 'isBest'|'color'|'moveUci'>} classification
 * @param {Analysis|null|undefined} before  análisis MultiPV de la posición previa
 * @param {RivalMoveRef|null} [lastRivalMove]
 * @returns {boolean}
 */
export function isGreatMove(classification, before, lastRivalMove = null) {
  const { isBest, color, moveUci } = classification;
  if (!isBest) return false;
  const [first, second] = sortedLines(before);
  if (!first?.score || !second?.score) return false;
  const gap = winPercentFor(first.score, color) - winPercentFor(second.score, color);
  if (gap < GREAT_MOVE_GAP) return false;
  // La pieza del rival sigue en la casilla de su captura: mover ahí siempre es recapturar.
  const isRecapture = Boolean(lastRivalMove?.capture) && moveUci?.slice(2, 4) === lastRivalMove.to;
  return !isRecapture;
}

/**
 * Hechos del coach sobre una jugada clasificada (§4.2).
 *
 * @param {ClassifiedMove} classification  salida de classifyMove
 * @param {object} [context]
 * @param {Analysis|null} [context.before]  análisis de `fenBefore` con MultiPV (idealmente 3)
 * @param {RivalMoveRef|null} [context.lastRivalMove]  última jugada del rival (para descartar recapturas)
 * @returns {CoachFacts}
 */
export function coachFacts(classification, { before = null, lastRivalMove = null } = {}) {
  const { color, evalBefore, evalAfter, winBefore, winAfter, moveUci } = classification;
  const rival = opponent(color);
  return {
    greatMove: isGreatMove(classification, before, lastRivalMove),
    playedRank: playedRank(before, moveUci),
    stillWinning: winBefore >= STILL_WINNING && winAfter >= STILL_WINNING,
    mateAllowed: isMateFor(evalAfter, rival) && !isMateFor(evalBefore, rival),
    mateMissed: isMateFor(evalBefore, color) && !isMateFor(evalAfter, color),
    evalLabelBefore: evalLabel(winBefore),
    evalLabelAfter: evalLabel(winAfter),
  };
}

/**
 * Regla de interrupción (`policy.offerTakeback`, §4.3): `Mistake`/`Blunder` sin
 * `stillWinning`, o un mate concedido.
 * @param {Pick<ClassifiedMove, 'label'>} classification
 * @param {Pick<CoachFacts, 'stillWinning'|'mateAllowed'>} facts
 */
export function shouldOfferTakeback(classification, facts) {
  if (facts.mateAllowed) return true;
  const bad = classification.label === 'Mistake' || classification.label === 'Blunder';
  return bad && !facts.stillWinning;
}

/**
 * true si la jugada debe confirmarse reanalizando `fenAfter` a CONFIRM_DEPTH antes de
 * interrumpir (§4.2): `Mistake`/`Blunder` con `loss` a menos de CONFIRM_MARGIN puntos
 * de su umbral inferior.
 * @param {Pick<ClassifiedMove, 'label'|'loss'>} classification
 */
export function needsDeepConfirmation({ label, loss }) {
  const lower = { Mistake: THRESHOLDS.Inaccuracy, Blunder: THRESHOLDS.Mistake }[label];
  return lower !== undefined && loss < lower + CONFIRM_MARGIN;
}
