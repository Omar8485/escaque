import { describe, it, expect } from 'vitest';
import {
  parseInfo,
  parseBestMove,
  sideToMove,
  toWhitePerspective,
  winPercent,
  winPercentFor,
  formatScore,
  isMateScore,
} from './uci.js';

// Líneas reales capturadas de Stockfish 17.1 Lite WASM Multithreaded (public/stockfish).
const AFTER_E4_D14 =
  'info depth 14 seldepth 27 multipv 1 score cp -44 nodes 86753 nps 355545 hashfull 28 time 244 pv e7e6 d2d4 d7d5 b1c3 f8b4 e4d5 e6d5 f1d3 g8f6 g1f3 e8g8 e1g1 f8e8 c1g5 c7c6 f1e1 e8e1 d1e1';
const MATE_FOR_BLACK =
  'info depth 10 seldepth 2 multipv 1 score mate 1 nodes 301 nps 150500 hashfull 0 time 2 pv d8h4';
const MATED = 'info depth 0 score mate 0';
const MULTIPV_3 =
  'info depth 10 seldepth 15 multipv 3 score cp 39 nodes 13448 nps 517230 hashfull 3 time 26 pv g1f3 d7d5 d2d4 g8f6 c2c4 d5c4 b1c3 c8f5 e2e3 e7e6 f1c4 f8e7 e1g1';
const LOWERBOUND =
  'info depth 18 seldepth 24 multipv 1 score cp 41 lowerbound nodes 512345 nps 401234 hashfull 190 time 1277 pv e2e4';
const UPPERBOUND =
  'info depth 18 seldepth 24 multipv 1 score cp 22 upperbound nodes 498765 nps 400000 hashfull 185 time 1247 pv e2e4';
const WDL =
  'info depth 12 seldepth 15 multipv 1 score cp 31 wdl 52 940 8 nodes 40000 nps 350000 hashfull 9 time 114 pv e2e4 e7e5';

const FEN_AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const FEN_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parseInfo', () => {
  it('parsea una línea cp completa', () => {
    const info = parseInfo(AFTER_E4_D14);
    expect(info).toMatchObject({
      depth: 14,
      seldepth: 27,
      multipv: 1,
      nodes: 86753,
      nps: 355545,
      time: 244,
      score: { type: 'cp', value: -44 },
      bound: null,
    });
    expect(info.pv).toHaveLength(18);
    expect(info.pv[0]).toBe('e7e6');
    expect(info.pv.at(-1)).toBe('d1e1');
  });

  it('parsea mate y multipv', () => {
    expect(parseInfo(MATE_FOR_BLACK)).toMatchObject({ depth: 10, score: { type: 'mate', value: 1 }, pv: ['d8h4'] });
    expect(parseInfo(MULTIPV_3)).toMatchObject({ multipv: 3, score: { type: 'cp', value: 39 } });
  });

  it('parsea la línea de posición mateada (depth 0, mate 0, sin pv)', () => {
    expect(parseInfo(MATED)).toMatchObject({ depth: 0, multipv: 1, score: { type: 'mate', value: 0 }, pv: [] });
  });

  it('marca lowerbound / upperbound', () => {
    expect(parseInfo(LOWERBOUND)).toMatchObject({ bound: 'lower', score: { type: 'cp', value: 41 } });
    expect(parseInfo(UPPERBOUND)).toMatchObject({ bound: 'upper', score: { type: 'cp', value: 22 } });
  });

  it('parsea wdl sin confundirlo con otros campos', () => {
    expect(parseInfo(WDL)).toMatchObject({ wdl: [52, 940, 8], nodes: 40000, pv: ['e2e4', 'e7e5'] });
  });

  it('ignora líneas sin score o que no son info', () => {
    expect(parseInfo('info string NNUE evaluation using nn-9067e33176e8.nnue (11MiB, (22528, 256, 15, 32, 1))')).toBeNull();
    expect(parseInfo('info depth 20 currmove e2e4 currmovenumber 1')).toBeNull();
    expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeNull();
    expect(parseInfo('readyok')).toBeNull();
    expect(parseInfo(undefined)).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('parsea bestmove con y sin ponder', () => {
    expect(parseBestMove('bestmove e7e6 ponder d2d4')).toEqual({ bestMove: 'e7e6', ponder: 'd2d4' });
    expect(parseBestMove('bestmove d8h4')).toEqual({ bestMove: 'd8h4', ponder: null });
    expect(parseBestMove('bestmove e7e8q')).toEqual({ bestMove: 'e7e8q', ponder: null });
  });

  it('bestmove (none) → null', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ bestMove: null, ponder: null });
  });

  it('devuelve null si no es bestmove', () => {
    expect(parseBestMove(AFTER_E4_D14)).toBeNull();
  });
});

describe('normalización a perspectiva de blancas', () => {
  it('lee el turno del FEN', () => {
    expect(sideToMove(FEN_START)).toBe('w');
    expect(sideToMove(FEN_AFTER_E4)).toBe('b');
    expect(() => sideToMove('8/8/8')).toThrow();
  });

  it('con blancas al turno no cambia el signo', () => {
    expect(toWhitePerspective({ type: 'cp', value: 31 }, 'w')).toEqual({ type: 'cp', value: 31 });
  });

  it('tras 1.e4 (negras al turno) cp -44 significa +0.44 para blancas', () => {
    const raw = parseInfo(AFTER_E4_D14).score;
    const score = toWhitePerspective(raw, sideToMove(FEN_AFTER_E4));
    expect(score).toEqual({ type: 'cp', value: 44 });
    expect(formatScore(score)).toBe('+0.44');
  });

  it('mate 1 con negras al turno es mate de negras', () => {
    expect(toWhitePerspective({ type: 'mate', value: 1 }, 'b')).toEqual({ type: 'mate', value: -1, winner: 'b' });
    expect(toWhitePerspective({ type: 'mate', value: -3 }, 'b')).toEqual({ type: 'mate', value: 3, winner: 'w' });
    expect(toWhitePerspective({ type: 'mate', value: 2 }, 'w')).toEqual({ type: 'mate', value: 2, winner: 'w' });
  });

  it('mate 0: gana el lado que NO mueve', () => {
    expect(toWhitePerspective({ type: 'mate', value: 0 }, 'w')).toEqual({ type: 'mate', value: 0, winner: 'b' });
    expect(toWhitePerspective({ type: 'mate', value: 0 }, 'b')).toEqual({ type: 'mate', value: 0, winner: 'w' });
  });

  it('no produce -0', () => {
    expect(Object.is(toWhitePerspective({ type: 'cp', value: 0 }, 'b').value, 0)).toBe(true);
  });
});

describe('formatScore', () => {
  it('formatea centipeones', () => {
    expect(formatScore({ type: 'cp', value: 35 })).toBe('+0.35');
    expect(formatScore({ type: 'cp', value: -120 })).toBe('-1.20');
    expect(formatScore({ type: 'cp', value: 0 })).toBe('0.00');
  });

  it('formatea mates', () => {
    expect(formatScore({ type: 'mate', value: 3, winner: 'w' })).toBe('M3');
    expect(formatScore({ type: 'mate', value: -2, winner: 'b' })).toBe('-M2');
    expect(formatScore({ type: 'mate', value: 0, winner: 'b' })).toBe('0-1');
    expect(formatScore({ type: 'mate', value: 0, winner: 'w' })).toBe('1-0');
  });

  it('null → cadena vacía', () => {
    expect(formatScore(null)).toBe('');
  });
});

describe('winPercent (modelo Lichess)', () => {
  it('0 cp = 50%', () => {
    expect(winPercent({ type: 'cp', value: 0 })).toBeCloseTo(50, 10);
  });

  it('coincide con la fórmula de Lichess', () => {
    const expected = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * 300)) - 1);
    expect(winPercent({ type: 'cp', value: 300 })).toBeCloseTo(expected, 10);
    expect(winPercent({ type: 'cp', value: 300 })).toBeCloseTo(75.07, 1);
  });

  it('es simétrica', () => {
    expect(winPercent({ type: 'cp', value: -150 })).toBeCloseTo(100 - winPercent({ type: 'cp', value: 150 }), 10);
  });

  it('acota cp a ±1000', () => {
    expect(winPercent({ type: 'cp', value: 5000 })).toBeCloseTo(winPercent({ type: 'cp', value: 1000 }), 10);
    expect(winPercent({ type: 'cp', value: -5000 })).toBeCloseTo(winPercent({ type: 'cp', value: -1000 }), 10);
    expect(winPercent({ type: 'cp', value: 1000 })).toBeLessThan(100);
  });

  it('mate → 100 / 0', () => {
    expect(winPercent({ type: 'mate', value: 4, winner: 'w' })).toBe(100);
    expect(winPercent({ type: 'mate', value: -1, winner: 'b' })).toBe(0);
    expect(winPercent({ type: 'mate', value: 0, winner: 'b' })).toBe(0);
  });

  it('winPercentFor invierte para negras', () => {
    expect(winPercentFor({ type: 'mate', value: -1, winner: 'b' }, 'b')).toBe(100);
    expect(winPercentFor({ type: 'cp', value: 200 }, 'b')).toBeCloseTo(100 - winPercent({ type: 'cp', value: 200 }), 10);
  });

  it('isMateScore', () => {
    expect(isMateScore({ type: 'mate', value: 0, winner: 'w' })).toBe(true);
    expect(isMateScore({ type: 'cp', value: 0 })).toBe(false);
    expect(isMateScore(null)).toBe(false);
  });
});
