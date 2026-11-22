import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  GENERATOR_VERSION,
  analyzeGame,
  buildSolution,
  difficulty,
  estimatePlies,
  evaluatePositions,
  findCandidates,
  gameLink,
  gameMeta,
  isRepeatedIdea,
  parseGameMoves,
  positionsOf,
  puzzleType,
  terminalScore,
  uniqueWinning,
} from './core.js';
import { gamesFromText } from './sources.js';

const PGN = fs.readFileSync(new URL('../__fixtures__/games.pgn', import.meta.url), 'utf8');
const [G1, G2, G3] = gamesFromText(PGN, { user: 'tester' });

const cp = (value) => ({ type: 'cp', value });
const mate = (value) => ({ type: 'mate', value, winner: value > 0 ? 'w' : 'b' });
const line = (multipv, score, pv) => ({ multipv, score, pv });

/** Analizador falso: `table` mapea `${fen}|${multipv}` a líneas; por defecto cp 0 (MultiPV 1) o nada. */
function fakeAnalyzer(table = {}) {
  const calls = [];
  const fn = async (fen, { depth, multipv }) => {
    calls.push({ fen, depth, multipv });
    const lines = table[`${fen}|${multipv}`] ?? (multipv === 1 ? [line(1, cp(0), ['a2a3'])] : []);
    return { lines, bestMove: lines[0]?.pv[0] ?? null };
  };
  fn.calls = calls;
  return fn;
}

// Partida 1 (tester con blancas): 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.d3? (había 4.Qxf7#).
const history1 = parseGameMoves(G1.pgn);
const fens1 = positionsOf(history1);

describe('partida y posiciones', () => {
  it('parsea el PGN (con relojes) y da n+1 posiciones', () => {
    expect(history1.map((m) => m.san)).toEqual(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'd3', 'Be7', 'Nf3', 'O-O']);
    expect(fens1).toHaveLength(11);
    expect(fens1[0]).toBe(new Chess().fen());
    expect(parseGameMoves('1. e4 Ke7 2. Kx')).toBeNull();
  });

  it('posiciones terminales sin motor', () => {
    const h3 = parseGameMoves(G3.pgn);
    const last = positionsOf(h3).at(-1);
    expect(terminalScore(last)).toEqual({ type: 'mate', value: 0, winner: 'b' });
    expect(terminalScore(new Chess().fen())).toBeNull();
    expect(terminalScore('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual(cp(0)); // ahogado
  });

  it('evaluatePositions usa el analizador salvo en posiciones terminales', async () => {
    const h3 = parseGameMoves(G3.pgn);
    const an = fakeAnalyzer();
    const seen = [];
    const { scores, bestMoves } = await evaluatePositions(positionsOf(h3), an, { depth: 9, onPosition: (d, t) => seen.push(`${d}/${t}`) });
    expect(an.calls).toHaveLength(4);
    expect(an.calls.every((c) => c.depth === 9 && c.multipv === 1)).toBe(true);
    expect(scores.at(-1)).toEqual({ type: 'mate', value: 0, winner: 'b' });
    expect(bestMoves).toEqual(['a2a3', 'a2a3', 'a2a3', 'a2a3', null]);
    expect(seen.at(-1)).toBe('5/5');
  });

  it('se cancela con un AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(evaluatePositions(fens1, fakeAnalyzer(), { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('estima los plies sin parsear (ignora cabeceras, comentarios y resultado)', () => {
    expect(estimatePlies(G1.pgn)).toBe(10);
    expect(estimatePlies(G2.pgn)).toBe(33);
    expect(estimatePlies('1.e4 e5 2.Nf3 (2.f4 exf4) Nc6 1-0')).toBe(4);
  });
});

describe('criterios', () => {
  const scores = fens1.map(() => cp(0));

  it('candidato: jugada tuya que pierde ≥ 18 pp desde una posición no decidida', () => {
    const s = [...scores];
    s[6] = cp(150); // ≈ 63 %
    s[7] = cp(-100); // ≈ 41 %
    const c = findCandidates({ history: history1, scores: s, color: 'w' });
    expect(c).toHaveLength(1);
    expect(c[0].ply).toBe(6);
    expect(c[0].move.san).toBe('d3');
    expect(Math.round(c[0].winBefore)).toBe(63);
    // Las jugadas del rival no cuentan.
    expect(findCandidates({ history: history1, scores: s, color: 'b' })).toHaveLength(0);
  });

  it('no son candidatas: pérdida pequeña, posición decidida o sin evaluación', () => {
    const small = [...scores];
    small[6] = cp(100);
    small[7] = cp(-20);
    expect(findCandidates({ history: history1, scores: small, color: 'w' })).toHaveLength(0);
    const decided = [...scores];
    decided[6] = mate(1); // 100 % > 97
    decided[7] = cp(-100);
    expect(findCandidates({ history: history1, scores: decided, color: 'w' })).toHaveLength(0);
    const lost = [...scores];
    lost[6] = cp(-250); // ≈ 29 % < 30
    lost[7] = cp(-900);
    expect(findCandidates({ history: history1, scores: lost, color: 'w' })).toHaveLength(0);
    const missing = [...scores];
    missing[6] = cp(150);
    missing[7] = null;
    expect(findCandidates({ history: history1, scores: missing, color: 'w' })).toHaveLength(0);
    // Umbral configurable.
    expect(findCandidates({ history: history1, scores: small, color: 'w', options: { lossMin: 10 } })).toHaveLength(1);
  });

  it('uniqueWinning: gana y la 2.ª opción es ≥ 15 pp peor (o solo la 1.ª da mate)', () => {
    expect(uniqueWinning([line(1, cp(300), ['e2e4']), line(2, cp(0), ['d2d4'])], 'w')?.pv[0]).toBe('e2e4');
    expect(uniqueWinning([line(1, cp(300), ['e2e4']), line(2, cp(250), ['d2d4'])], 'w')).toBeNull(); // no única
    expect(uniqueWinning([line(1, cp(50), ['e2e4']), line(2, cp(-400), ['d2d4'])], 'w')).toBeNull(); // no gana
    expect(uniqueWinning([line(1, mate(3), ['e2e4']), line(2, cp(900), ['d2d4'])], 'w')?.pv[0]).toBe('e2e4');
    expect(uniqueWinning([line(1, mate(2), ['e2e4']), line(2, mate(4), ['d2d4'])], 'w')).toBeNull();
    expect(uniqueWinning([line(1, cp(-300), ['e7e5']), line(2, cp(0), ['d7d5'])], 'b')?.pv[0]).toBe('e7e5');
    expect(uniqueWinning([line(1, cp(300), ['e2e4'])], 'w')?.pv[0]).toBe('e2e4'); // jugada única legal
    expect(uniqueWinning([], 'w')).toBeNull();
  });

  it('tipo, dificultad y repetición de la misma idea', () => {
    expect(puzzleType(84)).toBe('oportunidad');
    expect(puzzleType(64)).toBe('error');
    expect(difficulty({ solution: ['a'], motif: 'captura', firstCapture: true, firstCheck: false, mateIn: null })).toBe(1000);
    expect(difficulty({ solution: ['a'], motif: null, firstCapture: false, firstCheck: false, mateIn: null })).toBe(1300);
    expect(difficulty({ solution: ['a', 'b', 'c', 'd', 'e'], motif: 'mate', firstCapture: false, firstCheck: true, mateIn: 3 })).toBe(1750);
    expect(isRepeatedIdea({ ply: 10, solution: ['e2e4'] }, { ply: 16, solution: ['e2e4'] })).toBe(true);
    expect(isRepeatedIdea({ ply: 10, solution: ['e2e4'] }, { ply: 18, solution: ['e2e4'] })).toBe(false);
    expect(isRepeatedIdea({ ply: 10, solution: ['e2e4'] }, { ply: 12, solution: ['d2d4'] })).toBe(false);
    expect(isRepeatedIdea(undefined, { ply: 12, solution: ['d2d4'] })).toBe(false);
  });

  it('enlaces y metadatos de la partida', () => {
    expect(gameLink('https://lichess.org/AbCdEf12', 'lichess', 6)).toBe('https://lichess.org/AbCdEf12#6');
    expect(gameLink('https://www.chess.com/game/live/1', 'chesscom', 6)).toBe('https://www.chess.com/game/live/1');
    expect(gameLink(null, 'pgn', 6)).toBeNull();
    expect(gameMeta(G1)).toEqual({ gameId: 'lichess:AbCdEf12', source: 'lichess', url: 'https://lichess.org/AbCdEf12', opponent: 'rival_a', date: '2025.10.01', timeControl: '300+3', opening: "Bishop's Opening" });
    expect(gameMeta(G2).opponent).toBe('rival_b');
  });
});

describe('buildSolution', () => {
  const start = new Chess().fen();
  const afterE4E5 = new Chess();
  afterE4E5.move('e4');
  afterE4E5.move('e5');
  const first = [line(1, cp(300), ['e2e4', 'e7e5']), line(2, cp(0), ['d2d4'])];

  it('alarga la línea mientras tu jugada siga siendo única (con las respuestas del rival)', async () => {
    const an = fakeAnalyzer({ [`${afterE4E5.fen()}|2`]: [line(1, cp(300), ['g1f3', 'b8c6']), line(2, cp(0), ['d2d4'])] });
    expect(await buildSolution(an, start, 'w', first, { deep: 16 })).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(an.calls.map((c) => [c.depth, c.multipv])).toEqual([[16, 2], [16, 2]]);
  });

  it('se queda en una jugada si la siguiente no es única o con maxSolverMoves 1', async () => {
    expect(await buildSolution(fakeAnalyzer(), start, 'w', first)).toEqual(['e2e4']);
    const an = fakeAnalyzer({ [`${afterE4E5.fen()}|2`]: [line(1, cp(300), ['g1f3', 'b8c6']), line(2, cp(0), ['d2d4'])] });
    expect(await buildSolution(an, start, 'w', first, { maxSolverMoves: 1 })).toEqual(['e2e4']);
    expect(an.calls).toHaveLength(0);
  });

  it('siempre termina en jugada tuya (quita una respuesta suelta si la PV es ilegal)', async () => {
    const an = fakeAnalyzer({ [`${afterE4E5.fen()}|2`]: [line(1, cp(300), ['e2e4']), line(2, cp(0), ['d2d4'])] });
    expect(await buildSolution(an, start, 'w', first)).toEqual(['e2e4']);
  });

  it('para al dar mate', async () => {
    const fen = fens1[6];
    expect(await buildSolution(fakeAnalyzer(), fen, 'w', [line(1, mate(1), ['h5f7', 'e8e7']), line(2, cp(50), ['d2d3'])])).toEqual(['h5f7']);
  });
});

describe('analyzeGame (tubería completa con evaluaciones sintéticas)', () => {
  const table = {
    [`${fens1[6]}|1`]: [line(1, cp(150), ['h5f7'])],
    [`${fens1[7]}|1`]: [line(1, cp(-100), ['f6h5'])],
    [`${fens1[6]}|2`]: [line(1, mate(1), ['h5f7']), line(2, cp(50), ['d2d3'])],
  };

  it('encuentra el mate perdido con todos sus metadatos', async () => {
    const an = fakeAnalyzer(table);
    const res = await analyzeGame({ history: history1, color: 'w', analyzer: an, meta: gameMeta(G1), options: { depth: 10, deep: 14 } });
    expect(res.scores).toHaveLength(11);
    expect(res.bestMoves[6]).toBe('h5f7');
    expect(res.stats).toEqual({ positions: 11, candidates: 1, notUnique: 0, playedBest: 0, noSolution: 0, duplicate: 0, puzzles: 1 });
    expect(an.calls.filter((c) => c.multipv === 1).every((c) => c.depth === 10)).toBe(true);
    expect(an.calls.filter((c) => c.multipv === 2).map((c) => c.depth)).toEqual([14]);
    expect(res.puzzles).toEqual([
      {
        id: 'lichess:AbCdEf12-7',
        gameId: 'lichess:AbCdEf12',
        ply: 6,
        fen: fens1[6],
        solution: ['h5f7'],
        color: 'w',
        type: 'error',
        motif: 'mate',
        mateIn: 1,
        phase: 'apertura',
        moveNumber: 4,
        played: 'd3',
        winBefore: 63,
        winAfter: 41,
        opponent: 'rival_a',
        date: '2025.10.01',
        timeControl: '300+3',
        opening: "Bishop's Opening",
        source: 'lichess',
        gameUrl: 'https://lichess.org/AbCdEf12#6',
        rating: 1100,
        generatorVersion: GENERATOR_VERSION,
      },
    ]);
  });

  it('descarta si la mejor no es única o si jugaste la mejor', async () => {
    const notUnique = { ...table, [`${fens1[6]}|2`]: [line(1, cp(400), ['h5f7']), line(2, cp(350), ['d2d3'])] };
    let res = await analyzeGame({ history: history1, color: 'w', analyzer: fakeAnalyzer(notUnique), meta: gameMeta(G1) });
    expect(res.puzzles).toHaveLength(0);
    expect(res.stats.notUnique).toBe(1);
    const played = { ...table, [`${fens1[6]}|2`]: [line(1, cp(400), ['d2d3']), line(2, cp(0), ['h5f7'])] };
    res = await analyzeGame({ history: history1, color: 'w', analyzer: fakeAnalyzer(played), meta: gameMeta(G1) });
    expect(res.puzzles).toHaveLength(0);
    expect(res.stats.playedBest).toBe(1);
  });

  it('quita la misma idea repetida pocas jugadas después', async () => {
    // tester deja pasar dos veces la misma jugada (ply 6 y ply 8): solo un puzle.
    const t = {
      ...table,
      [`${fens1[8]}|1`]: [line(1, cp(150), ['h5f7'])],
      [`${fens1[9]}|1`]: [line(1, cp(-100), ['a7a6'])],
      [`${fens1[8]}|2`]: [line(1, cp(500), ['h5f7']), line(2, cp(0), ['g1f3'])],
    };
    const res = await analyzeGame({ history: history1, color: 'w', analyzer: fakeAnalyzer(t), meta: gameMeta(G1) });
    expect(res.stats.candidates).toBe(2);
    expect(res.stats.duplicate).toBe(1);
    expect(res.puzzles.map((p) => p.ply)).toEqual([6]);
  });
});
