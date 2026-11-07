import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { STORES, _resetDbForTests, get, getAll, put, putMany, remove } from '../../storage/db.js';
import { GENERATOR_VERSION, parseGameMoves, positionsOf } from './core.js';
import { generationSummary, generatorThreads, loadPuzzles, runGeneration, selectGames } from './runner.js';
import { gamesFromText } from './sources.js';

const PGN = fs.readFileSync(new URL('../__fixtures__/games.pgn', import.meta.url), 'utf8');
const GAMES = gamesFromText(PGN, { user: 'tester' });
const [G1, G2, G3] = GAMES;
const fens1 = positionsOf(parseGameMoves(G1.pgn));

const cp = (value) => ({ type: 'cp', value });
const line = (multipv, score, pv) => ({ multipv, score, pv });
// En G1 tester juega 4.d3 cuando había 4.Qxf7#.
const TABLE = {
  [`${fens1[6]}|1`]: [line(1, cp(150), ['h5f7'])],
  [`${fens1[7]}|1`]: [line(1, cp(-100), ['f6h5'])],
  [`${fens1[6]}|2`]: [line(1, { type: 'mate', value: 1, winner: 'w' }, ['h5f7']), line(2, cp(50), ['d2d3'])],
};

function fakeAnalyzer({ onCall } = {}) {
  const calls = [];
  const fn = async (fen, o) => {
    calls.push(fen);
    onCall?.(calls.length, o);
    o.signal?.throwIfAborted();
    const lines = TABLE[`${fen}|${o.multipv}`] ?? (o.multipv === 1 ? [line(1, cp(0), ['a2a3'])] : []);
    return { lines, bestMove: lines[0]?.pv[0] ?? null };
  };
  fn.calls = calls;
  return fn;
}

afterEach(async () => {
  await _resetDbForTests();
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('escaque');
    r.onsuccess = r.onerror = resolve;
  });
});

describe('runner (IndexedDB + analizador falso)', () => {
  it('analiza de la más reciente a la más antigua, guarda análisis y puzles y no repite', async () => {
    await putMany(STORES.games, GAMES);
    const order = [];
    const progress = [];
    const res = await runGeneration({ analyzer: fakeAnalyzer(), onGame: ({ game }) => order.push(game.id), onProgress: (p) => progress.push(p) });
    expect(res).toMatchObject({ status: 'done', analyzed: 3, puzzlesFound: 1 });
    expect(order).toEqual([G1.id, G2.id, G3.id]);
    expect(res.perGame.map((g) => g.plies)).toEqual([11, 34, 5]);

    const a1 = await get(STORES.analysis, G1.id);
    expect(a1).toMatchObject({ gameId: G1.id, depth: 12, generatorVersion: GENERATOR_VERSION });
    expect(a1.scores).toHaveLength(11);
    expect(a1.bestMoves[6]).toBe('h5f7');
    const puzzles = await getAll(STORES.puzzles);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]).toMatchObject({ id: `${G1.id}-7`, gameId: G1.id, solution: ['h5f7'], gameUrl: 'https://lichess.org/AbCdEf12#6' });
    expect(typeof puzzles[0].createdAt).toBe('number');

    const last = progress.at(-1);
    expect(last).toMatchObject({ total: 3, done: 3, runTotal: 3, runDone: 3, puzzlesFound: 1, current: null, etaMs: 0 });
    expect(progress.some((p) => p.current?.positionsTotal === 34)).toBe(true);

    // Segunda vez: nada pendiente.
    const again = fakeAnalyzer();
    expect(await runGeneration({ analyzer: again })).toMatchObject({ status: 'done', analyzed: 0 });
    expect(again.calls).toHaveLength(0);
    expect(await generationSummary()).toEqual({ games: 3, analyzedTotal: 3, inScope: 3, pending: 0 });
  });

  it('con límite solo toma las N más recientes', async () => {
    await putMany(STORES.games, GAMES);
    const res = await runGeneration({ limit: 2, analyzer: fakeAnalyzer() });
    expect(res.analyzed).toBe(2);
    expect(await get(STORES.analysis, G3.id)).toBeUndefined();
    expect(await generationSummary({ limit: 2 })).toMatchObject({ inScope: 2, pending: 0 });
    expect(await generationSummary({ limit: 0 })).toMatchObject({ inScope: 3, pending: 1 });
  });

  it('cancelar a mitad conserva lo hecho y al reanudar sigue donde quedó', async () => {
    await putMany(STORES.games, GAMES);
    const ac = new AbortController();
    // Se cancela durante la 2.ª partida (G1 tiene 10 posiciones con motor + 1 profundo).
    const res = await runGeneration({ analyzer: fakeAnalyzer({ onCall: (n) => n === 15 && ac.abort() }), signal: ac.signal });
    expect(res).toMatchObject({ status: 'cancelled', analyzed: 1, puzzlesFound: 1 });
    expect(await get(STORES.analysis, G1.id)).toBeDefined();
    expect(await get(STORES.analysis, G2.id)).toBeUndefined();

    const order = [];
    const resumed = await runGeneration({ analyzer: fakeAnalyzer(), onGame: ({ game }) => order.push(game.id) });
    expect(resumed).toMatchObject({ status: 'done', analyzed: 2 });
    expect(order).toEqual([G2.id, G3.id]);
    expect(await getAll(STORES.puzzles)).toHaveLength(1);
  });

  it('reanaliza partidas de otra versión del generador y reemplaza sus puzles', async () => {
    await putMany(STORES.games, [G1]);
    await put(STORES.analysis, { gameId: G1.id, depth: 10, scores: [], bestMoves: [], analyzedAt: 1, generatorVersion: GENERATOR_VERSION - 1 });
    await put(STORES.puzzles, { id: `${G1.id}-3`, gameId: G1.id, solution: ['x'] });
    expect((await selectGames()).pending.map((g) => g.id)).toEqual([G1.id]);
    await runGeneration({ analyzer: fakeAnalyzer() });
    expect((await getAll(STORES.puzzles)).map((p) => p.id)).toEqual([`${G1.id}-7`]);
    expect((await get(STORES.analysis, G1.id)).generatorVersion).toBe(GENERATOR_VERSION);
  });

  it('ignora partidas sin tu color o de otras variantes y no falla con PGN ilegible', async () => {
    const broken = { ...G3, id: 'pgn:roto', pgn: '1. e4 Ke7 2. Kx', endTime: G1.endTime + 1 };
    await putMany(STORES.games, [broken, { ...G2, id: 'x:1', playerColor: null }, { ...G2, id: 'x:2', variant: 'chess960' }]);
    const res = await runGeneration({ analyzer: fakeAnalyzer() });
    expect(res.analyzed).toBe(1);
    expect(await get(STORES.analysis, 'pgn:roto')).toMatchObject({ scores: [], bestMoves: [] });
    expect((await generationSummary()).games).toBe(1);
  });

  it('los puzles de partidas borradas se eliminan al cargar', async () => {
    await putMany(STORES.games, GAMES);
    await runGeneration({ analyzer: fakeAnalyzer() });
    expect((await loadPuzzles()).puzzles).toHaveLength(1);
    await remove(STORES.games, G1.id);
    expect(await loadPuzzles()).toEqual({ puzzles: [], removed: 1 });
    expect(await getAll(STORES.puzzles)).toHaveLength(0);
  });

  it('hilos: la mitad de los núcleos, 1 sin aislamiento', () => {
    expect(generatorThreads({ crossOriginIsolated: true, navigator: { hardwareConcurrency: 8 } })).toBe(4);
    expect(generatorThreads({ crossOriginIsolated: true, navigator: { hardwareConcurrency: 2 } })).toBe(1);
    expect(generatorThreads({ crossOriginIsolated: true, navigator: { hardwareConcurrency: 1 } })).toBe(1);
    expect(generatorThreads({ crossOriginIsolated: false, navigator: { hardwareConcurrency: 8 } })).toBe(1);
  });
});
