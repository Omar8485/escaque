// Lógica pura de los puzles (sin React): comprobar jugadas, Elo de puzles, elegir el siguiente
// y guardar el progreso. Los puzles los genera el navegador a partir de tus partidas
// (src/puzzles/generator/) y se guardan en IndexedDB (almacén `puzzles`).
import { Chess } from 'chess.js';

/**
 * @typedef {{id:string, fen:string, solution:string[], color:'w'|'b', type:'error'|'oportunidad',
 *   motif:string|null, mateIn:number|null, phase:string, moveNumber:number, played:string,
 *   opponent:string, date:string, rating:number, gameUrl:string|null, opening:string|null}} Puzzle
 * @typedef {{rating:number, results: Record<string, {result:'solved'|'failed', date:string}>,
 *   streak:number, best:number, reviews?:Record<string, {box:number, dueAt:number}>}} PuzzleProgress
 */

export const START_RATING = 1200;
export const K_FACTOR = 24;

// Los nombres de tipo, tema y fase se muestran con el diccionario (`puzzles.type/motif/phase.*`).

/**
 * Comprueba una jugada del usuario en el paso `step` de la solución (índice par).
 * Acepta la jugada de la solución y, como Lichess, mates alternativos salvo
 * cuando la solución exige elegir una pieza concreta de coronación.
 * @param {Puzzle} puzzle
 * @param {string} fen  posición actual
 * @param {number} step
 * @param {string} uci
 * @returns {{ok: boolean, done: boolean, reply: string|null}}
 */
export function checkMove(puzzle, fen, step, uci) {
  const expected = puzzle.solution[step];
  // La pieza de coronación forma parte de la respuesta: no se deduce de la solución,
  // ni se acepta una pieza distinta aunque también dé mate.
  if (expected?.length === 5 && uci !== expected) return { ok: false, done: false, reply: null };
  let ok = uci === expected;
  if (!ok) {
    const c = new Chess(fen);
    try {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
      ok = c.isCheckmate();
    } catch {
      ok = false;
    }
    if (ok) return { ok: true, done: true, reply: null };
  }
  if (!ok) return { ok: false, done: false, reply: null };
  const done = step + 1 >= puzzle.solution.length;
  return { ok: true, done, reply: done ? null : puzzle.solution[step + 1] };
}

/** Nuevo Elo de puzles tras un resultado (1 resuelto a la primera, 0 fallado). */
export function updateRating(userRating, puzzleRating, solved) {
  const expected = 1 / (1 + 10 ** ((puzzleRating - userRating) / 400));
  return Math.round(userRating + K_FACTOR * ((solved ? 1 : 0) - expected));
}

/**
 * Filtra los puzles.
 * @param {Puzzle[]} puzzles
 * @param {{type?: 'todos'|'error'|'oportunidad', motif?: string}} filters
 */
export function filterPuzzles(puzzles, { type = 'todos', motif = 'todos' } = {}) {
  return puzzles.filter(
    (p) => (type === 'todos' || p.type === type) && (motif === 'todos' || String(p.motif) === motif),
  );
}

/**
 * Siguiente puzle: primero los no intentados, el más cercano a tu Elo; si no quedan, los fallados.
 * @param {Puzzle[]} puzzles
 * @param {PuzzleProgress} progress
 * @param {string|null} [excludeId]
 * @returns {Puzzle|null}
 */
export function pickNext(puzzles, progress, excludeId = null) {
  const byCloseness = (a, b) => Math.abs(a.rating - progress.rating) - Math.abs(b.rating - progress.rating);
  const pool = puzzles.filter((p) => p.id !== excludeId);
  const fresh = pool.filter((p) => !progress.results[p.id]).sort(byCloseness);
  if (fresh.length) return fresh[0];
  const failed = pool.filter((p) => progress.results[p.id]?.result === 'failed').sort(byCloseness);
  return failed[0] ?? pool[0] ?? null;
}

/** Registra el primer resultado de un puzle (los reintentos no cambian el Elo). */
export function recordResult(progress, puzzle, solved, now = new Date()) {
  if (progress.results[puzzle.id]) return progress;
  const rating = updateRating(progress.rating, puzzle.rating, solved);
  const streak = solved ? progress.streak + 1 : 0;
  return {
    ...progress,
    rating,
    streak,
    best: Math.max(progress.best, streak),
    results: { ...progress.results, [puzzle.id]: { result: solved ? 'solved' : 'failed', date: now.toISOString().slice(0, 10) } },
  };
}

const KEY = 'escaque:puzzles';

// Los puzles de la primera versión (src/data/puzzles.json) tenían ids `<idLichess>-<ply>`; ahora
// llevan el id de la partida en IndexedDB (`lichess:<idLichess>-<ply>`). Se conserva el historial.
const LEGACY_ID = /^[A-Za-z0-9]{8}-\d+$/;
function migrateResults(results) {
  const out = {};
  for (const [id, r] of Object.entries(results)) out[LEGACY_ID.test(id) ? `lichess:${id}` : id] = r;
  return out;
}

/** @returns {PuzzleProgress} */
export function readProgress() {
  try {
    const p = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (p && typeof p.rating === 'number' && p.results) return { streak: 0, best: 0, ...p, results: migrateResults(p.results), ...(p.reviews ? { reviews: migrateResults(p.reviews) } : {}) };
  } catch {
    // datos corruptos o sin almacenamiento
  }
  return { rating: START_RATING, results: {}, streak: 0, best: 0 };
}

export function writeProgress(progress) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(progress));
  } catch {
    // sin almacenamiento: dura la sesión
  }
}

/** Resumen para el panel: intentados, resueltos y % de acierto. */
export function progressSummary(progress) {
  const values = Object.values(progress.results);
  const solved = values.filter((r) => r.result === 'solved').length;
  return { attempted: values.length, solved, rate: values.length ? Math.round((solved / values.length) * 100) : null };
}
