import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove } from '../engine/classify.js';
import {
  allowedLists,
  describeMove,
  hangingPieces,
  hintFacts,
  moveDetails,
  moveMotif,
  opponentLoose,
  refutationFacts,
  rivalMoveFacts,
} from './tactics.js';

const cp = (value) => ({ type: 'cp', value });
const mate = (value, winner) => ({ type: 'mate', value, winner });
const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
/** Análisis sintético; `lines` = [[score, pv], …] en orden de MultiPV. */
const analysis = (fen, lines, depth = 15) => ({
  fen,
  depth,
  bestMove: lines[0]?.[1]?.[0] ?? null,
  lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth, score, pv })),
});

// Línea de §6.2: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5? Qg5
const fenBeforeNd4 = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
const fenBefore = play(['Nd4'], fenBeforeNd4);
const fenAfter = play(['Nxe5'], fenBefore);
// Solo la 1.ª jugada de las PV es la del ejemplo; el resto es ilustrativo (y legal).
const before = analysis(fenBefore, [
  [cp(104), ['f3d4', 'e5d4', 'c2c3']],
  [cp(96), ['e1g1']],
  [cp(54), ['b1c3']],
]);
const after = analysis(fenAfter, [[cp(-64), ['d8g5', 'e5g4', 'd7d5']]]);

describe('detalles de jugadas', () => {
  it('moveDetails de 4.Nxe5 (contrato §4.4)', () => {
    expect(moveDetails(fenBefore, 'f3e5')).toEqual({
      piece: 'n',
      from: 'f3',
      to: 'e5',
      capture: 'p',
      check: false,
      castle: false,
      promotion: null,
    });
  });

  it('lastRivalMove de 3…Nd4', () => {
    expect(rivalMoveFacts(fenBeforeNd4, 'c6d4')).toEqual({ san: 'Nd4', piece: 'n', to: 'd4', capture: null });
  });

  it('enroque, promoción, jaque y mate', () => {
    expect(describeMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1')).toMatchObject({ san: 'O-O-O', castle: true });
    expect(describeMove('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q')).toMatchObject({
      san: 'e8=Q',
      piece: 'p',
      promotion: 'q',
      check: false,
    });
    expect(describeMove(play(['f3', 'e5', 'g4']), 'd8h4')).toMatchObject({ san: 'Qh4#', check: true, mate: true });
    expect(describeMove(fenBefore, 'e1e3')).toBeNull();
  });
});

describe('refutación (§6.2)', () => {
  it('Qg5 es ataque doble con objetivos e5 y g2', () => {
    expect(refutationFacts({ fenAfter, after })).toEqual({
      san: 'Qg5',
      piece: 'q',
      to: 'g5',
      check: false,
      captures: null,
      motif: 'ataque_doble',
      mateIn: null,
      targets: [
        { square: 'e5', piece: 'n', defended: false },
        { square: 'g2', piece: 'p', defended: false },
      ],
    });
  });

  it('d2 (atacado por la dama pero defendido y de menos valor) no es objetivo', () => {
    const m = moveMotif(fenAfter, 'd8g5');
    const chess = new Chess(fenAfter);
    chess.move('Qg5');
    expect(chess.attackers('d2', 'b')).toContain('g5');
    expect(m.targets.map((t) => t.square)).not.toContain('d2');
  });

  it('sin PV no hay refutación', () => {
    expect(refutationFacts({ fenAfter, after: { lines: [], bestMove: null } })).toBeNull();
  });

  it('mate: 1.f3 e5 2.g4?? Qh4#', () => {
    const fen = play(['f3', 'e5', 'g4']);
    const r = refutationFacts({ fenAfter: fen, after: analysis(fen, [[mate(-1, 'b'), ['d8h4']]]) });
    expect(r).toMatchObject({ san: 'Qh4#', check: true, motif: 'mate', mateIn: 1 });
  });

  it('un mate a favor del jugador no es motivo "mate" de la refutación', () => {
    const r = refutationFacts({ fenAfter, after: analysis(fenAfter, [[mate(5, 'w'), ['d8g5']]]) });
    expect(r.motif).toBe('ataque_doble');
    expect(r.mateIn).toBeNull();
  });
});

describe('moveMotif', () => {
  it('jaque_y_ataque: Qa4+ ataca el caballo sin defensa de b4', () => {
    const m = moveMotif('4k3/8/8/8/1n6/8/8/3QK3 w - - 0 1', 'd1a4');
    expect(m.check).toBe(true);
    expect(m.motif).toBe('jaque_y_ataque');
    expect(m.targets).toEqual([{ square: 'b4', piece: 'n', defended: false }]);
  });

  it('ataque_doble: horquilla de caballo a rey y dama defendida', () => {
    const m = moveMotif('q3k3/1b6/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7');
    expect(m.check).toBe(true);
    expect(m.targets).toEqual([{ square: 'a8', piece: 'q', defended: true }]);
    expect(m.motif).toBe('ataque_doble');
  });

  it('captura y jugada tranquila', () => {
    expect(moveMotif(play(['e4', 'd5']), 'e4d5').motif).toBe('captura');
    expect(moveMotif(play(['e4', 'd5']), 'e4d5').capture).toBe('p');
    expect(moveMotif('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4').motif).toBeNull();
    expect(moveMotif(fenBefore, 'a1a8')).toBeNull();
  });
});

describe('piezas colgadas (hanging)', () => {
  it('tras 4.Nxe5 no hay piezas blancas colgadas (contrato §4.4)', () => {
    expect(hangingPieces({ fenAfter, after })).toEqual([]);
  });

  it('peón sin defensa atacado; confirmado si la PV lo captura', () => {
    // 1.e4 b5: el peón de b5 no tiene defensa y lo ataca el alfil de f1.
    const fen = play(['e4', 'b5']);
    expect(hangingPieces({ fenAfter: fen, after: analysis(fen, [[cp(80), ['f1b5', 'c7c6']]]) })).toEqual([
      { square: 'b5', piece: 'p', defended: false, confirmedByEngine: true },
    ]);
    expect(hangingPieces({ fenAfter: fen, after: analysis(fen, [[cp(80), ['d2d4']]]) })).toEqual([
      { square: 'b5', piece: 'p', defended: false, confirmedByEngine: false },
    ]);
    // 1.e4 d5: d5 está defendido por la dama y el atacante (peón) no vale menos → no cuelga.
    expect(hangingPieces({ fenAfter: play(['e4', 'd5']) })).toEqual([]);
  });

  it('pieza defendida pero atacada por una de menor valor', () => {
    const fen = '4k3/8/2p5/3N4/4P3/8/8/4K3 b - - 0 1'; // caballo d5 (defendido por e4) atacado por c6
    expect(hangingPieces({ fenAfter: fen, after: analysis(fen, [[cp(0), ['c6d5', 'e4d5']]]) })).toEqual([
      { square: 'd5', piece: 'n', defended: true, confirmedByEngine: true },
    ]);
  });

  it('sigue a la pieza si el jugador la mueve y la capturan en el 3.er ply', () => {
    const fen = 'r3k3/8/8/N7/8/8/8/4K3 b - - 0 1'; // caballo a5 sin defensa, atacado por la torre
    const r = hangingPieces({ fenAfter: fen, after: analysis(fen, [[cp(0), ['e8d7', 'a5c6', 'd7c6']]]) });
    expect(r).toEqual([{ square: 'a5', piece: 'n', defended: false, confirmedByEngine: true }]);
  });
});

describe('piezas sueltas del rival y pistas (§6.3)', () => {
  it('opponentLoose = caballo de e5 y peón de e4 (el alfil de c4 lo defiende Ne5)', () => {
    expect(opponentLoose(fenAfter, 'b')).toEqual([
      { square: 'e5', piece: 'n' },
      { square: 'e4', piece: 'p' },
    ]);
  });

  it('desde blancas: solo cuenta lo que está fuera de las filas 7–8 de negras', () => {
    // Tras 4.Nxe5 la única pieza negra fuera de casa es Nd4, sin defensores. Los peones sin
    // defensa de las filas 7–8 (p. ej. h7) no cuentan.
    expect(opponentLoose(fenAfter, 'w')).toEqual([{ square: 'd4', piece: 'n' }]);
  });

  const beforeHint = analysis(fenAfter, [
    [cp(-55), ['d8g5']],
    [cp(15), ['d7d5']],
    [cp(30), ['d8e7']],
  ]);

  it('hintFacts nivel 2: ataque doble con la dama desde d8', () => {
    expect(hintFacts({ fen: fenAfter, before: beforeHint, hintLevel: 2 })).toEqual({
      motif: 'ataque_doble',
      bestPiece: 'q',
      bestFrom: 'd8',
    });
  });

  it('hintFacts nivel 1: solo el motivo; sin nivel: null', () => {
    expect(hintFacts({ fen: fenAfter, before: beforeHint, hintLevel: 1 })).toEqual({
      motif: 'ataque_doble',
      bestPiece: null,
      bestFrom: null,
    });
    expect(hintFacts({ fen: fenAfter, before: beforeHint, hintLevel: null })).toBeNull();
  });

  it('allowedMoves / allowedSquares de la pista (§6.3)', () => {
    const lists = allowedLists({
      lastRivalMove: rivalMoveFacts(fenBefore, 'f3e5'),
      opponentLoose: opponentLoose(fenAfter, 'b'),
      hintFacts: hintFacts({ fen: fenAfter, before: beforeHint, hintLevel: 2 }),
    });
    expect(lists).toEqual({ allowedMoves: ['Nxe5'], allowedSquares: ['e5', 'e4', 'd8'] });
    expect(lists.allowedSquares).not.toContain('g5'); // casilla prohibida de la pista
  });
});

describe('allowedLists de move_feedback (§4.4)', () => {
  const classification = classifyMove({ fenBefore, moveUci: 'f3e5', before, after });
  const refutation = refutationFacts({ fenAfter, after });
  const lastRivalMove = rivalMoveFacts(fenBeforeNd4, 'c6d4');
  const hanging = hangingPieces({ fenAfter, after });

  it('sin revelar la mejor jugada', () => {
    expect(allowedLists({ classification, lastRivalMove, refutation, hanging })).toEqual({
      allowedMoves: ['Nd4', 'Nxe5', 'Qg5'],
      allowedSquares: ['d4', 'f3', 'e5', 'g5', 'g2'],
    });
  });

  it('revelando la mejor jugada y su PV (máx. 4 plies)', () => {
    expect(classification.bestMoveSan).toBe('Nxd4');
    expect(allowedLists({ classification, lastRivalMove, refutation, hanging, revealBestMove: true })).toEqual({
      allowedMoves: ['Nd4', 'Nxe5', 'Qg5', 'Nxd4', 'exd4', 'c3'],
      allowedSquares: ['d4', 'f3', 'e5', 'g5', 'c2', 'c3', 'g2'],
    });
  });

  it('solo las piezas colgadas confirmadas por el motor entran en allowedSquares', () => {
    const lists = allowedLists({
      hanging: [
        { square: 'b7', piece: 'b', defended: false, confirmedByEngine: false },
        { square: 'h4', piece: 'r', defended: false, confirmedByEngine: true },
      ],
    });
    expect(lists).toEqual({ allowedMoves: [], allowedSquares: ['h4'] });
  });
});
