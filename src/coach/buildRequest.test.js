import { describe, it, expect, vi } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove } from '../engine/classify.js';
import { validateRequest } from '../../shared/coach-contract/index.js';
import { buildHintRequest, buildMoveRequest, historyFacts, hintForbiddenSquares } from './buildRequest.js';
import { analyzePlayerMove, prefetchTurn, fenAfterMove, COACH_MULTIPV } from './coachPipeline.js';
import { openingFacts } from './opening.js';

const cp = (value) => ({ type: 'cp', value });
const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
const analysis = (fen, lines, depth = 15) => ({
  fen,
  depth,
  targetDepth: depth,
  bestMove: lines[0]?.[1]?.[0] ?? null,
  lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth, score, pv })),
});

// §6.2: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5? (el jugador lleva blancas)
const SAN_LINE = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4'];
const fenBefore = play(SAN_LINE);
const fenAfter = play(['Nxe5'], fenBefore);
const before = analysis(fenBefore, [
  [cp(104), ['f3d4', 'e5d4', 'c2c3']],
  [cp(96), ['e1g1']],
  [cp(54), ['b1c3']],
], 18);
const after = analysis(fenAfter, [[cp(-64), ['d8g5', 'e5g4', 'd7d5']]], 18);
const classification = classifyMove({ fenBefore, moveUci: 'f3e5', before, after });
const lastRivalMove = { san: 'Nd4', piece: 'n', to: 'd4', capture: null };
const player = { color: 'w', rating: 1495 };
const rival = { level: 6, label: 'Héctor' };
const opening = { name: 'Italian Game: Blackburne-Kostić Gambit', inBook: false };

describe('buildMoveRequest (§6.2)', () => {
  const request = buildMoveRequest({
    classification,
    before,
    after,
    lastRivalMove,
    player,
    rival,
    opening,
    history: historyFacts([
      { label: 'Best', motif: null },
      { label: 'Excellent', motif: null },
      { label: 'Good', motif: null },
    ]),
  });

  it('valida contra el schema del contrato', () => {
    expect(validateRequest(request)).toEqual([]);
  });

  it('coincide con el ejemplo del diseño', () => {
    expect(request).toMatchObject({
      schemaVersion: 1,
      promptVersion: 'coach-v4',
      requestType: 'move_feedback',
      player: { color: 'w', rating: 1495 },
      game: { ply: 7, moveNumber: 4, phase: 'apertura', opening, materialBalance: 1 },
      lastRivalMove,
      classification: {
        label: 'Mistake',
        moveSan: 'Nxe5',
        winBefore: 59.5,
        winAfter: 44.1,
        loss: 15.3,
        isBest: false,
        bestMoveSan: null,
        pvSan: null,
        depthBefore: 18,
        depthAfter: 18,
      },
      moveDetails: { piece: 'n', from: 'f3', to: 'e5', capture: 'p', check: false, castle: false, promotion: null },
      coachFacts: { greatMove: false, playedRank: null, stillWinning: false, evalLabelBefore: 'ligera ventaja', evalLabelAfter: 'igualdad' },
      refutation: {
        san: 'Qg5',
        motif: 'ataque_doble',
        targets: [
          { square: 'e5', piece: 'n', defended: false },
          { square: 'g2', piece: 'p', defended: false },
        ],
      },
      hanging: [],
      opponentLoose: null,
      hintFacts: null,
      history: { recentLabels: ['Best', 'Excellent', 'Good'], repeatedMotif: null, takebacks: 0, hintsUsed: 0 },
      policy: { offerTakeback: true, revealBestMove: false, showNumbers: false, hintLevel: null },
      allowedMoves: ['Nd4', 'Nxe5', 'Qg5'],
      userQuestion: null,
    });
    expect([...request.allowedSquares].sort()).toEqual(['d4', 'e5', 'f3', 'g2', 'g5']);
  });

  it('no envía FEN ni la UCI de la mejor jugada (minimización)', () => {
    const text = JSON.stringify(request);
    expect(text).not.toContain(fenBefore);
    expect(text).not.toContain('f3d4');
    expect(request.classification).not.toHaveProperty('fenBefore');
    expect(request.classification).not.toHaveProperty('bestMoveUci');
  });

  it('tras "Seguir" revela la mejor jugada y la PV (máx. 4 plies) y las permite', () => {
    const revealed = buildMoveRequest({ classification, before, after, lastRivalMove, player, rival, opening, revealBestMove: true, requestType: 'why' });
    expect(validateRequest(revealed)).toEqual([]);
    expect(revealed.classification.bestMoveSan).toBe('Nxd4');
    expect(revealed.classification.pvSan).toEqual(['Nxd4', 'exd4', 'c3']);
    expect(revealed.allowedMoves).toEqual(expect.arrayContaining(['Nxd4', 'exd4', 'c3']));
    expect(revealed.policy.revealBestMove).toBe(true);
  });

  it('sin rating (usuario sin partidas importadas) envía null y valida', () => {
    const anon = buildMoveRequest({ classification, before, after, lastRivalMove, player: { ...player, rating: null }, rival, opening });
    expect(anon.player.rating).toBeNull();
    expect(validateRequest(anon)).toEqual([]);
  });
});

describe('buildHintRequest (§6.3)', () => {
  // Mismo punto, pero el jugador lleva negras y le toca tras 4.Nxe5.
  const hintBefore = analysis(fenAfter, [
    [cp(-55), ['d8g5']],
    [cp(-15), ['d7d5']],
    [cp(10), ['d8e7']],
  ]);
  const lastNxe5 = { san: 'Nxe5', piece: 'n', to: 'e5', capture: 'p' };

  it('nivel 2: motivo, pieza y origen; sin la casilla de destino', () => {
    const request = buildHintRequest({
      fen: fenAfter,
      before: hintBefore,
      hintLevel: 2,
      lastRivalMove: lastNxe5,
      player: { color: 'b', rating: 1495 },
      rival,
      opening,
      history: historyFacts([{ label: 'Best' }, { label: 'Good' }], { hintsUsed: 1 }),
    });
    expect(validateRequest(request)).toEqual([]);
    expect(request).toMatchObject({
      requestType: 'hint',
      player: { color: 'b' },
      game: { ply: 8, moveNumber: 4, phase: 'apertura', materialBalance: -1 },
      classification: null,
      coachFacts: { evalLabelBefore: 'igualdad', evalLabelAfter: null },
      opponentLoose: [
        { square: 'e5', piece: 'n' },
        { square: 'e4', piece: 'p' },
      ],
      hintFacts: { motif: 'ataque_doble', bestPiece: 'q', bestFrom: 'd8' },
      policy: { offerTakeback: false, revealBestMove: false, hintLevel: 2 },
      allowedMoves: ['Nxe5'],
      history: { hintsUsed: 1 },
    });
    expect([...request.allowedSquares].sort()).toEqual(['d8', 'e4', 'e5']);
    expect(hintForbiddenSquares(hintBefore)).toEqual(['g5']);
  });

  it('quita de las listas la pieza suelta que la mejor jugada captura', () => {
    // Las blancas mueven; la mejor es capturar el caballo suelto de d4.
    const request = buildHintRequest({ fen: fenBefore, before, hintLevel: 1, lastRivalMove, player, rival });
    expect(request.allowedSquares).not.toContain('d4');
    expect(request.opponentLoose.map((p) => p.square)).not.toContain('d4');
    expect(request.hintFacts).toEqual({ motif: 'captura', bestPiece: null, bestFrom: null });
    expect(validateRequest(request)).toEqual([]);
  });
});

describe('historyFacts', () => {
  it('últimas 5 etiquetas y motivo repetido en jugadas malas', () => {
    const h = historyFacts(
      [
        { label: 'Mistake', motif: 'ataque_doble' },
        { label: 'Good', motif: 'captura' },
        { label: 'Best', motif: null },
        { label: 'Blunder', motif: 'captura' },
        { label: 'Inaccuracy', motif: 'ataque_doble' },
        { label: 'Excellent', motif: null },
      ],
      { takebacks: 2, hintsUsed: 3 },
    );
    expect(h).toEqual({
      recentLabels: ['Good', 'Best', 'Blunder', 'Inaccuracy', 'Excellent'],
      repeatedMotif: 'ataque_doble',
      takebacks: 2,
      hintsUsed: 3,
    });
  });
});

describe('openingFacts', () => {
  const map = { e4: "King's Pawn", 'e4 e5': 'Open Game', 'e4 e5 Nf3': "King's Knight Opening" };
  it('apertura más larga y si sigue en libro', () => {
    expect(openingFacts(['e4', 'e5'], map)).toEqual({ name: 'Open Game', inBook: true });
    expect(openingFacts(['e4', 'e5', 'Nf3', 'Nc6'], map)).toEqual({ name: "King's Knight Opening", inBook: false });
    expect(openingFacts([], map)).toEqual({ name: null, inBook: false });
  });
});

describe('coachPipeline', () => {
  function fakeEngine(results) {
    return {
      analyze: vi.fn(async (fen, { depth = 15, multipv = 1 } = {}) => {
        const r = results[`${fen}|${depth}`];
        if (!r) throw new Error(`sin análisis para ${fen} depth ${depth}`);
        return { ...r, lines: r.lines.slice(0, Math.max(multipv, 1)) };
      }),
    };
  }

  it('fenAfterMove', () => {
    expect(fenAfterMove(fenBefore, 'f3e5')).toBe(fenAfter);
  });

  it('prefetchTurn pide MultiPV 3 a depth 15', async () => {
    const engine = fakeEngine({ [`${fenBefore}|15`]: before });
    await prefetchTurn(engine, fenBefore);
    expect(engine.analyze).toHaveBeenCalledWith(fenBefore, { depth: 15, multipv: COACH_MULTIPV, signal: undefined });
  });

  it('clasifica sin confirmar cuando la pérdida está lejos del umbral', async () => {
    const engine = fakeEngine({ [`${fenBefore}|15`]: before, [`${fenAfter}|15`]: after });
    const r = await analyzePlayerMove(engine, { fenBefore, moveUci: 'f3e5' });
    expect(r.confirmed).toBe(false);
    expect(r.classification.label).toBe('Mistake');
    expect(r.before.lines).toHaveLength(3);
    expect(engine.analyze).toHaveBeenCalledTimes(2);
  });

  it('confirma a depth 18 cuando la pérdida está cerca del umbral', async () => {
    // −20 cp tras la jugada: pérdida ≈ 11,4 pp (Mistake a < 3 pp de 10) → reanaliza.
    const near = analysis(fenAfter, [[cp(-20), ['d8g5']]]);
    const deep = analysis(fenAfter, [[cp(30), ['d8g5']]], 18);
    const engine = fakeEngine({ [`${fenBefore}|15`]: before, [`${fenAfter}|15`]: near, [`${fenAfter}|18`]: deep });
    const r = await analyzePlayerMove(engine, { fenBefore, moveUci: 'f3e5' });
    expect(r.confirmed).toBe(true);
    expect(engine.analyze).toHaveBeenLastCalledWith(fenAfter, { depth: 18, signal: undefined });
    expect(r.classification.label).toBe('Inaccuracy');
    expect(r.classification.depthAfter).toBe(18);
  });
});
