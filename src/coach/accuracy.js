// Precisión por jugada y por partida con la fórmula de Lichess (diseño §4.1).
// Port fiel de lila `modules/analyse/src/main/AccuracyPercent.scala` y de
// `scalalib.Maths` (harmonicMean, weightedMean, standardDeviation poblacional).
// Funciones puras: reciben `Score` (perspectiva de blancas, ver uci.js) o Win% ya calculados.
import { CP_CEILING, winPercent } from '../engine/uci.js';

/** @typedef {import('../engine/uci.js').Score} Score */

const A = 103.1668100711649;
const K = 0.04354415386753951;
const B = -3.166924740191411;
/** Bonificación de Lichess por la incertidumbre del análisis (se suma antes de acotar). */
export const UNCERTAINTY_BONUS = 1;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Precisión (0–100) de una jugada a partir del Win% del jugador que movió antes y después.
 * Si no pierde nada, 100. Si no: `103.1668 · e^(−0.04354 · pérdida) − 3.1669 + 1`, acotada a [0, 100].
 * @param {number} winBefore  Win% del jugador antes de mover
 * @param {number} winAfter   Win% del mismo jugador después
 * @returns {number}
 */
export function moveAccuracy(winBefore, winAfter) {
  if (winAfter >= winBefore) return 100;
  const raw = A * Math.exp(-K * (winBefore - winAfter)) + B;
  return clamp(raw + UNCERTAINTY_BONUS, 0, 100);
}

/**
 * Win% de BLANCAS tal como lo usa Lichess para la precisión: un mate cuenta como
 * ±1000 cp (≈ 97,5 / 2,5), no como 100 / 0 (a diferencia de `winPercent` para clasificar).
 * @param {Score|null|undefined} score
 * @returns {number|null}  null si no hay evaluación
 */
export function accuracyWinPercent(score) {
  if (!score) return null;
  if (score.type === 'mate') {
    return winPercent({ type: 'cp', value: score.winner === 'w' ? CP_CEILING : -CP_CEILING });
  }
  return winPercent(score);
}

/**
 * Precisión de una jugada clasificada (salida de classifyMove), con el Win% de Lichess.
 * @param {{color:'w'|'b', evalBefore:Score, evalAfter:Score}} move
 * @returns {number}
 */
export function classifiedMoveAccuracy({ color, evalBefore, evalAfter }) {
  const before = accuracyWinPercent(evalBefore);
  const after = accuracyWinPercent(evalAfter);
  return color === 'w' ? moveAccuracy(before, after) : moveAccuracy(100 - before, 100 - after);
}

// ---------- Estadística (scalalib.Maths) ----------

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** Desviación típica poblacional. */
function standardDeviation(xs) {
  const m = mean(xs);
  if (m === null) return null;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** Media armónica; cada valor se toma como mínimo 1 (evita dividir por 0). */
function harmonicMean(xs) {
  if (!xs.length) return null;
  return xs.length / xs.reduce((s, v) => s + 1 / Math.max(1, v), 0);
}

/** @param {[number, number][]} pairs  [valor, peso] */
function weightedMean(pairs) {
  if (!pairs.length) return null;
  let sum = 0;
  let weights = 0;
  for (const [v, w] of pairs) {
    sum += v * w;
    weights += w;
  }
  return weights !== 0 ? sum / weights : null;
}

// ---------- Precisión de la partida ----------

/**
 * Precisión de la partida por color (lila `AccuracyPercent.gameAccuracy`): media de la
 * media ponderada por volatilidad y la media armónica de las precisiones por jugada.
 *
 * - Ventana deslizante de `floor((n − 1) / 10)` posiciones, acotada a [2, 8].
 * - Peso de cada jugada = desviación típica del Win% de su ventana, acotada a [0,5; 12].
 * - Una jugada sin evaluación antes o después no cuenta (ni su ventana).
 *
 * @param {(Score|null)[]} scores  evaluación (perspectiva de blancas) de CADA posición en
 *   orden, empezando por la anterior a la primera jugada; n posiciones = n − 1 jugadas
 * @param {'w'|'b'} startColor  lado que mueve en la primera posición
 * @returns {{w: number|null, b: number|null}}  null si ese color no tiene jugadas evaluadas
 */
export function gameAccuracy(scores, startColor) {
  const wins = scores.map(accuracyWinPercent);
  const n = wins.length;
  const windowSize = clamp(Math.floor((n - 1) / 10), 2, 8);

  /** @type {(number|null)[][]} */
  const windows = [];
  const head = wins.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize, n) - 2; i++) windows.push(head);
  // Igual que `List.sliding` de Scala: una lista más corta que la ventana da una sola ventana.
  if (n > 0 && n <= windowSize) windows.push(wins);
  else if (n > windowSize) for (let i = 0; i + windowSize <= n; i++) windows.push(wins.slice(i, i + windowSize));

  const weights = windows.map((w) =>
    w.every((x) => x !== null) ? clamp(standardDeviation(w), 0.5, 12) : null,
  );

  /** @type {{w: [number, number][], b: [number, number][]}} */
  const byColor = { w: [], b: [] };
  const other = startColor === 'w' ? 'b' : 'w';
  for (let i = 0; i + 1 < n && i < weights.length; i++) {
    const prev = wins[i];
    const next = wins[i + 1];
    const weight = weights[i];
    if (prev === null || next === null || weight === null) continue;
    const color = i % 2 === 0 ? startColor : other;
    const accuracy = color === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    byColor[color].push([accuracy, weight]);
  }

  const colorAccuracy = (pairs) => {
    const weighted = weightedMean(pairs);
    const harmonic = harmonicMean(pairs.map(([a]) => a));
    return weighted === null || harmonic === null ? null : (weighted + harmonic) / 2;
  };
  return { w: colorAccuracy(byColor.w), b: colorAccuracy(byColor.b) };
}

/**
 * Precisión de la partida del jugador a partir de SUS jugadas clasificadas, en orden y
 * consecutivas (cada una seguida de la respuesta del rival, sin huecos: tras Retroceder
 * se pasa la línea que quedó en la partida). La secuencia de posiciones se reconstruye como
 * [antes₁, después₁, antes₂, después₂, …]: entre `después_k` y `antes_k+1` está la jugada
 * del rival, que entra en la volatilidad pero no en el resultado.
 *
 * @param {{color:'w'|'b', evalBefore:Score, evalAfter:Score}[]} moves
 * @returns {number|null}
 */
export function playerGameAccuracy(moves) {
  if (!moves?.length) return null;
  const color = moves[0].color;
  const scores = moves.flatMap((m) => [m.evalBefore, m.evalAfter]);
  return gameAccuracy(scores, color)[color];
}
