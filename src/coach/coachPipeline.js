// Pipeline del coach sobre el analista (T5, docs/COACH_DESIGN.md §1.2, §4.2 y §7.2).
//
// 1. Al empezar el turno del jugador: `prefetchTurn` pide `fen` a depth 15 con MultiPV 3
//    (en la app lo hace la evaluación en vivo con esos mismos parámetros, así es un solo trabajo).
// 2. Al mover: `analyzePlayerMove` toma `fenBefore` de la caché (o se une al trabajo en curso),
//    analiza `fenAfter` a depth 15 y clasifica. Si la pérdida queda a < 3 pp del umbral de
//    Mistake/Blunder, reanaliza `fenAfter` a depth 18 y reclasifica (confirmación).
// 3. `buildMoveRequest` / `buildHintRequest` (buildRequest.js) arman el CoachRequest.
//
// Equivale a `analyzeMove` de engine.js, pero conserva los análisis completos (MultiPV de la
// posición previa y PV de la refutación) que necesitan los hechos del coach.
import { Chess } from 'chess.js';
import { DEFAULT_DEPTH } from '../engine/engine.js';
import { classifyMove } from '../engine/classify.js';
import { CONFIRM_DEPTH, MAX_PLAYED_RANK, needsDeepConfirmation } from './enrich.js';
import { buildRefutationLine, extendLine, lineFens, needsExtension } from './refutationLine.js';

/** Líneas del análisis previo (para `playedRank`, `greatMove` y pistas). */
export const COACH_MULTIPV = MAX_PLAYED_RANK;

/** FEN tras aplicar una jugada UCI (lanza si es ilegal). */
export function fenAfterMove(fenBefore, moveUci) {
  const chess = new Chess(fenBefore);
  chess.move({ from: moveUci.slice(0, 2), to: moveUci.slice(2, 4), promotion: moveUci[4] });
  return chess.fen();
}

/**
 * Análisis de la posición del turno del jugador (MultiPV 3). Idempotente gracias a la caché.
 * @param {import('../engine/engine.js').StockfishEngine} engine
 * @param {string} fen
 * @param {{depth?:number, signal?:AbortSignal}} [opts]
 */
export function prefetchTurn(engine, fen, { depth = DEFAULT_DEPTH, signal } = {}) {
  return engine.analyze(fen, { depth, multipv: COACH_MULTIPV, signal });
}

/**
 * Analiza y clasifica una jugada del jugador conservando los análisis.
 * @param {import('../engine/engine.js').StockfishEngine} engine
 * @param {{fenBefore:string, moveUci:string}} move
 * @param {{depth?:number, confirmDepth?:number, signal?:AbortSignal}} [opts]
 * @returns {Promise<{classification: ReturnType<typeof classifyMove>, before: object, after: object,
 *   confirmed: boolean}>}  `confirmed`: se reanalizó `fenAfter` a `confirmDepth`
 */
export async function analyzePlayerMove(
  engine,
  { fenBefore, moveUci },
  { depth = DEFAULT_DEPTH, confirmDepth = CONFIRM_DEPTH, signal } = {},
) {
  const fenAfter = fenAfterMove(fenBefore, moveUci);
  // Cola FIFO: la posición previa se encola primero (normalmente ya está en caché).
  const pBefore = engine.analyze(fenBefore, { depth, multipv: COACH_MULTIPV, signal });
  const pAfter = engine.analyze(fenAfter, { depth, signal });
  const [before, after] = await Promise.all([pBefore, pAfter]);
  const classification = classifyMove({ fenBefore, moveUci, before, after });
  if (!needsDeepConfirmation(classification) || confirmDepth <= depth) {
    return { classification, before, after, confirmed: false };
  }
  const deeper = await engine.analyze(fenAfter, { depth: confirmDepth, signal });
  return {
    classification: classifyMove({ fenBefore, moveUci, before, after: deeper }),
    before,
    after: deeper,
    confirmed: true,
  };
}

/** Profundidad para alargar una PV demasiado corta (rápida: solo completa la línea). */
export const LINE_EXTEND_DEPTH = 12;

/**
 * Línea de refutación de "¿Por qué?" (v1.1): la PV del análisis de `fenAfter` (ya hecho a
 * depth 15/18). Si la PV tiene menos de LINE_MIN_PLIES y no termina en mate, se pide al motor la
 * continuación desde su última posición y se unen. La línea siempre sale de Stockfish.
 * @param {import('../engine/engine.js').StockfishEngine} engine
 * @param {{fenAfter:string, after:object}} p
 * @param {{signal?:AbortSignal, depth?:number}} [opts]
 * @returns {Promise<import('./refutationLine.js').RefutationLine|null>}
 */
export async function refutationLineFor(engine, { fenAfter, after }, { signal, depth = LINE_EXTEND_DEPTH } = {}) {
  const first = [...(after?.lines ?? [])].sort((a, b) => a.multipv - b.multipv)[0];
  const line = buildRefutationLine({ fenAfter, pv: first?.pv ?? (after?.bestMove ? [after.bestMove] : []), score: first?.score ?? null });
  if (!needsExtension(line)) return line;
  const fens = lineFens(line);
  const more = await engine.analyze(fens.at(-1), { depth, signal });
  const extra = [...(more?.lines ?? [])].sort((a, b) => a.multipv - b.multipv)[0]?.pv ?? [];
  return extra.length ? extendLine(line, extra, first?.score ?? null) : line;
}
