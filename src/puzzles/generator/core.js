// Núcleo del generador de puzles: funciones puras (más un "analizador" inyectado) que comparten
// la generación en el navegador (runner.js) y el script de Node (scripts/build-puzzles.mjs).
//
// Criterios (inspirados en el generador de puzles de Lichess):
//  - Se evalúan todas las posiciones de la partida (profundidad `depth`).
//  - Candidato: una jugada TUYA que pierde ≥ `lossMin` pp de probabilidad de ganar, desde una
//    posición que no estaba ya decidida (tu Win% dentro de `winRange`). Tipo "oportunidad" si
//    ibas ≥ `opportunity` % (el rival se había equivocado y no lo castigaste); si no, "error".
//  - Validación a profundidad `deep` con MultiPV 2: la mejor jugada debe dejarte ≥ `solvedMin` %
//    (o dar mate) y ser ÚNICA: la 2.ª opción ≥ `uniqueGap` pp peor (o la 1.ª da mate y la 2.ª no).
//  - Solución: la mejor jugada y, mientras tus siguientes jugadas sigan siendo únicas, hasta
//    `maxSolverMoves` jugadas tuyas con las respuestas del rival intercaladas. Termina en jugada tuya.
//  - La misma idea repetida en la misma partida (misma primera jugada a ≤ `dedupePlies` plies) cuenta una vez.
import { Chess } from 'chess.js';
import { winPercentFor } from '../../engine/uci.js';
import { moveMotif } from '../../coach/tactics.js';
import { gamePhase } from '../../coach/phase.js';

/**
 * Versión del generador. Subirla cuando cambien los criterios o las profundidades: las partidas
 * analizadas con otra versión se vuelven a analizar (y sus puzles se reemplazan).
 */
export const GENERATOR_VERSION = 1;

export const GENERATOR_DEFAULTS = Object.freeze({
  depth: 12,
  deep: 16,
  lossMin: 18,
  winRange: Object.freeze([30, 97]),
  opportunity: 70,
  solvedMin: 60,
  uniqueGap: 15,
  maxSolverMoves: 3,
  dedupePlies: 6,
});

/**
 * @typedef {import('../../engine/uci.js').Score} Score
 * @typedef {{multipv:number, score:Score, pv:string[]}} Line
 * @typedef {{lines: Line[], bestMove?: string|null}} AnalyzerResult
 * Analizador inyectado: evaluación FINAL de una posición, puntuaciones en perspectiva de blancas
 * y líneas ordenadas por multipv (es la forma de `StockfishEngine.analyze`).
 * @typedef {(fen:string, opts:{depth:number, multipv:number, signal?:AbortSignal}) => Promise<AnalyzerResult>} Analyzer
 * @typedef {typeof GENERATOR_DEFAULTS} GeneratorOptions
 * @typedef {{gameId:string, source?:string, url?:string|null, opponent:string, date:string,
 *   timeControl?:string|null, opening?:string|null}} GameMeta
 * @typedef {{positions:number, candidates:number, notUnique:number, playedBest:number,
 *   noSolution:number, duplicate:number, puzzles:number}} GeneratorStats
 */

const opts = (o) => ({ ...GENERATOR_DEFAULTS, ...o });

export const emptyStats = () => ({ positions: 0, candidates: 0, notUnique: 0, playedBest: 0, noSolution: 0, duplicate: 0, puzzles: 0 });

/** Suma estadísticas (para totales de varias partidas). */
export function addStats(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] ?? 0) + b[k];
  return out;
}

// ---------- Partida ----------

/**
 * Jugadas de un PGN (verbose de chess.js, con `before`/`after`). null si no se puede leer.
 * @param {string} pgn
 */
export function parseGameMoves(pgn) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  return chess.history({ verbose: true });
}

/** FEN de cada posición (ply 0..n) de una partida ya parseada. */
export function positionsOf(history) {
  if (!history.length) return [];
  return [...history.map((m) => m.before), history[history.length - 1].after];
}

/** Puntuación de una posición terminal (mate o tablas) o null si la partida sigue. */
export function terminalScore(fen) {
  const c = new Chess(fen);
  if (!c.isGameOver()) return null;
  if (c.isCheckmate()) return { type: 'mate', value: 0, winner: c.turn() === 'w' ? 'b' : 'w' };
  return { type: 'cp', value: 0 };
}

/**
 * Evalúa todas las posiciones (una a una, en orden).
 * @param {string[]} fens
 * @param {Analyzer} analyzer
 * @param {{depth?:number, signal?:AbortSignal, onPosition?:(done:number, total:number)=>void}} [o]
 * @returns {Promise<{scores:(Score|null)[], bestMoves:(string|null)[]}>}
 */
export async function evaluatePositions(fens, analyzer, { depth = GENERATOR_DEFAULTS.depth, signal, onPosition } = {}) {
  const scores = [];
  const bestMoves = [];
  for (let i = 0; i < fens.length; i++) {
    signal?.throwIfAborted();
    const terminal = terminalScore(fens[i]);
    if (terminal) {
      scores.push(terminal);
      bestMoves.push(null);
    } else {
      const res = await analyzer(fens[i], { depth, multipv: 1, signal });
      const best = res?.lines?.[0] ?? null;
      scores.push(best?.score ?? null);
      bestMoves.push(res?.bestMove ?? best?.pv?.[0] ?? null);
    }
    onPosition?.(i + 1, fens.length);
  }
  return { scores, bestMoves };
}

// ---------- Criterios ----------

const isMateFor = (s, color) => s?.type === 'mate' && s.winner === color;

/**
 * Jugadas del usuario que pierden mucho desde una posición no decidida.
 * @param {{history:object[], scores:(Score|null)[], color:'w'|'b', options?:Partial<GeneratorOptions>}} p
 * @returns {{ply:number, move:object, winBefore:number, winAfter:number}[]}
 */
export function findCandidates({ history, scores, color, options }) {
  const o = opts(options);
  const out = [];
  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    if (move.color !== color || !scores[i] || !scores[i + 1]) continue;
    const winBefore = winPercentFor(scores[i], color);
    const winAfter = winPercentFor(scores[i + 1], color);
    if (winBefore - winAfter < o.lossMin) continue;
    if (winBefore < o.winRange[0] || winBefore > o.winRange[1]) continue;
    out.push({ ply: i, move, winBefore, winAfter });
  }
  return out;
}

/**
 * ¿La mejor línea es única y ganadora para `color`? Devuelve la línea o null.
 * @param {Line[]} lines  MultiPV 2, ordenadas
 * @param {'w'|'b'} color
 */
export function uniqueWinning(lines, color, options) {
  const o = opts(options);
  const [l1, l2] = lines ?? [];
  if (!l1) return null;
  const w1 = winPercentFor(l1.score, color);
  if (!(w1 >= o.solvedMin || isMateFor(l1.score, color))) return null;
  if (!l2) return l1; // jugada única legal
  if (isMateFor(l1.score, color) && !isMateFor(l2.score, color)) return l1;
  const w2 = winPercentFor(l2.score, color);
  return w1 - w2 >= o.uniqueGap ? l1 : null;
}

function playUci(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/**
 * Solución a partir del análisis profundo de la posición del puzle: la mejor jugada y, mientras
 * tu siguiente jugada siga siendo única, la respuesta del rival y esa jugada. Termina en jugada tuya.
 * @param {Analyzer} analyzer
 * @param {string} fen
 * @param {'w'|'b'} color
 * @param {Line[]} firstLines  análisis profundo (MultiPV 2) de `fen`
 * @returns {Promise<string[]>}  jugadas UCI alternando tuya / rival
 */
export async function buildSolution(analyzer, fen, color, firstLines, { signal, ...options } = {}) {
  const o = opts(options);
  const chess = new Chess(fen);
  const solution = [];
  let lines = firstLines;
  for (let k = 0; k < o.maxSolverMoves; k++) {
    const line = uniqueWinning(lines, color, o);
    if (!line) break;
    const mine = line.pv[0];
    if (!playUci(chess, mine)) break;
    solution.push(mine);
    if (chess.isGameOver()) break;
    const reply = line.pv[1];
    if (!reply || k === o.maxSolverMoves - 1) break;
    // ¿Sigue habiendo una jugada tuya única después de la respuesta del rival?
    const probe = new Chess(chess.fen());
    if (!playUci(probe, reply)) break;
    const next = (await analyzer(probe.fen(), { depth: o.deep, multipv: 2, signal }))?.lines ?? [];
    if (!uniqueWinning(next, color, o)) break;
    playUci(chess, reply);
    solution.push(reply);
    lines = next;
  }
  // Debe terminar en jugada tuya (longitud impar).
  if (solution.length % 2 === 0) solution.pop();
  return solution;
}

/** Dificultad orientativa (≈ rating de puzle), en múltiplos de 50. */
export function difficulty({ solution, motif, firstCapture, firstCheck, mateIn }) {
  let r = 1100 + 220 * ((solution.length - 1) / 2);
  if (!firstCapture && !firstCheck) r += 220; // jugada tranquila: más difícil de ver
  if (motif === 'captura') r -= 120;
  if (mateIn && mateIn >= 3) r += 200;
  return Math.round(r / 50) * 50;
}

/** "oportunidad" si ibas ganando (el rival se había equivocado); si no, "error". */
export const puzzleType = (winBefore, options) => (winBefore >= opts(options).opportunity ? 'oportunidad' : 'error');

/** ¿Es la misma idea que el puzle anterior de la misma partida? */
export function isRepeatedIdea(prev, { ply, solution }, options) {
  return Boolean(prev) && prev.solution[0] === solution[0] && ply - prev.ply <= opts(options).dedupePlies;
}

/** Enlace a la jugada en la plataforma (Lichess admite `#ply`). */
export function gameLink(url, source, ply) {
  if (!url) return null;
  return source === 'lichess' || /lichess\.org/.test(url) ? `${url}#${ply}` : url;
}

/** Fecha corta para los puzles ('YYYY.MM.DD', como en los PGN). */
export function gameDate(endTime) {
  if (!Number.isFinite(endTime) || endTime <= 0) return '';
  return new Date(endTime).toISOString().slice(0, 10).replace(/-/g, '.');
}

/**
 * Metadatos del puzle a partir de una partida normalizada (`Game` de src/storage/db.js).
 * @param {import('../../storage/db.js').Game} game
 * @returns {GameMeta}
 */
export function gameMeta(game) {
  return {
    gameId: game.id,
    source: game.source,
    url: game.url ?? null,
    opponent: (game.playerColor === 'w' ? game.black : game.white) ?? 'Rival',
    date: gameDate(game.endTime),
    timeControl: game.timeControl ?? null,
    opening: game.opening ?? null,
  };
}

// ---------- Partida completa ----------

/**
 * Busca los puzles de una partida ya evaluada (hace el análisis profundo de los candidatos).
 * @param {{history:object[], scores:(Score|null)[], color:'w'|'b', analyzer:Analyzer, meta:GameMeta,
 *   options?:Partial<GeneratorOptions>, signal?:AbortSignal, stats?:GeneratorStats}} p
 * @returns {Promise<object[]>}  puzles (formato de puzzleLogic `Puzzle` + gameId, ply, source, generatorVersion)
 */
export async function findGamePuzzles({ history, scores, color, analyzer, meta, options, signal, stats = emptyStats() }) {
  const o = opts(options);
  const puzzles = [];
  for (const { ply, move, winBefore, winAfter } of findCandidates({ history, scores, color, options: o })) {
    signal?.throwIfAborted();
    stats.candidates++;
    const deep = (await analyzer(move.before, { depth: o.deep, multipv: 2, signal }))?.lines ?? [];
    const best = uniqueWinning(deep, color, o);
    if (!best) {
      stats.notUnique++;
      continue;
    }
    if (best.pv[0] === move.lan) {
      stats.playedBest++;
      continue;
    }
    const solution = await buildSolution(analyzer, move.before, color, deep, { ...o, signal });
    if (!solution.length) {
      stats.noSolution++;
      continue;
    }
    if (isRepeatedIdea(puzzles.at(-1), { ply, solution }, o)) {
      stats.duplicate++;
      continue;
    }
    const mot = moveMotif(move.before, solution[0], { score: best.score });
    const mateIn = isMateFor(best.score, color) ? Math.abs(best.score.value) : null;
    const motif = mot?.motif ?? null;
    puzzles.push({
      id: `${meta.gameId}-${ply + 1}`,
      gameId: meta.gameId,
      ply,
      fen: move.before,
      solution,
      color,
      type: puzzleType(winBefore, o),
      motif,
      mateIn,
      phase: gamePhase(move.before),
      moveNumber: Math.floor(ply / 2) + 1,
      played: move.san,
      winBefore: Math.round(winBefore),
      winAfter: Math.round(winAfter),
      opponent: meta.opponent,
      date: meta.date,
      timeControl: meta.timeControl ?? null,
      opening: meta.opening ?? null,
      source: meta.source ?? null,
      gameUrl: gameLink(meta.url, meta.source, ply),
      rating: difficulty({ solution, motif, firstCapture: Boolean(mot?.capture), firstCheck: Boolean(mot?.check), mateIn }),
      generatorVersion: GENERATOR_VERSION,
    });
  }
  stats.puzzles += puzzles.length;
  return puzzles;
}

/**
 * Tubería completa de una partida: evaluar todas las posiciones y buscar puzles.
 * @param {{history:object[], color:'w'|'b', analyzer:Analyzer, meta:GameMeta, options?:Partial<GeneratorOptions>,
 *   signal?:AbortSignal, onPosition?:(done:number, total:number)=>void}} p
 * @returns {Promise<{scores:(Score|null)[], bestMoves:(string|null)[], puzzles:object[], stats:GeneratorStats}>}
 */
export async function analyzeGame({ history, color, analyzer, meta, options, signal, onPosition }) {
  const o = opts(options);
  const stats = emptyStats();
  const fens = positionsOf(history);
  const { scores, bestMoves } = await evaluatePositions(fens, analyzer, { depth: o.depth, signal, onPosition });
  stats.positions = fens.length;
  const puzzles = await findGamePuzzles({ history, scores, color, analyzer, meta, options: o, signal, stats });
  return { scores, bestMoves, puzzles, stats };
}

/** Plies aproximados de un PGN sin parsearlo (para estimar el tiempo restante). */
export function estimatePlies(pgn) {
  const body = String(pgn ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  return body.split(/\s+/).filter((t) => /^[a-hKQRBNO]/.test(t.replace(/^\d+\.+/, ''))).length;
}
