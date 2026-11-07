import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { StockfishEngine, analyzeMove, isAbortError, DEFAULT_DEPTH } from '../engine/engine.js';
import { notifyEngineReady } from '../startup.js';


/**
 * Hook delgado sobre StockfishEngine: crea el worker al montar y lo termina al desmontar.
 *
 * @returns {{
 *   engine: StockfishEngine,
 *   status: import('../engine/engine.js').EngineStatus,
 *   isReady: boolean,
 *   analyze: StockfishEngine['analyze'],
 *   getCached: StockfishEngine['getCached'],
 *   classifyMove: (fenBefore:string, moveUci:string, opts?:{depth?:number, signal?:AbortSignal}) => Promise<object>,
 * }}
 */
export function useStockfish(options) {
  // El constructor no crea el worker, así que es seguro aunque React lo invoque dos veces.
  const [engine] = useState(() => new StockfishEngine(options));

  useEffect(() => {
    engine.start();
    return () => engine.terminate();
  }, [engine]);

  const status = useSyncExternalStore(engine.subscribe, engine.getStatus);
  // Con el motor listo, arranca lo diferido (service worker, pantallas): ver src/startup.js.
  useEffect(() => {
    if (status === 'ready') notifyEngineReady();
  }, [status]);

  const classifyMove = useCallback(
    (fenBefore, moveUci, opts) => analyzeMove(engine, { fenBefore, moveUci }, opts),
    [engine],
  );

  return {
    engine,
    status,
    isReady: status === 'ready',
    analyze: engine.analyze,
    getCached: engine.getCached,
    classifyMove,
  };
}

/**
 * Evaluación en vivo + final de una posición. Al cambiar `fen` cancela el análisis anterior
 * (si nadie más lo necesita) y pide el nuevo.
 *
 * @param {ReturnType<typeof useStockfish>} stockfish
 * @param {string|null} fen
 * @param {{depth?:number, multipv?:number, enabled?:boolean}} [opts]
 * @returns {null | {fen:string, depth:number, lines:import('../engine/engine.js').AnalysisLine[],
 *   bestMove:string|null, isFinal:boolean}}
 */
export function usePositionAnalysis({ analyze, getCached }, fen, { depth = DEFAULT_DEPTH, multipv = 1, enabled = true } = {}) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!enabled || !fen) return undefined;
    const controller = new AbortController();
    analyze(fen, {
      depth,
      multipv,
      signal: controller.signal,
      onInfo: (info) => setState({ ...info, bestMove: info.lines[0]?.pv[0] ?? null, isFinal: false }),
    })
      .then((result) => setState({ ...result, isFinal: true }))
      .catch((err) => {
        if (!isAbortError(err)) console.error('Error analizando posición:', err);
      });
    return () => controller.abort();
  }, [analyze, fen, depth, multipv, enabled]);

  if (!enabled || !fen) return null;
  if (state?.fen === fen) return state;
  const cached = getCached(fen, { depth, multipv });
  return cached ? { ...cached, isFinal: true } : null;
}
