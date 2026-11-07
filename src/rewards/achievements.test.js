import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, initialAchievements, reduceAchievements, hydrateHistory } from './achievements.js';

const NOW = Date.UTC(2026, 10, 2, 12);
const score = (value) => ({ type: 'cp', value });
const event = (type, data, at = NOW) => ({ type, data, at });
const award = (state, type, data, at) => reduceAchievements(state, event(type, data, at), NOW);
const game = (extra = {}) => ({ id: 'escaque:g', source: 'escaque', playerColor: 'w', result: '1-0', termination: 'checkmate', rivalLevel: 1, endTime: NOW,
  pgn: '[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0', ...extra });
const moves = () => [1, 3].map((ply) => ({ ply, color: 'w', label: 'Best', evalBefore: score(600), evalAfter: score(600) }));
const finish = (state, overrides = {}, line = moves()) => award(state, 'training-finished', { game: game(overrides), moves: line });

describe('catálogo de logros', () => {
  it('tiene 21 ids estables, únicos y claves traducibles', () => {
    expect(ACHIEVEMENTS).toHaveLength(21);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(21);
    for (const item of ACHIEVEMENTS) {
      expect(item.nameKey).toBe(`rewards.ach.${item.id}.name`);
      expect(item.descriptionKey).toBe(`rewards.ach.${item.id}.description`);
    }
  });
});

describe('partidas y cada rival', () => {
  it('reconoce la primera partida, sus datos de calidad y conserva la fecha inicial', () => {
    const first = finish(initialAchievements());
    expect(first.unlocked).toEqual(expect.arrayContaining(['firstGame', 'cleanGame', 'accuracy90', 'conversion']));
    const again = finish(first.state);
    expect(again.unlocked).toEqual([]);
    expect(again.state.unlocked.firstGame.unlockedAt).toBe(NOW);
  });
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('victoria contra rival %i', (level) => {
    expect(finish(initialAchievements(), { rivalLevel: level }).unlocked).toContain(`rival${level}`);
  });
  it('Atenea tiene además un logro especial; tablas y derrotas no dan logros de victoria', () => {
    expect(finish(initialAchievements(), { rivalLevel: 10 }).unlocked).toContain('athena');
    for (const result of ['1/2-1/2', '0-1']) {
      const ids = finish(initialAchievements(), { rivalLevel: 10, result }).unlocked;
      expect(ids).not.toContain('rival10'); expect(ids).not.toContain('athena'); expect(ids).not.toContain('conversion');
    }
  });
  it('admite negras y mide evaluación desde su perspectiva', () => {
    const line = [2, 4].map((ply) => ({ ply, color: 'b', label: 'Excellent', evalBefore: score(-600), evalAfter: score(-600) }));
    expect(finish(initialAchievements(), { playerColor: 'b', result: '0-1' }, line).unlocked).toEqual(expect.arrayContaining(['accuracy90', 'conversion', 'cleanGame']));
  });
  it('no premia vacío, abandono en primera jugada, sin resultado ni partidas importadas', () => {
    for (const data of [
      { game: game({ pgn: '', result: '*' }), plies: 0 },
      { id: 'x', plies: 1, playerColor: 'w', result: { reason: 'abandon', winner: 'b' } },
      { game: game({ source: 'lichess' }), moves: moves() },
    ]) expect(award(initialAchievements(), 'training-finished', data).unlocked).toEqual([]);
  });
  it('no concede calidad con huecos ni infiere que ausencia de análisis significa sin errores', () => {
    const partial = finish(initialAchievements(), {}, moves().slice(0, 1));
    expect(partial.unlocked).not.toContain('cleanGame'); expect(partial.unlocked).not.toContain('accuracy90');
    const missing = finish(initialAchievements(), {}, moves().map((m) => ({ ...m, label: null })));
    expect(missing.unlocked).not.toContain('cleanGame');
    const enriched = finish(partial.state);
    expect(enriched.unlocked).toEqual(expect.arrayContaining(['cleanGame', 'accuracy90']));
  });
  it('un error grave impide clean; una caída de evaluación impide precisión90; no inventa conversión', () => {
    const bad = moves().map((m) => ({ ...m, label: 'Blunder', evalBefore: score(0), evalAfter: score(-1000) }));
    const ids = finish(initialAchievements(), {}, bad).unlocked;
    expect(ids).not.toContain('cleanGame'); expect(ids).not.toContain('accuracy90'); expect(ids).not.toContain('conversion');
  });
});

describe('actividad y deduplicación', () => {
  it('exige 10 puzles nuevos seguidos a la primera y el fallo reinicia; repetir no suma', () => {
    let state = initialAchievements();
    const solve = (id, solved = true, firstTry = true) => { const r = award(state, 'puzzle-result', { puzzleId: id, solved, firstTry }); state = r.state; return r; };
    for (let i = 0; i < 9; i++) solve(`p${i}`);
    expect(solve('p0').unlocked).toEqual([]); expect(state.counters.puzzleStreak).toBe(9);
    solve('fail', false); expect(state.counters.puzzleStreak).toBe(0);
    solve('assisted', true, false); expect(state.counters.puzzleStreak).toBe(0);
    for (let i = 0; i < 9; i++) solve(`new${i}`);
    expect(solve('tenth').unlocked).toContain('puzzleChain10');
  });
  it('requiere diez correcciones en posiciones distintas y no solo retrocesos', () => {
    let state = initialAchievements();
    for (let i = 0; i < 9; i++) state = award(state, 'correction', { id: `c${i}`, gameId: 'g', key: `fen${i}` }).state;
    state = award(state, 'correction', { id: 'anotherId', gameId: 'g', key: 'fen0' }).state;
    expect(state.counters.corrections).toBe(9);
    expect(award(state, 'correction', { id: 'c9', gameId: 'g', key: 'fen9' }).unlocked).toContain('corrections10');
    expect(award(initialAchievements(), 'takeback', { id: 'back' }).unlocked).toEqual([]);
  });
  it('racha de siete días probada por snapshot diario', () => {
    expect(award(initialAchievements(), 'daily-snapshot', { daily: { bestStreak: 6 } }).unlocked).toEqual([]);
    expect(award(initialAchievements(), 'daily-snapshot', { daily: { bestStreak: 7 } }).unlocked).toContain('streak7');
  });
  it('primera importación, generación y repaso exigen actividad real no solo clicks', () => {
    for (const [type, data, id] of [
      ['import-completed', { added: 1 }, 'firstImport'], ['puzzles-generated', { count: 1 }, 'firstGenerated'],
      ['review-completed', { count: 2, completed: true }, 'firstReview'],
    ]) {
      expect(award(initialAchievements(), type, data).unlocked).toContain(id);
      expect(award(initialAchievements(), type, { count: 0, added: 0 }).unlocked).toEqual([]);
    }
    expect(award(initialAchievements(), 'review-completed', { count: 2, completed: false }).unlocked).toEqual([]);
    expect(award(initialAchievements(), 'plan-action-completed', { count: 5 }).unlocked).toEqual([]);
  });
});

describe('historial existente', () => {
  it('reconoce una sola vez, sin XP ni avisos, sin cambiar registros previos', () => {
    const previous = initialAchievements();
    const snapshot = { games: [game(), game({ id: 'lichess:i', source: 'lichess' })], moves: [{ gameId: 'escaque:g', moves: moves() }],
      puzzles: [{ id: 'p', gameId: 'escaque:g' }], puzzleProgress: { best: 10, streak: 3, results: { p: { result: 'solved' } } }, daily: { bestStreak: 7 } };
    const before = structuredClone(snapshot);
    const first = hydrateHistory(previous, snapshot, NOW);
    expect(first.unlocked).toEqual([]); expect(first.state.hydrated).toBe(true);
    expect(first.state.unlocked).toHaveProperty('firstImport'); expect(first.state.unlocked).toHaveProperty('puzzleChain10');
    expect(first.state.unlocked).toHaveProperty('firstGenerated'); expect(first.state.unlocked).toHaveProperty('streak7');
    expect(first.state).not.toHaveProperty('xp'); expect(previous).toEqual(initialAchievements()); expect(snapshot).toEqual(before);
    expect(hydrateHistory(first.state, snapshot, NOW + 1).state).toBe(first.state);
    expect(award(first.state, 'puzzle-result', { puzzleId: 'p', solved: true, firstTry: true }).state.counters.puzzleStreak).toBe(3);
  });
  it('reconoce diez correcciones antiguas solo con jugada retirada y respuesta mejor distinta', () => {
    const games = Array.from({ length: 10 }, (_, i) => game({ id: `escaque:old${i}`, retractedMoves: [{ takebackUsed: true, uci: 'd2d4', key: 'fen|d2d4' }] }));
    const records = games.map((g) => ({ gameId: g.id, moves: [{ ply: 1, color: 'w', label: 'Best', fenBefore: 'fen', uci: 'e2e4' }] }));
    const result = hydrateHistory(initialAchievements(), { games, moves: records }, NOW);
    expect(result.state.counters.corrections).toBe(10);
    expect(result.state.unlocked.corrections10).toBeDefined();
    expect(result.unlocked).toEqual([]);
  });
  it('nunca inventa corrección desde un retroceso o repaso completo desde un box', () => {
    const result = hydrateHistory(initialAchievements(), { games: [game({ retractedMoves: [{ takebackUsed: true, uci: 'd2d4', key: 'fen|d2d4' }] })],
      moves: [{ gameId: 'escaque:g', moves: [{ ply: 1, color: 'w', label: 'Mistake', fenBefore: 'fen', uci: 'e2e4' }] }], puzzleProgress: { reviews: { p: { box: 2 } } } }, NOW);
    expect(result.state.counters.corrections).toBe(0); expect(result.state.unlocked.firstReview).toBeUndefined();
  });
});

it('a repeated failed puzzle breaks a live first-try chain without farming repeat solves', () => {
  let state = initialAchievements();
  state = reduceAchievements(state, { type: 'puzzle-result', data: { puzzleId: 'old', solved: true, firstTry: true } }).state;
  state = reduceAchievements(state, { type: 'puzzle-result', data: { puzzleId: 'new', solved: true, firstTry: true } }).state;
  expect(state.counters.puzzleStreak).toBe(2);
  state = reduceAchievements(state, { type: 'puzzle-result', data: { puzzleId: 'old', solved: false } }).state;
  expect(state.counters.puzzleStreak).toBe(0);
  state = reduceAchievements(state, { type: 'puzzle-result', data: { puzzleId: 'old', solved: true, firstTry: true } }).state;
  expect(state.counters.puzzleStreak).toBe(0);
});
