import { describe, expect, it } from 'vitest';
import { duePuzzles, recordReview, reviewFor } from './review.js';
import { recordResult, readProgress, writeProgress } from './puzzleLogic.js';

const DAY = 86400000;
const NOW = new Date('2026-11-02T13:00:00Z');
const puzzle = { id: 'a', rating: 1200 };
const empty = () => ({ rating: 1200, streak: 0, best: 0, results: {} });

describe('repaso Leitner', () => {
  it('programa el primer fallo para mañana y no repasa los aciertos nuevos', () => {
    expect(recordReview(empty(), 'a', true, NOW)).toEqual(empty());
    const p = recordReview(empty(), 'a', false, NOW);
    expect(p.reviews.a).toEqual({ box: 0, dueAt: NOW.getTime() + DAY });
    expect(duePuzzles([puzzle], p, NOW)).toEqual([]);
    expect(duePuzzles([puzzle], p, new Date(NOW.getTime() + DAY))).toEqual([puzzle]);
  });
  it('aumenta 3, 7, 14, 30, 60 días al resolver y limita el intervalo', () => {
    let p = recordReview(empty(), 'a', false, NOW);
    for (const days of [3, 7, 14, 30, 60, 60]) {
      p = recordReview(p, 'a', true, NOW);
      expect(p.reviews.a.dueAt).toBe(NOW.getTime() + days * DAY);
    }
    expect(recordReview(p, 'a', false, NOW).reviews.a).toEqual({ box: 0, dueAt: NOW.getTime() + DAY });
  });
  it('deriva los fallos antiguos sin perder su historial y ordena los pendientes', () => {
    const p = { ...empty(), results: { a: { result: 'failed', date: '2026-10-30' }, b: { result: 'failed', date: '2026-10-28' }, c: { result: 'solved' } } };
    const list = [puzzle, { id: 'b' }, { id: 'c' }, { id: 'new' }];
    expect(duePuzzles(list, p, NOW).map((v) => v.id)).toEqual(['b', 'a']);
    expect(reviewFor(p, 'a').dueAt).toBe(Date.parse('2026-10-31'));
    expect(duePuzzles([], p, NOW)).toEqual([]);
    expect(recordReview(p, 'a', true, NOW).results).toEqual(p.results);
  });
  it('los reintentos no cambian el Elo ni la racha ni el resultado original', () => {
    const first = recordResult(empty(), puzzle, false, NOW);
    const reviewed = recordReview(first, 'a', false, NOW);
    const solved = recordReview(recordResult(reviewed, puzzle, true, NOW), 'a', true, NOW);
    expect(solved).toMatchObject({ rating: first.rating, streak: first.streak, best: first.best, results: first.results });
    const another = recordResult(solved, { id: 'b', rating: 1200 }, true, NOW);
    expect(another.reviews).toEqual(solved.reviews);
  });
  it('persiste el repaso y migra también los ids antiguos conservando el Elo', () => {
    const previous = globalThis.localStorage;
    let stored = JSON.stringify({ ...empty(), rating: 1320, results: { 'Ab12Cd34-4': { result: 'failed', date: '2026-11-01' } }, reviews: { 'Ab12Cd34-4': { box: 2, dueAt: 1234 } } });
    globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
    try {
      const progress = readProgress();
      expect(progress.rating).toBe(1320);
      expect(progress.reviews['lichess:Ab12Cd34-4']).toEqual({ box: 2, dueAt: 1234 });
      writeProgress(progress);
      expect(readProgress()).toEqual(progress);
    } finally { globalThis.localStorage = previous; }
  });
});
