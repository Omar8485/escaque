import { describe, it, expect } from 'vitest';
import { winPercent } from '../engine/uci.js';
import {
  accuracyWinPercent,
  classifiedMoveAccuracy,
  gameAccuracy,
  moveAccuracy,
  playerGameAccuracy,
} from './accuracy.js';

const cp = (value) => ({ type: 'cp', value });
const mate = (value, winner) => ({ type: 'mate', value, winner });

// Valores de referencia calculados con un port independiente (Python) de lila
// AccuracyPercent.scala + scalalib Maths (ver informe de T1).
describe('moveAccuracy (Lichess, con bonificación de incertidumbre +1)', () => {
  it('100 si no pierde Win%', () => {
    expect(moveAccuracy(50, 50)).toBe(100);
    expect(moveAccuracy(40, 70)).toBe(100);
  });

  it('valores de la curva', () => {
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.57982845372067, 10);
    expect(moveAccuracy(59.5, 44.1)).toBeCloseTo(50.59380842175627, 10);
  });

  it('acotada a [0, 100] y decreciente con la pérdida', () => {
    expect(moveAccuracy(50.0001, 50)).toBe(100); // raw ≈ 100 + 1 → 100
    expect(moveAccuracy(100, 0)).toBe(0); // raw ≈ −0,84 → 0
    expect(moveAccuracy(50, 45)).toBeGreaterThan(moveAccuracy(50, 40));
  });
});

describe('accuracyWinPercent', () => {
  it('cp igual que winPercent; mate como ±1000 cp', () => {
    expect(accuracyWinPercent(cp(35))).toBe(winPercent(cp(35)));
    expect(accuracyWinPercent(mate(3, 'w'))).toBe(winPercent(cp(1000)));
    expect(accuracyWinPercent(mate(-1, 'b'))).toBe(winPercent(cp(-1000)));
    expect(accuracyWinPercent(mate(0, 'w'))).toBeCloseTo(97.5, 1);
    expect(accuracyWinPercent(null)).toBeNull();
  });
});

describe('classifiedMoveAccuracy', () => {
  it('en perspectiva del color que movió', () => {
    // Blancas: +1,04 → −0,64 (4.Nxe5? de §6.2)
    expect(classifiedMoveAccuracy({ color: 'w', evalBefore: cp(104), evalAfter: cp(-64) })).toBeCloseTo(
      moveAccuracy(winPercent(cp(104)), winPercent(cp(-64))),
      10,
    );
    // Negras: que la eval de blancas suba es pérdida para negras
    const black = classifiedMoveAccuracy({ color: 'b', evalBefore: cp(0), evalAfter: cp(200) });
    expect(black).toBeCloseTo(moveAccuracy(50, 100 - winPercent(cp(200))), 10);
    expect(black).toBeLessThan(100);
    expect(classifiedMoveAccuracy({ color: 'b', evalBefore: cp(0), evalAfter: cp(-200) })).toBe(100);
  });

  it('pasar de mate a +10 no penaliza (ambos cuentan como ±1000 cp)', () => {
    expect(classifiedMoveAccuracy({ color: 'w', evalBefore: mate(2, 'w'), evalAfter: cp(1000) })).toBe(100);
  });
});

describe('gameAccuracy (media ponderada por volatilidad + media armónica)', () => {
  const C = [20, 15, 60, -80, -70, -60, -250, 100, 90, 95, -30, 400, 380, 390, 120, 140, 130, 600, 590, 1200, 1100, 1150, 1000, 1000];
  const D = [
    -200, -63, 74, -190, -53, 119, -180, -43, 94, -170, 37, 104, -160, -23, 114, -45, -13, 124, -140, -3, 274,
    -130, 7, 144, -120, 192, 154, -110, 27, 164, 110, 37, 174, -90, 47, 429, -80, 57, 194, -70, 347, -197, -60, 77,
    -187,
  ];

  it('partida corta (ventana 2)', () => {
    const r = gameAccuracy(C.map(cp), 'w');
    expect(r.w).toBeCloseTo(94.23271743011765, 9);
    expect(r.b).toBeCloseTo(98.43200224303501, 9);
  });

  it('3 posiciones (ventana más larga que la partida)', () => {
    const r = gameAccuracy(C.slice(0, 3).map(cp), 'w');
    expect(r.w).toBeCloseTo(98.95495214865517, 9);
    expect(r.b).toBeCloseTo(84.05553177062774, 9);
  });

  it('partida de 45 posiciones (ventana 4), empezando por blancas o por negras', () => {
    const w = gameAccuracy(D.map(cp), 'w');
    expect(w.w).toBeCloseTo(61.81346869125878, 9);
    expect(w.b).toBeCloseTo(65.75308226448074, 9);
    const b = gameAccuracy(D.map(cp), 'b');
    expect(b.w).toBeCloseTo(68.61757217323164, 9);
    expect(b.b).toBeCloseTo(67.6682271025459, 9);
  });

  it('todas perfectas → 100; sin jugadas de un color → null', () => {
    expect(gameAccuracy([cp(20), cp(30), cp(25), cp(40)], 'w')).toEqual({ w: 100, b: 100 });
    expect(gameAccuracy([cp(20), cp(10)], 'w')).toEqual({ w: expect.any(Number), b: null });
    expect(gameAccuracy([cp(20)], 'w')).toEqual({ w: null, b: null });
    expect(gameAccuracy([], 'w')).toEqual({ w: null, b: null });
  });

  it('una posición sin evaluación descarta las jugadas que la tocan', () => {
    const r = gameAccuracy([cp(20), null, cp(25), cp(400)], 'w');
    // Solo queda la jugada de blancas 25 → 400 (sin pérdida); las de i=0 e i=1 se descartan.
    expect(r).toEqual({ w: 100, b: null });
  });
});

describe('playerGameAccuracy', () => {
  it('reconstruye la secuencia desde las jugadas del jugador', () => {
    const C = [20, 15, 60, -80, -70, -60, -250, 100, 90, 95, -30, 400, 380, 390, 120, 140, 130, 600, 590, 1200];
    // Jugadas de blancas: posiciones (0→1), (2→3), …
    const moves = [];
    for (let i = 0; i + 1 < C.length; i += 2) {
      moves.push({ color: 'w', evalBefore: cp(C[i]), evalAfter: cp(C[i + 1]) });
    }
    expect(playerGameAccuracy(moves)).toBeCloseTo(gameAccuracy(C.map(cp), 'w').w, 12);
    expect(playerGameAccuracy([])).toBeNull();
  });

  it('jugador con negras', () => {
    const moves = [
      { color: 'b', evalBefore: cp(30), evalAfter: cp(35) },
      { color: 'b', evalBefore: cp(300), evalAfter: cp(290) },
    ];
    expect(playerGameAccuracy(moves)).toBeCloseTo(gameAccuracy([30, 35, 300, 290].map(cp), 'b').b, 12);
  });
});
