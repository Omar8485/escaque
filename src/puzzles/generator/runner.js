// Generación de puzles en el navegador a partir de las partidas importadas (almacén `games`).
//
// - Usa una instancia PROPIA de StockfishEngine (no la del analista), con la mitad de los núcleos,
//   para no congelar la interfaz ni competir con el análisis en vivo.
// - Incremental y reanudable: procesa primero las partidas más recientes y, por cada partida,
//   guarda sus puzles y DESPUÉS su `GameAnalysis` (con `generatorVersion`). Una partida con
//   análisis vigente no se vuelve a analizar; si se cierra la pestaña a mitad de una partida,
//   esa partida se repite entera (los ids de los puzles son estables: no se duplican).
// - Cancelable con un AbortSignal; informa del progreso y del tiempo estimado.
import { StockfishEngine, isAbortError } from '../../engine/engine.js';
import { STORES, getAll, getAllByIndex, listGamesNewestFirst, put, putMany, remove } from '../../storage/db.js';
import { isPremium } from '../../premium/planStore.js';
import { generatorLimit } from '../../premium/gate.js';
import { GENERATOR_DEFAULTS, GENERATOR_VERSION, addStats, analyzeGame, emptyStats, estimatePlies, gameMeta, parseGameMoves } from './core.js';

/**
 * @typedef {import('../../storage/db.js').Game} Game
 * @typedef {import('../../storage/db.js').GameAnalysis} GameAnalysis
 * @typedef {import('./core.js').Analyzer} Analyzer
 * @typedef {{total:number, done:number, runTotal:number, runDone:number, puzzlesFound:number,
 *   current:null|{gameId:string, white:string, black:string, date:string, positions:number, positionsTotal:number},
 *   elapsedMs:number, etaMs:number|null, msPerGame:number|null}} GenerationProgress
 * @typedef {{status:'done'|'cancelled', analyzed:number, puzzlesFound:number, elapsedMs:number,
 *   msPerGame:number|null, stats:import('./core.js').GeneratorStats, perGame:{gameId:string, ms:number, plies:number, puzzles:number}[]}} GenerationResult
 */

/** Opciones de límite de la interfaz (0 = todas). */
export const LIMIT_OPTIONS = Object.freeze([50, 100, 0]);
export const DEFAULT_LIMIT = 50;
export const GENERATOR_HASH_MB = 32;

/** Hilos del motor del generador: la mitad de los núcleos (1 sin aislamiento entre orígenes). */
export function generatorThreads(env = globalThis) {
  if (!env.crossOriginIsolated) return 1;
  const cores = env.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.floor(cores / 2));
}

/** Partidas que el generador puede usar: ajedrez estándar y con el color del usuario conocido. */
export const isEligible = (g) => (g.variant ?? 'standard') === 'standard' && (g.playerColor === 'w' || g.playerColor === 'b');
/** ¿El análisis guardado es de la versión actual del generador? */
export const isCurrentAnalysis = (a) => a?.generatorVersion === GENERATOR_VERSION;

/**
 * Partidas en juego (las `limit` más recientes; 0 = todas) y las que faltan por analizar.
 * En el plan gratuito, como mucho las últimas 50 (src/premium/limits.js).
 * @param {{limit?:number, premium?:boolean}} [o]
 */
export async function selectGames({ limit: requested = 0, premium = isPremium() } = {}) {
  const limit = generatorLimit(requested, premium);
  const [games, analyses] = await Promise.all([listGamesNewestFirst(), getAll(STORES.analysis)]);
  const eligible = games.filter(isEligible);
  const current = new Set(analyses.filter(isCurrentAnalysis).map((a) => a.gameId));
  const scope = limit > 0 ? eligible.slice(0, limit) : eligible;
  return {
    scope,
    pending: scope.filter((g) => !current.has(g.id)),
    eligible: eligible.length,
    analyzedTotal: eligible.filter((g) => current.has(g.id)).length,
  };
}

/** Resumen para la interfaz. */
export async function generationSummary({ limit = 0, premium } = {}) {
  const { scope, pending, eligible, analyzedTotal } = await selectGames({ limit, premium });
  return { games: eligible, analyzedTotal, inScope: scope.length, pending: pending.length };
}

/**
 * Puzles guardados cuya partida sigue existiendo. Los de partidas borradas se eliminan.
 * @returns {Promise<{puzzles:object[], removed:number}>}
 */
export async function loadPuzzles() {
  const [games, puzzles] = await Promise.all([getAll(STORES.games), getAll(STORES.puzzles)]);
  const ids = new Set(games.map((g) => g.id));
  const orphans = puzzles.filter((p) => !ids.has(p.gameId));
  for (const p of orphans) await remove(STORES.puzzles, p.id);
  return { puzzles: puzzles.filter((p) => ids.has(p.gameId)), removed: orphans.length };
}

/** Reemplaza los puzles de una partida (los de una versión anterior que ya no salen se borran). */
async function savePuzzlesFor(gameId, puzzles, createdAt) {
  const old = await getAllByIndex(STORES.puzzles, 'gameId', gameId);
  const keep = new Map(old.map((p) => [p.id, p]));
  const fresh = new Set(puzzles.map((p) => p.id));
  for (const p of old) if (!fresh.has(p.id)) await remove(STORES.puzzles, p.id);
  if (puzzles.length) await putMany(STORES.puzzles, puzzles.map((p) => ({ ...p, createdAt: keep.get(p.id)?.createdAt ?? createdAt })));
}

/**
 * Analiza las partidas pendientes y guarda análisis y puzles.
 * @param {{limit?:number, signal?:AbortSignal, onProgress?:(p:GenerationProgress)=>void,
 *   onGame?:(r:{game:Game, puzzles:object[]})=>void, analyzer?:Analyzer, createEngine?:()=>StockfishEngine,
 *   options?:Partial<import('./core.js').GeneratorOptions>, now?:()=>number}} [o]
 * @returns {Promise<GenerationResult>}
 */
export async function runGeneration({ limit = 0, signal, onProgress, onGame, analyzer, createEngine, options, now = () => Date.now() } = {}) {
  const depth = options?.depth ?? GENERATOR_DEFAULTS.depth;
  const { scope, pending } = await selectGames({ limit });
  const t0 = now();
  /** @type {GenerationProgress} */
  const progress = { total: scope.length, done: scope.length - pending.length, runTotal: pending.length, runDone: 0, puzzlesFound: 0, current: null, elapsedMs: 0, etaMs: null, msPerGame: null };
  let stats = emptyStats();
  const perGame = [];
  const result = (status) => ({ status, analyzed: progress.runDone, puzzlesFound: progress.puzzlesFound, elapsedMs: now() - t0, msPerGame: progress.msPerGame, stats, perGame });
  if (!pending.length) {
    onProgress?.({ ...progress });
    return result('done');
  }

  // ETA por plies (las partidas varían mucho de longitud): ms por ply hecho × plies que faltan.
  const plies = pending.map((g) => estimatePlies(g.pgn) + 1);
  const pliesTotal = plies.reduce((a, b) => a + b, 0);
  let pliesDone = 0;
  const emit = () => {
    progress.elapsedMs = now() - t0;
    progress.etaMs = pliesDone > 0 ? Math.round((progress.elapsedMs / pliesDone) * Math.max(0, pliesTotal - pliesDone)) : null;
    onProgress?.({ ...progress, current: progress.current && { ...progress.current } });
  };

  let engine = null;
  let analyze = analyzer;
  if (!analyze) {
    engine = createEngine ? createEngine() : new StockfishEngine({ threads: generatorThreads(), hash: GENERATOR_HASH_MB });
    engine.start();
    analyze = (fen, opts) => engine.analyze(fen, opts);
  }

  try {
    for (let k = 0; k < pending.length; k++) {
      signal?.throwIfAborted();
      const game = pending[k];
      const tGame = now();
      const base = pliesDone;
      const meta = gameMeta(game);
      progress.current = { gameId: game.id, white: game.white, black: game.black, date: meta.date, positions: 0, positionsTotal: 0 };
      emit();
      const history = parseGameMoves(game.pgn);
      let out = { scores: [], bestMoves: [], puzzles: [], stats: emptyStats() };
      if (history?.length) {
        out = await analyzeGame({
          history,
          color: game.playerColor,
          analyzer: analyze,
          meta,
          options,
          signal,
          onPosition: (d, t) => {
            progress.current.positions = d;
            progress.current.positionsTotal = t;
            pliesDone = Math.min(base + d, base + plies[k]);
            emit();
          },
        });
      }
      signal?.throwIfAborted();
      // Primero los puzles y al final el análisis: el análisis marca la partida como hecha.
      await savePuzzlesFor(game.id, out.puzzles, now());
      /** @type {GameAnalysis} */
      const analysis = { gameId: game.id, depth, scores: out.scores, bestMoves: out.bestMoves, analyzedAt: now(), generatorVersion: GENERATOR_VERSION };
      await put(STORES.analysis, analysis);

      pliesDone = base + plies[k];
      stats = addStats(stats, out.stats);
      perGame.push({ gameId: game.id, ms: now() - tGame, plies: out.scores.length, puzzles: out.puzzles.length });
      progress.runDone++;
      progress.done++;
      progress.puzzlesFound += out.puzzles.length;
      progress.msPerGame = Math.round((now() - t0) / progress.runDone);
      progress.current = null;
      emit();
      onGame?.({ game, puzzles: out.puzzles });
    }
    return result('done');
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) return result('cancelled');
    throw err;
  } finally {
    engine?.terminate();
  }
}
