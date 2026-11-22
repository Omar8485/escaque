// Clasificación en segundo plano de TODAS las jugadas de la partida de Entrenar (las tuyas y
// las del rival) para las estadísticas de fin de partida y para las reacciones del rival.
//
// No añade búsquedas: pide exactamente los mismos análisis (FEN, profundidad y MultiPV) que la
// app ya pide por su cuenta, así el `StockfishEngine` los sirve de su caché o los une al trabajo
// en curso (agrupa peticiones del mismo FEN):
//  - Jugada del rival: la posición previa (= después de tu jugada) ya la analizan la evaluación
//    en vivo y Alfred a depth 15, MultiPV 1; la posterior (= tu turno) la pre-analiza la
//    evaluación en vivo a depth 15 con MultiPV 3 si Alfred está activo (1 si no).
//  - Tu jugada: con Alfred activo, la misma tubería que él (`analyzePlayerMove`, con la
//    confirmación a depth 18 cerca del umbral), así la etiqueta coincide con la suya; sin
//    Alfred, la clasificación del panel de App (depth 15, MultiPV 1 antes y después).
// El rival juega en su propio worker: nada de esto retrasa su respuesta.
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { DEFAULT_DEPTH, isAbortError } from '../engine/engine.js';
import { classifyMove } from '../engine/classify.js';
import { analyzePlayerMove, COACH_MULTIPV } from './coachPipeline.js';
import { moveKey } from './summary.js';

/**
 * Clasificación de una jugada del rival tal como la recibe `onRivalMoveClassified`: la salida de
 * `classifyMove` (src/engine/classify.js) más datos de la partida.
 * @typedef {ReturnType<typeof classifyMove> & {
 *   key: string,          // "<FEN antes>|<UCI>"
 *   gameId: number,       // id de la partida (useGameLoop)
 *   ply: number,          // medio movimiento (1 = primera jugada de la partida)
 *   moveNumber: number,   // número de jugada (como en la notación)
 *   san: string,          // jugada en SAN (igual que moveSan)
 *   byRival: true,
 * }} RivalMoveClassification
 */

/**
 * Analiza y clasifica una jugada con los mismos parámetros que el resto de la app.
 * @param {import('../engine/engine.js').StockfishEngine} engine
 * @param {import('./summary.js').LineMove} move
 * @param {{isPlayerMove:boolean, coachActive:boolean, depth?:number, signal?:AbortSignal}} opts
 */
export async function classifyLineMove(engine, move, { isPlayerMove, coachActive, depth = DEFAULT_DEPTH, signal }) {
  const fenBefore = move.before;
  const moveUci = move.uci;
  if (isPlayerMove && coachActive) {
    const { classification } = await analyzePlayerMove(engine, { fenBefore, moveUci }, { depth, signal });
    return classification;
  }
  // La posición posterior a una jugada del rival es tu turno: con Alfred se pre-analiza con
  // MultiPV 3 (salvo que la partida haya terminado: entonces la evaluación en vivo usa 1).
  const afterMultipv = !isPlayerMove && coachActive && !new Chess(move.after).isGameOver() ? COACH_MULTIPV : 1;
  // Cola FIFO del motor: primero la posición previa (normalmente ya en caché).
  const pBefore = engine.analyze(fenBefore, { depth, multipv: 1, signal });
  const pAfter = engine.analyze(move.after, { depth, multipv: afterMultipv, signal });
  const [before, after] = await Promise.all([pBefore, pAfter]);
  return classifyMove({ fenBefore, moveUci, before, after });
}

/**
 * @param {object} p
 * @param {import('../engine/engine.js').StockfishEngine} p.engine  analista (el de useStockfish)
 * @param {boolean} p.enabled     hay partida (en juego o recién terminada) que clasificar
 * @param {number} p.gameId       al cambiar se descarta todo
 * @param {import('./summary.js').LineMove[]} p.line  jugadas de la partida (lineFromSans)
 * @param {'w'|'b'} p.playerColor
 * @param {boolean} p.coachActive  Alfred activo (decide el MultiPV que la app ya pide)
 * @param {(c: RivalMoveClassification) => void} [p.onRivalMoveClassified]
 * @returns {{classifications: Record<string, ReturnType<typeof classifyMove>>, pending: number}}
 */
const NO_CLASSIFICATIONS = Object.freeze({});

export function useMoveLedger({ engine, enabled, gameId, line, playerColor, coachActive, onRivalMoveClassified }) {
  const [stored, setStored] = useState({ gameId, byKey: {} });
  const byKey = stored.gameId === gameId ? stored.byKey : NO_CLASSIFICATIONS;

  const inflight = useRef(new Map()); // key → AbortController
  const failed = useRef(new Set());
  const callbackRef = useRef(onRivalMoveClassified);
  useEffect(() => {
    callbackRef.current = onRivalMoveClassified;
  });

  // Nueva partida o desmontaje: se cancela todo lo pendiente.
  useEffect(() => {
    const map = inflight.current;
    const failedSet = failed.current;
    return () => {
      map.forEach((c) => c.abort());
      map.clear();
      failedSet.clear();
    };
  }, [gameId, engine]);

  useEffect(() => {
    const map = inflight.current;
    const wanted = new Set(enabled ? line.map(moveKey) : []);
    // Jugadas que ya no están en la línea (Deshacer): no hace falta clasificarlas.
    for (const [key, controller] of map) {
      if (!wanted.has(key)) {
        controller.abort();
        map.delete(key);
      }
    }
    if (!enabled) return;
    for (const move of line) {
      const key = moveKey(move);
      if (byKey[key] || map.has(key) || failed.current.has(key)) continue;
      const controller = new AbortController();
      map.set(key, controller);
      const isPlayerMove = move.color === playerColor;
      classifyLineMove(engine, move, { isPlayerMove, coachActive, signal: controller.signal })
        .then((classification) => {
          if (controller.signal.aborted) return;
          map.delete(key);
          setStored((s) => {
            const base = s.gameId === gameId ? s : { gameId, byKey: {} };
            return { gameId, byKey: { ...base.byKey, [key]: classification } };
          });
          if (!isPlayerMove) {
            try {
              callbackRef.current?.({ ...classification, key, gameId, ply: move.ply, moveNumber: move.moveNumber, san: move.san, byRival: true });
            } catch (err) {
              console.error('onRivalMoveClassified falló:', err);
            }
          }
        })
        .catch((err) => {
          map.delete(key);
          if (isAbortError(err) || controller.signal.aborted) return;
          failed.current.add(key); // no se reintenta en bucle
          console.error('No se pudo clasificar la jugada', move.san, err);
        });
    }
  }, [enabled, line, byKey, engine, gameId, playerColor, coachActive]);

  const pending = enabled ? line.filter((m) => !byKey[moveKey(m)]).length : 0;
  return { classifications: byKey, pending };
}
