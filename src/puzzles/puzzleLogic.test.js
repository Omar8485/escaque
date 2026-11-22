import { describe, it, expect } from 'vitest';
import { checkMove, updateRating, pickNext, recordResult, filterPuzzles, progressSummary, readProgress, START_RATING } from './puzzleLogic.js';

// Mate del pastor: blancas dan mate con Qxf7#.
const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
const puzzle = { id: 'g-1', fen: FEN, solution: ['h5f7'], color: 'w', type: 'oportunidad', motif: 'mate', rating: 1000 };
const twoMover = { id: 'g-2', fen: FEN, solution: ['c4f7', 'e8f7', 'h5e5'], color: 'w', type: 'error', motif: 'captura', rating: 1400 };

describe('checkMove', () => {
  it('acepta la jugada de la solución y marca el final', () => {
    expect(checkMove(puzzle, FEN, 0, 'h5f7')).toEqual({ ok: true, done: true, reply: null });
  });
  it('rechaza otra jugada que no da mate', () => {
    expect(checkMove(puzzle, FEN, 0, 'c4f7')).toEqual({ ok: false, done: false, reply: null });
  });
  it('en soluciones largas devuelve la respuesta del rival', () => {
    expect(checkMove(twoMover, FEN, 0, 'c4f7')).toEqual({ ok: true, done: false, reply: 'e8f7' });
  });
  it('acepta un mate distinto al de la solución', () => {
    expect(checkMove({ ...twoMover }, FEN, 0, 'h5f7')).toMatchObject({ ok: true, done: true });
  });
  it.each([
    ['w', '7k/P7/8/8/8/8/8/7K w - - 0 1', 'a7a8'],
    ['b', '7k/8/8/8/8/8/p7/7K b - - 0 1', 'a2a1'],
    ['w', '1r5k/P7/8/8/8/8/8/7K w - - 0 1', 'a7b8'],
  ])('exige elegir la pieza exacta de coronación (%s, %s)', (color, fen, move) => {
    const promotion = { ...puzzle, color, fen, solution: [move + 'n'] };
    expect(checkMove(promotion, fen, 0, move + 'n')).toEqual({ ok: true, done: true, reply: null });
    for (const piece of ['', 'q', 'r', 'b']) {
      expect(checkMove(promotion, fen, 0, move + piece)).toEqual({ ok: false, done: false, reply: null });
    }
  });
  it('la coronación incorrecta falla aunque también dé mate', () => {
    const fen = 'k7/1PK5/8/8/8/4B3/8/8 w - - 0 1';
    expect(checkMove({ ...puzzle, solution: ['b7b8q'] }, fen, 0, 'b7b8r')).toEqual({ ok: false, done: false, reply: null });
  });
  it('una subcoronación correcta intermedia conserva la respuesta del rival', () => {
    expect(checkMove({ ...puzzle, solution: ['a7a8n', 'h8g8', 'a8b6'] },
      '7k/P7/8/8/8/8/8/7K w - - 0 1', 0, 'a7a8n')).toEqual({ ok: true, done: false, reply: 'h8g8' });
  });

});

describe('Elo de puzles', () => {
  it('sube al resolver y baja al fallar, más contra puzles difíciles', () => {
    expect(updateRating(1200, 1200, true)).toBe(1212);
    expect(updateRating(1200, 1200, false)).toBe(1188);
    expect(updateRating(1200, 1600, true) - 1200).toBeGreaterThan(updateRating(1200, 1000, true) - 1200);
  });
  it('solo cuenta el primer intento; racha y mejor racha', () => {
    let p = { rating: START_RATING, results: {}, streak: 0, best: 0 };
    p = recordResult(p, puzzle, true);
    const again = recordResult(p, puzzle, false);
    expect(again).toBe(p);
    p = recordResult(p, twoMover, true);
    expect(p).toMatchObject({ streak: 2, best: 2 });
    expect(progressSummary(p)).toEqual({ attempted: 2, solved: 2, rate: 100 });
  });
});

describe('pickNext y filtros', () => {
  const list = [
    { id: 'a', rating: 1000, type: 'error', motif: 'captura' },
    { id: 'b', rating: 1250, type: 'oportunidad', motif: 'ataque_doble' },
    { id: 'c', rating: 1800, type: 'error', motif: null },
  ];
  it('elige el no intentado más cercano a tu Elo', () => {
    expect(pickNext(list, { rating: 1200, results: {} }).id).toBe('b');
    expect(pickNext(list, { rating: 1200, results: { b: { result: 'solved' } } }).id).toBe('a');
  });
  it('si no quedan nuevos, repasa los fallados', () => {
    const results = { a: { result: 'solved' }, b: { result: 'failed' }, c: { result: 'solved' } };
    expect(pickNext(list, { rating: 1200, results }).id).toBe('b');
  });
  it('filtra por tipo y por tema', () => {
    expect(filterPuzzles(list, { type: 'error' }).map((p) => p.id)).toEqual(['a', 'c']);
    expect(filterPuzzles(list, { motif: 'null' }).map((p) => p.id)).toEqual(['c']);
  });
});

describe('readProgress', () => {
  it('conserva el historial de los puzles de la primera versión (ids sin la fuente)', () => {
    const store = {};
    store['escaque:puzzles'] = JSON.stringify({ rating: 1310, streak: 2, best: 4, results: { 'Demo0016-30': { result: 'solved' }, 'lichess:Ab12Cd34-5': { result: 'failed' } } });
    const prev = globalThis.localStorage;
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: () => {} };
    try {
      expect(readProgress()).toEqual({ rating: 1310, streak: 2, best: 4, results: { 'lichess:Demo0016-30': { result: 'solved' }, 'lichess:Ab12Cd34-5': { result: 'failed' } } });
    } finally {
      globalThis.localStorage = prev;
    }
  });
});
