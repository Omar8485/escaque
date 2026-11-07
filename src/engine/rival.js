// Rival con fuerza limitada (docs/COACH_DESIGN.md §3.2). Sin React.
//
// - Worker PROPIO, independiente del analista (`StockfishEngine`): no comparte cola, caché
//   ni opciones (`UCI_LimitStrength`, `Skill Level`, `MultiPV`...).
// - SIN caché: un rival aleatorizado no debe repetir siempre la misma jugada en una posición.
// - Operaciones en serie (cola FIFO): nunca hay dos `go` en vuelo.
//   · newGame(level): `ucinewgame` + `setoption` del nivel + `isready` → `readyok`.
//   · chooseMove(fen): `position fen` + `isready` → `readyok` → `go` del nivel → `bestmove`.
// - Abortar durante la búsqueda envía `stop`, rechaza al instante con AbortError y DESCARTA
//   el `bestmove` que llegue después; la siguiente operación espera a ese `bestmove`.
// - Retardo mínimo visible por nivel (`delayMs`), medido desde que se pide la jugada.
import { Chess } from 'chess.js';
import { parseBestMove, sideToMove } from './uci.js';
import { DEFAULT_ENGINE_URL, isAbortError } from './engine.js';
import { getRivalLevel, levelGoCommand, levelOptionCommands } from './rivalLevels.js';

export { isAbortError };

/** @typedef {'idle'|'loading'|'ready'|'error'} RivalStatus */
/**
 * @typedef {{uci:string, san:string, from:string, to:string, promotion:string|null,
 *   fen:string, level:number, thinkMs:number, elapsedMs:number}} RivalMove
 */

function abortError() {
  return new DOMException('Jugada del rival cancelada', 'AbortError');
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(id);
      reject(abortError());
    };
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class RivalEngine {
  /**
   * @param {object} [options]
   * @param {string} [options.url]                ruta del script del motor
   * @param {() => Worker} [options.createWorker] fábrica del worker (para pruebas)
   * @param {number} [options.threads=1]
   * @param {number} [options.hash=16]           MB de tabla hash
   * @param {boolean} [options.delay=true]       aplicar el retardo mínimo visible del nivel
   * @param {() => number} [options.random]      fuente aleatoria para el retardo (pruebas)
   * @param {() => number} [options.now]
   * @param {(ms:number, signal?:AbortSignal) => Promise<void>} [options.sleep]
   */
  constructor({
    url = DEFAULT_ENGINE_URL,
    createWorker,
    threads = 1,
    hash = 16,
    delay = true,
    random = Math.random,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    sleep = defaultSleep,
  } = {}) {
    this._createWorker = createWorker ?? (() => new Worker(url));
    this._threads = threads;
    this._hash = hash;
    this._delay = delay;
    this._random = random;
    this._now = now;
    this._sleep = sleep;

    this._worker = null;
    /** @type {RivalStatus} */
    this._status = 'idle';
    this._listeners = new Set();
    this._queue = [];
    this._current = null;
    this._phase = 'off'; // off | init | idle | preparing | searching | stopping
    this._level = null;

    this.subscribe = this.subscribe.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.newGame = this.newGame.bind(this);
    this.chooseMove = this.chooseMove.bind(this);
  }

  // ---------- Ciclo de vida ----------

  /** Arranca el worker (idempotente). Las operaciones pedidas antes esperan a `readyok`. */
  start() {
    if (this._worker) return;
    try {
      this._worker = this._createWorker();
    } catch (err) {
      console.error('No se pudo crear el worker del rival:', err);
      this._setStatus('error');
      return;
    }
    this._worker.onmessage = (e) => {
      String(e.data).split('\n').forEach((line) => line && this._onLine(line.trim()));
    };
    this._worker.onerror = (err) => {
      console.error('Error en el worker del rival:', err);
      this._fail(new Error('El worker del rival falló'));
    };
    this._phase = 'init';
    this._setStatus('loading');
    this._post('uci');
  }

  /** Detiene el worker y rechaza lo pendiente con AbortError. Hay que volver a llamar a newGame(). */
  terminate() {
    if (this._worker) {
      this._worker.onmessage = null;
      this._worker.onerror = null;
      this._worker.terminate();
      this._worker = null;
    }
    this._rejectAll(abortError());
    this._phase = 'off';
    this._level = null;
    this._setStatus('idle');
  }

  /** Suscripción a cambios de estado (compatible con useSyncExternalStore). */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** @returns {RivalStatus} */
  getStatus() {
    return this._status;
  }

  /** Nivel de la partida en curso (null si no se llamó a newGame). */
  get level() {
    return this._level;
  }

  // ---------- API ----------

  /**
   * Nueva partida: `ucinewgame` (limpia la tabla hash), opciones del nivel e `isready`.
   * El nivel queda fijado para las siguientes chooseMove().
   * @param {number} level 1–9
   * @returns {Promise<void>}
   */
  newGame(level) {
    let def;
    try {
      def = getRivalLevel(level);
    } catch (err) {
      return Promise.reject(err);
    }
    if (this._status === 'error') return Promise.reject(new Error('El rival no está disponible'));
    this._level = level;
    return new Promise((resolve, reject) => {
      this._queue.push({ kind: 'newGame', def, resolve, reject, cancelled: false });
      this._pump();
    });
  }

  /**
   * Elige la jugada del rival en `fen` con el nivel fijado por newGame().
   * Resuelve null si no hay jugadas legales (`bestmove (none)`).
   * @param {string} fen
   * @param {{signal?:AbortSignal}} [opts]
   * @returns {Promise<RivalMove|null>}
   */
  async chooseMove(fen, { signal } = {}) {
    sideToMove(fen); // valida el FEN
    if (signal?.aborted) throw abortError();
    if (this._level === null) throw new Error('RivalEngine: llama a newGame(level) antes de chooseMove()');
    if (this._status === 'error') throw new Error('El rival no está disponible');

    const def = getRivalLevel(this._level);
    const t0 = this._now();
    const [minDelay, maxDelay] = def.delayMs;
    const target = this._delay ? minDelay + this._random() * (maxDelay - minDelay) : 0;

    const best = await this._search(fen, def, signal);
    if (!best.bestMove) return null;

    const chess = new Chess(fen);
    const uci = best.bestMove;
    let move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      throw new Error(`El rival devolvió una jugada ilegal: ${uci} en ${fen}`);
    }

    const wait = target - (this._now() - t0);
    if (wait > 0) await this._sleep(wait, signal);
    if (signal?.aborted) throw abortError();

    return {
      uci,
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? null,
      fen,
      level: def.level,
      thinkMs: best.thinkMs,
      elapsedMs: this._now() - t0,
    };
  }

  // ---------- Interno ----------

  _search(fen, def, signal) {
    return new Promise((resolve, reject) => {
      const op = { kind: 'move', fen, def, resolve, reject, signal, cancelled: false, onAbort: null, t0: 0 };
      if (signal) {
        op.onAbort = () => this._abortOp(op);
        signal.addEventListener('abort', op.onAbort, { once: true });
      }
      this._queue.push(op);
      this._pump();
    });
  }

  _abortOp(op) {
    if (op.cancelled) return;
    op.cancelled = true;
    op.reject(abortError());
    const idx = this._queue.indexOf(op);
    if (idx >= 0) {
      this._queue.splice(idx, 1);
      return;
    }
    if (op === this._current && this._phase === 'searching') {
      this._phase = 'stopping';
      this._post('stop');
    }
    // En 'preparing' se descarta al llegar `readyok` (no se envía `go`).
  }

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
        this._post(`setoption name Threads value ${this._threads}`);
        this._post(`setoption name Hash value ${this._hash}`);
        this._post('isready');
      } else if (line === 'readyok') {
        this._phase = 'idle';
        this._setStatus('ready');
        this._pump();
      }
      return;
    }

    const op = this._current;
    if (line === 'readyok') {
      if (this._phase !== 'preparing' || !op) return;
      if (op.kind === 'newGame') {
        op.resolve();
        this._finishCurrent();
        return;
      }
      if (op.cancelled) {
        this._finishCurrent();
        return;
      }
      this._phase = 'searching';
      op.t0 = this._now();
      this._post(levelGoCommand(op.def));
      return;
    }

    const best = parseBestMove(line);
    if (best) {
      if ((this._phase !== 'searching' && this._phase !== 'stopping') || !op) return;
      // Un `bestmove` tras `stop` (o de una operación abortada) se descarta.
      if (!op.cancelled && this._phase === 'searching') {
        op.signal?.removeEventListener('abort', op.onAbort);
        op.resolve({ ...best, thinkMs: this._now() - op.t0 });
      }
      this._finishCurrent();
    }
  }

  _finishCurrent() {
    this._current = null;
    this._phase = 'idle';
    this._pump();
  }

  _pump() {
    if (this._phase !== 'idle' || this._current) return;
    while (this._queue.length) {
      const op = this._queue.shift();
      if (op.cancelled) continue;
      this._current = op;
      this._phase = 'preparing';
      if (op.kind === 'newGame') {
        this._post('ucinewgame');
        levelOptionCommands(op.def).forEach((cmd) => this._post(cmd));
      } else {
        this._post(`position fen ${op.fen}`);
      }
      this._post('isready');
      return;
    }
  }

  _rejectAll(err) {
    const ops = [this._current, ...this._queue].filter(Boolean);
    for (const op of ops) {
      if (op.cancelled) continue;
      op.cancelled = true;
      op.signal?.removeEventListener('abort', op.onAbort);
      op.reject(err);
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
