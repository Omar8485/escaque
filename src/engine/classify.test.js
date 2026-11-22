import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove, labelForLoss, uciLineToSan, uciToSan } from './classify.js';
import { winPercent } from './uci.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const fenAfter = (fen, uci) => {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
};

// Construye un resultado de analyze() (puntuación ya en perspectiva de blancas).
const analysis = (fen, score, pv = [], depth = 15) => ({
  fen,
  depth,
  bestMove: pv[0] ?? null,
  lines: [{ multipv: 1, depth, score, pv }],
});

const cp = (value) => ({ type: 'cp', value });

describe('labelForLoss', () => {
  it('aplica los umbrales en pp', () => {
    expect(labelForLoss(0)).toBe('Excellent');
    expect(labelForLoss(2)).toBe('Excellent');
    expect(labelForLoss(2.01)).toBe('Good');
    expect(labelForLoss(5)).toBe('Good');
    expect(labelForLoss(9.9)).toBe('Inaccuracy');
    expect(labelForLoss(15)).toBe('Mistake');
    expect(labelForLoss(20)).toBe('Mistake');
    expect(labelForLoss(20.5)).toBe('Blunder');
  });
});

describe('UCI → SAN', () => {
  it('convierte jugadas y variantes', () => {
    expect(uciToSan(START, 'g1f3')).toBe('Nf3');
    expect(uciToSan(START, 'e2e5')).toBeNull();
    expect(uciLineToSan(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 3)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('convierte enroque y promoción', () => {
    expect(uciToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1')).toBe('O-O');
    expect(uciToSan('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q')).toBe('e8=Q');
  });
});

describe('classifyMove', () => {
  it('la jugada igual a la mejor del motor es Best', () => {
    const fenB = START;
    const fenA = fenAfter(fenB, 'e2e4');
    // Aunque la eval baje un poco (ruido entre búsquedas), coincide con bestmove → Best.
    const r = classifyMove({
      fenBefore: fenB,
      moveUci: 'e2e4',
      before: analysis(fenB, cp(35), ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4']),
      after: analysis(fenA, cp(28), ['e7e5']),
    });
    expect(r.label).toBe('Best');
    expect(r.isBest).toBe(true);
    expect(r).toMatchObject({
      color: 'w',
      moveSan: 'e4',
      bestMoveUci: 'e2e4',
      bestMoveSan: 'e4',
      evalBefore: cp(35),
      evalAfter: cp(28),
      fenBefore: fenB,
      fenAfter: fenA,
    });
    expect(r.pvSan).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(r.winBefore).toBeCloseTo(winPercent(cp(35)), 10);
    expect(r.winAfter).toBeCloseTo(winPercent(cp(28)), 10);
  });

  it('una pérdida grande es Blunder', () => {
    const fenB = START;
    const fenA = fenAfter(fenB, 'g2g4');
    const r = classifyMove({
      fenBefore: fenB,
      moveUci: 'g2g4',
      before: analysis(fenB, cp(30), ['e2e4']),
      after: analysis(fenA, cp(-400), ['e7e5']),
    });
    expect(r.label).toBe('Blunder');
    expect(r.isBest).toBe(false);
    expect(r.loss).toBeGreaterThan(20);
    expect(r.bestMoveSan).toBe('e4');
    expect(r.moveSan).toBe('g4');
  });

  it('jugada de negras que empeora a negras aunque la eval desde blancas SUBA', () => {
    const fenB = fenAfter(START, 'e2e4'); // juegan negras
    const fenA = fenAfter(fenB, 'f7f6');
    const r = classifyMove({
      fenBefore: fenB,
      moveUci: 'f7f6',
      before: analysis(fenB, cp(30), ['e7e5']),
      after: analysis(fenA, cp(250), ['d2d4']), // +2.50 para blancas: malo para negras
    });
    expect(r.color).toBe('b');
    // Desde negras: win% antes ≈ 47, después ≈ 29 → pierde ~18 pp.
    expect(r.winBefore).toBeCloseTo(100 - winPercent(cp(30)), 10);
    expect(r.winAfter).toBeCloseTo(100 - winPercent(cp(250)), 10);
    expect(r.winAfter).toBeLessThan(r.winBefore);
    expect(r.loss).toBeCloseTo(r.winBefore - r.winAfter, 10);
    expect(r.label).toBe('Mistake');
  });

  it('jugada de negras que mejora a negras no tiene pérdida', () => {
    const fenB = fenAfter(START, 'e2e4');
    const fenA = fenAfter(fenB, 'c7c5');
    const r = classifyMove({
      fenBefore: fenB,
      moveUci: 'c7c5',
      before: analysis(fenB, cp(40), ['e7e5']),
      after: analysis(fenA, cp(20), ['g1f3']),
    });
    expect(r.loss).toBe(0);
    expect(r.label).toBe('Excellent');
  });

  it('transición a mate en contra: 1.f3 e5 2.g4?? es Blunder', () => {
    const fenB = fenAfter(fenAfter(START, 'f2f3'), 'e7e5'); // juegan blancas
    const fenA = fenAfter(fenB, 'g2g4');
    const r = classifyMove({
      fenBefore: fenB,
      moveUci: 'g2g4',
      before: analysis(fenB, cp(-90), ['e2e4']),
      after: analysis(fenA, { type: 'mate', value: -1, winner: 'b' }, ['d8h4']),
    });
    expect(r.winAfter).toBe(0);
    expect(r.loss).toBeCloseTo(winPercent(cp(-90)), 10);
    expect(r.label).toBe('Blunder');
    expect(r.evalAfter).toEqual({ type: 'mate', value: -1, winner: 'b' });
  });

  it('dar mate con una jugada distinta a la del motor no pierde nada', () => {
    const fenB = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1';
    const fenA = fenAfter(fenB, 'a1a8');
    const r = classifyMove({
      fenBefore: fenB,
      moveUci: 'a1a8',
      before: analysis(fenB, { type: 'mate', value: 1, winner: 'w' }, ['d1d8']),
      after: { fen: fenA, depth: 0, bestMove: null, lines: [{ multipv: 1, depth: 0, score: { type: 'mate', value: 0, winner: 'w' }, pv: [] }] },
    });
    expect(r.loss).toBe(0);
    expect(r.label).toBe('Excellent');
    expect(r.moveSan).toBe('Ra8#');
  });

  it('falla si falta la evaluación final', () => {
    expect(() => classifyMove({ fenBefore: START, moveUci: 'e2e4', before: { lines: [] }, after: analysis(START, cp(0)) })).toThrow();
  });
});
