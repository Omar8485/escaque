// Servicio del motor Stockfish (sin React).
//
// - Un único Web Worker con cola de análisis SECUENCIAL: nunca hay dos `go` en vuelo.
// - Sincronización por búsqueda: `position` + `isready` → esperar `readyok` → `go`.
//   Para cancelar se envía `stop` y se ignora todo hasta el `bestmove` de esa búsqueda,
//   así las `info` tardías de una búsqueda vieja nunca se mezclan con la nueva.
// - Todas las puntuaciones salen normalizadas a perspectiva de BLANCAS (ver uci.js).
// - Caché de evaluaciones finales por FEN: navegar por una partida no recalcula.
// - Peticiones idénticas (mismo FEN) se agrupan en un solo trabajo; un trabajo solo
//   se cancela cuando TODOS sus solicitantes abortan.
import { Chess } from 'chess.js';
import { parseInfo, parseBestMove, sideToMove, toWhitePerspective } from './uci.js';
import { classifyMove } from './classify.js';

export const DEFAULT_ENGINE_URL = '/stockfish/stockfish.js';
export const DEFAULT_DEPTH = 15;
const CACHE_LIMIT = 2000;

/**
 * @typedef {import('./uci.js').Score} Score
 * @typedef {{multipv:number, depth:number, seldepth:number|null, score:Score, pv:string[],
 *   nodes:number|null, time:number|null}} AnalysisLine
 * @typedef {{fen:string, depth:number, targetDepth:number, multipv:number,
 *   lines:AnalysisLine[], bestMove:string|null, ponder:string|null}} Analysis
 * @typedef {{fen:string, depth:number, lines:AnalysisLine[]}} LiveInfo
 * @typedef {'idle'|'loading'|'ready'|'error'} EngineStatus
 */

function abortError() {
  return new DOMException('Análisis cancelado', 'AbortError');
}

/** true si el error proviene de una cancelación (AbortSignal o terminate()). */
export function isAbortError(err) {
  return err?.name === 'AbortError';
}

function defaultThreads() {
  // El build multihilo necesita SharedArrayBuffer (COOP/COEP). Dejamos un núcleo libre para la UI.
  if (!globalThis.crossOriginIsolated) return 1;
  const cores = globalThis.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(4, cores - 1));
}

function sliceAnalysis(result, multipv) {
  if (result.lines.length <= multipv) return result;
  return { ...result, multipv, lines: result.lines.slice(0, multipv) };
}

export class StockfishEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.url]              ruta del script del motor
   * @param {() => Worker} [options.createWorker] fábrica del worker (para pruebas)
   * @param {number} [options.threads]
   * @param {number} [options.hash]             MB de tabla hash
   */
  constructor({ url = DEFAULT_ENGINE_URL, createWorker, threads, hash = 32 } = {}) {
    this._createWorker = createWorker ?? (() => new Worker(url));
    this._threads = threads;
    this._hash = hash;
    this._worker = null;
    /** @type {EngineStatus} */
    this._status = 'idle';
    this._listeners = new Set();
    this._queue = [];
    this._current = null;
    this._phase = 'off'; // off | init | idle | preparing | searching | stopping
    this._multipvOption = 1;
    /** @type {Map<string, Analysis>} */
    this._cache = new Map();

    this.subscribe = this.subscribe.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.analyze = this.analyze.bind(this);
    this.getCached = this.getCached.bind(this);
  }

  // ---------- Ciclo de vida ----------

  /** Arranca el worker (idempotente). Puede volver a llamarse tras terminate(). */
  start() {
    if (this._worker) return;
    try {
      this._worker = this._createWorker();
    } catch (err) {
      console.error('No se pudo crear el worker de Stockfish:', err);
      this._setStatus('error');
      return;
    }
    this._worker.onmessage = (e) => {
      String(e.data).split('\n').forEach((line) => line && this._onLine(line.trim()));
    };
    this._worker.onerror = (err) => {
      console.error('Error en el worker de Stockfish:', err);
      this._fail(new Error('El worker de Stockfish falló'));
    };
    this._phase = 'init';
    this._multipvOption = 1;
    this._setStatus('loading');
    this._post('uci');
  }

  /** Detiene el worker y cancela lo pendiente. La caché se conserva. */
  terminate() {
    if (this._worker) {
      this._worker.onmessage = null;
      this._worker.onerror = null;
      this._worker.terminate();
      this._worker = null;
    }
    this._rejectAll(abortError());
    this._phase = 'off';
    this._setStatus('idle');
  }

  /** Suscripción a cambios de estado (compatible con useSyncExternalStore). */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** @returns {EngineStatus} */
  getStatus() {
    return this._status;
  }

  // ---------- API de análisis ----------

  /**
   * Analiza una posición hasta `depth`. Las peticiones se atienden en orden (FIFO).
   * @param {string} fen
   * @param {{depth?:number, multipv?:number, signal?:AbortSignal, onInfo?:(info:LiveInfo)=>void}} [opts]
   * @returns {Promise<Analysis>}  evaluación FINAL (al llegar `bestmove`), perspectiva de blancas
   */
  analyze(fen, { depth = DEFAULT_DEPTH, multipv = 1, signal, onInfo } = {}) {
    let turn;
    try {
      turn = sideToMove(fen);
    } catch (err) {
      return Promise.reject(err);
    }
    if (signal?.aborted) return Promise.reject(abortError());

    const cached = this.getCached(fen, { depth, multipv });
    if (cached) return Promise.resolve(cached);
    if (this._status === 'error') return Promise.reject(new Error('Stockfish no está disponible'));

    let job = [this._current, ...this._queue].find(
      (j) => j && !j.cancelled && j.fen === fen && j.depth >= depth && j.multipv >= multipv,
    );
    if (!job) {
      job = { fen, turn, depth, multipv, waiters: new Set(), lines: new Map(), cancelled: false };
      this._queue.push(job);
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, onInfo, multipv, signal, onAbort: null };
      if (signal) {
        waiter.onAbort = () => {
          job.waiters.delete(waiter);
          reject(abortError());
          if (job.waiters.size === 0) {
            // Diferido: otro solicitante del mismo FEN puede sumarse en el mismo tick
            // (p. ej. un efecto de React que se desmonta y otro que se monta).
            queueMicrotask(() => {
              if (job.waiters.size === 0) this._cancelJob(job);
            });
          }
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      job.waiters.add(waiter);
      this._pump();
    });
  }

  /**
   * Evaluación final en caché con al menos esa profundidad objetivo y número de líneas.
   * @returns {Analysis|null}
   */
  getCached(fen, { depth = DEFAULT_DEPTH, multipv = 1 } = {}) {
    const hit = this._cache.get(fen);
    if (!hit || hit.targetDepth < depth || hit.multipv < multipv) return null;
    return sliceAnalysis(hit, multipv);
  }

  // ---------- Interno ----------

  _setStatus(status) {
    if (this._status === status) return;
    this._status = status;
    this._listeners.forEach((l) => l());
  }

  _post(cmd) {
    this._worker?.postMessage(cmd);
  }

  _onLine(line) {
    if (this._phase === 'init') {
      if (line === 'uciok') {
        const threads = this._threads ?? defaultThreads();
        this._post(`setoption name Threads value ${threads}`);
        this._post(`setoption name Hash value ${this._hash}`);
        this._post('isready');
      } else if (line === 'readyok') {
        this._phase = 'idle';
        this._setStatus('ready');
        this._pump();
      }
      return;
    }

    const job = this._current;
    if (line === 'readyok') {
      if (this._phase !== 'preparing' || !job) return;
      if (job.cancelled) {
        this._finishCurrent();
        return;
      }
      this._phase = 'searching';
      this._post(`go depth ${job.depth}`);
      return;
    }

    if (line.startsWith('info')) {
      // Solo se aceptan `info` de la búsqueda en curso y no cancelada.
      if (this._phase !== 'searching' || !job || job.cancelled) return;
      const info = parseInfo(line);
      // Las líneas lowerbound/upperbound son cotas provisionales: no se usan.
      if (!info || info.bound) return;
      job.lines.set(info.multipv, {
        multipv: info.multipv,
        depth: info.depth,
        seldepth: info.seldepth,
        score: toWhitePerspective(info.score, job.turn),
        pv: info.pv,
        nodes: info.nodes,
        time: info.time,
      });
      this._emitInfo(job);
      return;
    }

    const best = parseBestMove(line);
    if (best) {
      if ((this._phase !== 'searching' && this._phase !== 'stopping') || !job) return;
      if (!job.cancelled) this._resolveJob(job, best);
      this._finishCurrent();
    }
  }

  _sortedLines(job) {
    return [...job.lines.values()].sort((a, b) => a.multipv - b.multipv);
  }

  _emitInfo(job) {
    const lines = this._sortedLines(job);
    for (const w of job.waiters) {
      if (!w.onInfo) continue;
      const own = lines.filter((l) => l.multipv <= w.multipv);
      try {
        w.onInfo({ fen: job.fen, depth: own[0]?.depth ?? 0, lines: own });
      } catch (err) {
        console.error(err);
      }
    }
  }

  _resolveJob(job, best) {
    const lines = this._sortedLines(job);
    /** @type {Analysis} */
    const result = {
      fen: job.fen,
      depth: lines[0]?.depth ?? 0,
      targetDepth: job.depth,
      multipv: job.multipv,
      lines,
      bestMove: best.bestMove,
      ponder: best.ponder,
    };
    const prev = this._cache.get(job.fen);
    if (!prev || prev.targetDepth <= job.depth) {
      this._cache.delete(job.fen);
      this._cache.set(job.fen, result);
      if (this._cache.size > CACHE_LIMIT) this._cache.delete(this._cache.keys().next().value);
    }
    for (const w of job.waiters) {
      w.signal?.removeEventListener('abort', w.onAbort);
      w.resolve(sliceAnalysis(result, w.multipv));
    }
    job.waiters.clear();
  }

  _finishCurrent() {
    this._current = null;
    this._phase = 'idle';
    this._pump();
  }

  _cancelJob(job) {
    job.cancelled = true;
    const idx = this._queue.indexOf(job);
    if (idx >= 0) {
      this._queue.splice(idx, 1);
      return;
    }
    if (job === this._current && this._phase === 'searching') {
      this._phase = 'stopping';
      this._post('stop');
    }
    // En 'preparing' se resuelve al llegar `readyok` (no se envía `go`).
  }

  _pump() {
    if (this._phase !== 'idle' || this._current) return;
    while (this._queue.length) {
      const job = this._queue.shift();
      if (job.cancelled || job.waiters.size === 0) continue;
      // Pudo resolverse mientras esperaba (otro trabajo del mismo FEN más profundo).
      const cached = this.getCached(job.fen, { depth: job.depth, multipv: job.multipv });
      if (cached) {
        for (const w of job.waiters) {
          w.signal?.removeEventListener('abort', w.onAbort);
          w.resolve(sliceAnalysis(cached, w.multipv));
        }
        job.waiters.clear();
        continue;
      }
      this._current = job;
      this._phase = 'preparing';
      if (this._multipvOption !== job.multipv) {
        this._post(`setoption name MultiPV value ${job.multipv}`);
        this._multipvOption = job.multipv;
      }
      this._post(`position fen ${job.fen}`);
      this._post('isready');
      return;
    }
  }

  _rejectAll(err) {
    const jobs = [this._current, ...this._queue].filter(Boolean);
    for (const job of jobs) {
      job.cancelled = true;
      for (const w of job.waiters) {
        w.signal?.removeEventListener('abort', w.onAbort);
        w.reject(err);
      }
      job.waiters.clear();
    }
    this._queue = [];
    this._current = null;
  }

  _fail(err) {
    this._rejectAll(err);
    this._phase = 'off';
    this._setStatus('error');
  }
}

/**
 * Analiza la posición anterior (primero) y la posterior a una jugada y la clasifica.
 * Usa la caché, así que cada jugada se calcula una sola vez.
 * @param {StockfishEngine} engine
 * @param {{fenBefore:string, moveUci:string}} move
 * @param {{depth?:number, signal?:AbortSignal}} [opts]
 * @returns {Promise<ReturnType<typeof classifyMove>>}
 */
export async function analyzeMove(engine, { fenBefore, moveUci }, { depth = DEFAULT_DEPTH, signal } = {}) {
  const chess = new Chess(fenBefore);
  chess.move({ from: moveUci.slice(0, 2), to: moveUci.slice(2, 4), promotion: moveUci[4] });
  const fenAfter = chess.fen();
  // Se encola la posición previa ANTES que la posterior (cola FIFO).
  const pBefore = engine.analyze(fenBefore, { depth, signal });
  const pAfter = engine.analyze(fenAfter, { depth, signal });
  const [before, after] = await Promise.all([pBefore, pAfter]);
  return classifyMove({ fenBefore, moveUci, before, after });
}
