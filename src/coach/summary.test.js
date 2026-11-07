import { describe, it, expect } from 'vitest';
import { lineFromSans, moveKey, summarizeGame, fullMoveCount, positionScores, formatDuration, emptyCounts, START_FEN } from './summary.js';
import { classifyMove } from '../engine/classify.js';
import { gameAccuracy } from './accuracy.js';

const cp = (value) => ({ type: 'cp', value });
const analysis = (fen, score, bestMove = null) => ({ fen, depth: 15, lines: [{ score, pv: bestMove ? [bestMove] : [] }], bestMove });

// Pastor: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
const SCHOLAR = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];

/** Clasificaciones sintéticas con evaluaciones encadenadas (la de después = la de antes de la siguiente). */
function classify(line, evals, best = {}) {
  const out = {};
  line.forEach((m, i) => {
    out[moveKey(m)] = classifyMove({
      fenBefore: m.before,
      moveUci: m.uci,
      before: analysis(m.before, evals[i], best[i] ?? m.uci),
      after: analysis(m.after, evals[i + 1]),
    });
  });
  return out;
}

describe('lineFromSans', () => {
  it('reconstruye la línea con UCI, FEN y número de jugada', () => {
    const line = lineFromSans(START_FEN, SCHOLAR);
    expect(line).toHaveLength(7);
    expect(line[0]).toMatchObject({ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', moveNumber: 1 });
    expect(line[1]).toMatchObject({ ply: 2, color: 'b', uci: 'e7e5', moveNumber: 1 });
    expect(line[6]).toMatchObject({ ply: 7, color: 'w', san: 'Qxf7#', uci: 'h5f7', moveNumber: 4 });
    expect(line[1].before).toBe(line[0].after);
  });

  it('admite un FEN inicial y conserva la pieza de coronación en la UCI', () => {
    const line = lineFromSans('8/4P3/8/8/8/k7/8/K7 w - - 0 1', ['e8=N']);
    expect(line[0].uci).toBe('e7e8n');
    expect(moveKey(line[0])).toBe('8/4P3/8/8/8/k7/8/K7 w - - 0 1|e7e8n');
  });

  it('se detiene en una jugada ilegal', () => {
    expect(lineFromSans(START_FEN, ['e4', 'Ke3', 'd4'])).toHaveLength(1);
  });
});

describe('fullMoveCount', () => {
  it('cuenta jugadas completas según quién empieza', () => {
    expect(fullMoveCount(0)).toBe(0);
    expect(fullMoveCount(1)).toBe(1);
    expect(fullMoveCount(7)).toBe(4);
    expect(fullMoveCount(8)).toBe(4);
    expect(fullMoveCount(1, 'b')).toBe(1);
    expect(fullMoveCount(2, 'b')).toBe(2);
    expect(fullMoveCount(3, 'b')).toBe(2);
  });
});

describe('summarizeGame', () => {
  const line = lineFromSans(START_FEN, SCHOLAR);
  // Evaluaciones de las 8 posiciones; Nf6?? pierde todo y Qxf7# da mate.
  const evals = [cp(20), cp(30), cp(25), cp(40), cp(35), cp(30), { type: 'mate', value: 1, winner: 'w' }, { type: 'mate', value: 0, winner: 'w' }];
  // La mejor jugada de negras en la 6.ª posición era g6 (no Nf6).
  const classifications = classify(line, evals, { 5: 'g7g6' });

  it('cuenta jugadas, plies y jugadas por color', () => {
    const s = summarizeGame({ line, classifications, playerColor: 'w' });
    expect(s.plies).toBe(7);
    expect(s.fullMoves).toBe(4);
    expect(s.movesByColor).toEqual({ w: 4, b: 3 });
    expect(s.rivalColor).toBe('b');
  });

  it('cuenta las etiquetas por color', () => {
    const s = summarizeGame({ line, classifications });
    expect(s.counts.b.Blunder).toBe(1);
    expect(s.counts.w.Best).toBe(4);
    expect(s.counts.b.Best).toBe(2);
    expect(s.classified).toEqual({ w: 4, b: 3 });
    expect(s.pending).toBe(0);
    expect(s.complete).toBe(true);
    const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);
    expect(total(s.counts.w)).toBe(s.movesByColor.w);
    expect(total(s.counts.b)).toBe(s.movesByColor.b);
  });

  it('precisión por color con la fórmula de Lichess', () => {
    const s = summarizeGame({ line, classifications });
    expect(s.accuracy).toEqual(gameAccuracy(evals, 'w'));
    expect(s.accuracy.w).toBeGreaterThan(s.accuracy.b);
    expect(s.accuracy.b).toBeLessThan(80);
  });

  it('sin todas las clasificaciones: pendientes y sin precisión', () => {
    const partial = { ...classifications };
    delete partial[moveKey(line[6])];
    const s = summarizeGame({ line, classifications: partial });
    expect(s.pending).toBe(1);
    expect(s.complete).toBe(false);
    expect(s.accuracy).toEqual({ w: null, b: null });
    expect(s.classified.w).toBe(3);
  });

  it('ignora clasificaciones de jugadas que ya no están en la línea (tras Deshacer)', () => {
    const shorter = line.slice(0, 5);
    const s = summarizeGame({ line: shorter, classifications });
    expect(s.plies).toBe(5);
    expect(s.counts.b.Blunder).toBe(0);
  });

  it('tiempos: total = suma de los dos relojes', () => {
    const s = summarizeGame({ line, classifications, timeUsedMs: { w: 12_300, b: 4_700 }, durationMs: 25_000 });
    expect(s.time).toEqual({ totalMs: 17_000, w: 12_300, b: 4_700 });
    expect(s.durationMs).toBe(25_000);
  });

  it('partida vacía', () => {
    const s = summarizeGame({ line: [] });
    expect(s.plies).toBe(0);
    expect(s.fullMoves).toBe(0);
    expect(s.counts.w).toEqual(emptyCounts());
    expect(s.accuracy).toEqual({ w: null, b: null });
  });

  it('empieza con negras (FEN)', () => {
    const l = lineFromSans('4k3/8/8/8/8/8/4P3/4K3 b - - 0 10', ['Kd7', 'e4', 'Kc6']);
    const s = summarizeGame({ line: l });
    expect(s.fullMoves).toBe(2);
    expect(s.movesByColor).toEqual({ w: 1, b: 2 });
  });
});

describe('positionScores', () => {
  it('usa la evaluación de después de la jugada anterior si falta la de antes', () => {
    const a = { evalBefore: cp(1), evalAfter: cp(2) };
    const b = { evalBefore: null, evalAfter: cp(3) };
    expect(positionScores([a, b])).toEqual([cp(1), cp(2), cp(3)]);
    expect(positionScores([a, null])).toEqual([cp(1), cp(2), null]);
  });
});

describe('formatDuration', () => {
  it('formatea minutos y horas', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('—');
  });
});
