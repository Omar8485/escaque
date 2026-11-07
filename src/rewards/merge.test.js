import { describe, expect, it } from 'vitest';
import { mergeRewards, sameValue } from './merge.js';
import { applyXpEvent, emptyXpState, XP_RULES } from './xp.js';
import { applyDailyEvent, configureDailyGoal, createDailyState, getDailyStatus } from './daily.js';
import { initialAchievements, reduceAchievements } from './achievements.js';

const TZ = 'America/Guayaquil';
const at = (date) => Date.parse(`${date}T17:00:00Z`);
const model = () => ({ xp: emptyXpState(), daily: createDailyState(), achievements: initialAchievements() });
/** Aplica un evento como lo hace runtime.js (XP, día y logros). */
function play(state, type, data, date) {
  const now = at(date);
  const daily = applyDailyEvent(state.daily, { ...data, type }, { now, timeZone: TZ });
  const xp = applyXpEvent(state.xp, { type, data }, { now, timeZone: TZ });
  const achievements = reduceAchievements(state.achievements, { type, data: { ...data, daily: getDailyStatus(daily, { now, timeZone: TZ }) }, at: now }, now).state;
  return { ...state, xp, daily, achievements };
}
const win = (id) => ({ id, plies: 3, playerColor: 'w', level: 2, result: { reason: 'checkmate', winner: 'w' } });

describe('fusión de recompensas entre dispositivos', () => {
  it('un navegador nuevo (estado vacío pero más reciente) no borra lo del otro dispositivo', () => {
    let a = model();
    a = play(a, 'training-finished', win('escaque:g1'), '2026-11-02');
    a = play(a, 'puzzle-result', { id: 'p1', solved: true, firstTry: true }, '2026-11-02');
    const fresh = { ...model(), achievements: { ...initialAchievements(), hydrated: true } };
    const merged = mergeRewards(fresh, a);
    expect(merged.xp.xp).toBe(a.xp.xp);
    expect(merged.xp.awards).toEqual(a.xp.awards);
    expect(merged.daily.days).toEqual(a.daily.days);
    expect(merged.achievements.unlocked.firstGame).toEqual(a.achievements.unlocked.firstGame);
    expect(merged.achievements.hydrated).toBe(true);
  });

  it('suma lo conseguido en cada dispositivo y no cuenta dos veces el mismo premio', () => {
    let a = play(model(), 'training-finished', win('escaque:g1'), '2026-11-02');
    let b = play(model(), 'puzzle-result', { id: 'p1', solved: true, firstTry: false }, '2026-11-03');
    b = play(b, 'training-finished', win('escaque:g1'), '2026-11-03'); // misma partida (ya sincronizada)
    a = play(a, 'review-completed', { id: 'r' }, '2026-11-02');
    const merged = mergeRewards(a, b);
    const expected = XP_RULES.trainingBase + 2 * XP_RULES.rivalPerLevel + XP_RULES.trainingWin + XP_RULES.puzzleSolved + XP_RULES.reviewCompleted;
    expect(merged.xp.xp).toBe(expected);
    // El premio de la partida conserva la fecha más antigua (la del primer dispositivo).
    expect(merged.xp.awards['training:escaque:g1:base'].awardedAt).toBe(at('2026-11-02'));
    expect(Object.keys(merged.daily.days).sort()).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('une los días: la racha cuenta lo entrenado en cualquiera de los dos', () => {
    let a = model();
    let b = model();
    for (const d of ['2026-11-02', '2026-11-04', '2026-11-06']) a = play(a, 'puzzle-result', { id: `a${d}`, solved: true }, d);
    for (const d of ['2026-11-03', '2026-11-05', '2026-11-07', '2026-11-08']) b = play(b, 'puzzle-result', { id: `b${d}`, solved: true }, d);
    const merged = mergeRewards(a, b);
    expect(getDailyStatus(merged.daily, { now: at('2026-11-08'), timeZone: TZ }).currentStreak).toBe(7);
    // Mismo día en los dos: unión sin duplicados.
    const c = play(model(), 'puzzle-result', { id: 'a2026-11-02', solved: true }, '2026-11-02');
    expect(mergeRewards(a, c).daily.days['2026-11-02'].puzzles).toEqual(['a2026-11-02']);
  });

  it('logros: unión con la fecha más antigua; correcciones de los dos dispositivos se suman', () => {
    const a = { ...model(), achievements: { ...initialAchievements(), unlocked: { firstGame: { unlockedAt: 5 } }, correctedPositions: { 'g1|f1': true, 'g1|f2': true }, counters: { corrections: 2, puzzleStreak: 4 } } };
    const b = { ...model(), achievements: { ...initialAchievements(), unlocked: { firstGame: { unlockedAt: 3 }, rival1: { unlockedAt: 9 } }, correctedPositions: { 'g2|f1': true }, counters: { corrections: 1, puzzleStreak: 0 } } };
    const merged = mergeRewards(a, b);
    expect(merged.achievements.unlocked).toEqual({ firstGame: { unlockedAt: 3 }, rival1: { unlockedAt: 9 } });
    expect(merged.achievements.counters).toEqual({ corrections: 3, puzzleStreak: 4 });
  });

  it('la meta diaria gana por su propia fecha de cambio, no por la del registro', () => {
    const custom = { ...model(), daily: { ...configureDailyGoal(createDailyState(), { games: 2, puzzles: 5 }), goalSetAt: 100 } };
    const newerRecord = model(); // otro dispositivo que nunca cambió la meta
    expect(mergeRewards(newerRecord, custom).daily.goal).toEqual({ games: 2, puzzles: 5 });
    const changedLater = { ...model(), daily: { ...configureDailyGoal(createDailyState(), { games: 0, puzzles: 1 }), goalSetAt: 200 } };
    expect(mergeRewards(custom, changedLater).daily.goal).toEqual({ games: 0, puzzles: 1 });
  });

  it('es idempotente y conmutativa en lo acumulable; conserva campos desconocidos y XP sin premios', () => {
    let a = play(model(), 'training-finished', win('escaque:g1'), '2026-11-02');
    a = { ...a, futureSetting: 'keep', xp: { ...a.xp, xp: a.xp.xp + 20 } };
    const b = play(model(), 'puzzle-result', { id: 'p', solved: true, firstTry: true }, '2026-11-03');
    const ab = mergeRewards(a, b);
    expect(sameValue(mergeRewards(ab, a), ab)).toBe(true);
    expect(sameValue(mergeRewards(ab, b), ab)).toBe(true);
    const ba = mergeRewards(b, a);
    expect(sameValue(ba.xp, ab.xp) && sameValue(ba.daily, ab.daily) && sameValue(ba.achievements.unlocked, ab.achievements.unlocked)).toBe(true);
    expect(ab.futureSetting).toBe('keep');
    expect(ab.xp.xp).toBe(a.xp.xp + XP_RULES.puzzleSolved + XP_RULES.puzzleFirstTry);
    expect(mergeRewards(undefined, a)).toBe(a);
    expect(mergeRewards(a, null)).toBe(a);
  });

  it('sameValue ignora el orden de claves y de listas de ids', () => {
    expect(sameValue({ a: 1, b: ['x', 'y'] }, { b: ['y', 'x'], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});
