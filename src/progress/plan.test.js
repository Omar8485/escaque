import { describe, expect, it } from 'vitest';
import { generatePlan } from './plan.js';

const game = (id, extra = {}) => ({ id, playerColor: 'w', opening: 'Italian Game', ...extra });
const error = (gameId, extra = {}) => ({ gameId, ply: 5, date: 100, color: 'w', label: 'Blunder', phase: 'final', motif: 'ataque_doble', ...extra });
const weakness = (kind, key, evidence) => ({ kind, key, count: evidence.length, evidence });
const metric = (weaknesses, extra = {}) => ({ weaknesses, games: [{ game: game('g1') }], openings: [], ...extra });
const puzzle = (id, gameId, motif = 'ataque_doble') => ({ id, gameId, motif, solution: ['e2e4'] });

describe('generatePlan: acciones trazables a las partidas', () => {
  it('no recomienda sin datos, análisis ni evidencia', () => {
    expect(generatePlan()).toEqual([]);
    expect(generatePlan({})).toEqual([]);
    expect(generatePlan(metric([]))).toEqual([]);
    expect(generatePlan(metric([weakness('phase', 'final', [])]))).toEqual([]);
    expect(generatePlan(metric([weakness('phase', 'final', [error('missing')])]))).toEqual([]);
  });

  it('elige hasta cinco puzles del motivo y partidas de la debilidad', () => {
    const evidence = [error('g1')];
    const metrics = metric([weakness('motif', 'ataque_doble', evidence)]);
    const puzzles = [...Array.from({ length: 7 }, (_, i) => puzzle(`p${i}`, 'g1')),
      puzzle('other-game', 'g2'), puzzle('other-motif', 'g1', 'captura'), { ...puzzle('empty', 'g1'), solution: [] }];
    const [action] = generatePlan(metrics, { puzzles });
    expect(action).toMatchObject({ type: 'puzzles', weaknessId: 'motif:ataque_doble',
      titleKey: 'progress.plan.puzzles', vars: { count: 5 }, evidence,
      target: { motif: 'ataque_doble', gameIds: ['g1'], puzzleIds: ['p0', 'p1', 'p2', 'p3', 'p4'], limit: 5 } });
  });

  it('sin puzles revisa errores graves concretos; no inventa puzles de otros motivos', () => {
    const metrics = metric([weakness('motif', 'ataque_doble', [error('g1')])]);
    expect(generatePlan(metrics, { puzzles: [puzzle('p1', 'g1', 'captura')] })[0])
      .toMatchObject({ type: 'review', target: { gameId: 'g1', ply: 5 } });
    expect(generatePlan(metric([weakness('motif', 'ataque_doble', [error('g1', { label: 'Mistake' })])]))).toEqual([]);
  });

  it('revisa hasta tres errores graves recientes sin duplicados ni jugadas del rival', () => {
    const evidence = [error('g1', { ply: 1, date: 1 }), error('g1', { ply: 5 }), error('g1', { ply: 5 }),
      error('g1', { ply: 7 }), error('g1', { ply: 3 }), error('g1', { ply: 0 }),
      error('g1', { ply: 9, color: 'b' }), error('g1', { ply: 11, label: 'Good' })];
    const [action] = generatePlan(metric([weakness('phase', 'final', evidence)]));
    expect(action.target).toEqual({ gameId: 'g1', ply: 7,
      targets: [{ gameId: 'g1', ply: 7 }, { gameId: 'g1', ply: 5 }, { gameId: 'g1', ply: 3 }] });
    expect(action.vars.count).toBe(3);
  });

  it('no recomienda aperturas sin nombre, color ni tres partidas de evidencia', () => {
    const metrics = metric([weakness('opening', 'w:C50', [error('g1', { label: 'Mistake' })])], {
      openings: [{ key: 'w:C50', name: 'Italian Game', color: 'w', games: 30 }],
    });
    expect(generatePlan(metrics)).toEqual([]);
    expect(generatePlan({ ...metrics, openings: [{ ...metrics.openings[0], name: null }] })).toEqual([]);
    expect(generatePlan({ ...metrics, openings: [{ ...metrics.openings[0], color: null }] })).toEqual([]);
  });

  it('practica con nivel seis y color sustentado sin prometer forzar una apertura', () => {
    const games = ['g1', 'g2', 'g3'].map((id) => game(id, { playerColor: 'b', opening: 'Sicilian Defense' }));
    const evidence = games.map(({ id }) => error(id, { color: 'b', label: 'Mistake' }));
    const metrics = metric([weakness('opening', 'b:B20', evidence)], {
      games: [], openings: [{ key: 'b:B20', name: 'Sicilian Defense', color: 'b', games: 3 }],
    });
    const [action] = generatePlan(metrics, { games });
    expect(action).toMatchObject({ type: 'practice', weaknessId: 'opening:b:B20', evidence,
      titleKey: 'progress.plan.practice', vars: { opening: 'Sicilian Defense' },
      target: { level: 6, color: 'b', opening: 'Sicilian Defense' } });
    expect(generatePlan(metrics, { games: games.map((g) => ({ ...g, opening: 'Other opening' })) })).toEqual([]);
  });

  it('se limita a tres debilidades, sin acciones duplicadas ni mutar entradas', () => {
    const weaknesses = ['final', 'apertura', 'medio juego', 'extra'].map((key, i) => weakness('phase', key, [error('g1', { ply: i * 2 + 1 })]));
    const metrics = metric(weaknesses);
    const before = structuredClone(metrics);
    expect(generatePlan(metrics)).toHaveLength(3);
    expect(metrics).toEqual(before);
    expect(generatePlan(metric([weaknesses[0], weaknesses[0]]))).toHaveLength(1);
  });
});


it('deduplica revisiones del mismo conjunto exacto, pero conserva acciones de otro tipo', () => {
  const evidence = [error('g1', { ply: 3 }), error('g1', { ply: 5 })];
  const metrics = metric([
    weakness('phase', 'final', evidence),
    weakness('opening', 'w:C50', [...evidence].reverse()),
    weakness('motif', 'ataque_doble', evidence),
  ]);
  const actions = generatePlan(metrics, { puzzles: [puzzle('p1', 'g1')] });
  expect(actions.map((action) => action.type)).toEqual(['review', 'puzzles']);
  expect(actions[0].target.targets).toEqual([{ gameId: 'g1', ply: 5 }, { gameId: 'g1', ply: 3 }]);
  // Un conjunto que solo se solapa sigue siendo una recomendación distinta.
  const overlap = metric([metrics.weaknesses[0], weakness('phase', 'apertura', [error('g1', { ply: 3 })])]);
  expect(generatePlan(overlap)).toHaveLength(2);
});
