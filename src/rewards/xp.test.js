import { describe, expect, it, vi } from 'vitest';
import { applyXpEvent, emptyXpState, levelProgress, rewardDay, XP_RULES } from './xp.js';
import { emitRewardEvent, onRewardEvent } from './events.js';
const NOW = Date.UTC(2026, 10, 2, 3);
const apply = (state, type, data = {}, now = NOW) => applyXpEvent(state, { type, data }, { now, timeZone: 'America/Guayaquil' });
const game = (extras = {}) => ({ gameId: 'game-1', plies: 4, level: 6, playerColor: 'w', result: { reason: 'checkmate', winner: 'w' },
  moves: [{ ply: 1, color: 'w', label: 'Good' }, { ply: 2, color: 'b', label: 'Blunder' }, { ply: 3, color: 'w', label: 'Best' }, { ply: 4, color: 'b', label: 'Good' }], ...extras });

describe('reward XP', () => {
  it('exports an adjustable positive integer table, with first try worth more than a solve', () => {
    expect(Object.isFrozen(XP_RULES)).toBe(true);
    expect(Object.values(XP_RULES).every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    expect(XP_RULES.puzzleSolved + XP_RULES.puzzleFirstTry).toBeGreaterThan(XP_RULES.puzzleSolved);
  });
  it('uses growing exact level boundaries and an honest progress fraction', () => {
    expect(levelProgress(0)).toMatchObject({ level: 1, progress: 0, nextLevelXp: 100 });
    expect(levelProgress(99)).toMatchObject({ level: 1, xpIntoLevel: 99, progress: 0.99 });
    expect(levelProgress(100)).toMatchObject({ level: 2, xpIntoLevel: 0, currentLevelXp: 100, nextLevelXp: 300 });
    expect(levelProgress(299)).toMatchObject({ level: 2, xpIntoLevel: 199, xpForNextLevel: 200 });
    expect(levelProgress(300)).toMatchObject({ level: 3, xpIntoLevel: 0, nextLevelXp: 600 });
    for (let level = 1; level < 100; level++) expect(levelProgress(50 * (level - 1) * level).level).toBe(level);
    expect(levelProgress(-2).level).toBe(1);
    expect(levelProgress(NaN).level).toBe(1);
  });
  it('awards base, rival and win bonuses once per stable game and preserves input', () => {
    const start = emptyXpState();
    const state = apply(start, 'training-finished', game());
    expect(start).toEqual({ xp: 0, awards: {} });
    expect(state.xp).toBe(XP_RULES.trainingBase + 6 * XP_RULES.rivalPerLevel + XP_RULES.trainingWin + XP_RULES.noBlunders);
    expect(apply(state, 'training-finished', game())).toBe(state);
    expect(apply(state, 'training-finished', game({ level: 10 }))).toBe(state);
  });
  it('ignores empty games and abandonment after the first own move but rewards genuine one-ply mates', () => {
    for (const plies of [0, 1, 2]) expect(apply(emptyXpState(), 'training-finished', game({ plies, result: { reason: 'abandon', winner: 'b' } })).xp).toBe(0);
    expect(apply(emptyXpState(), 'training-finished', game({ plies: 1, moves: [{ ply: 1, color: 'w', label: 'Best' }] })).xp).toBeGreaterThan(0);
    expect(apply(emptyXpState(), 'training-finished', game({ plies: 3, result: { reason: 'abandon', winner: 'b' } })).xp).toBeGreaterThan(0);
  });
  it('does not award quality until every own move is classified and ignores rival blunders', () => {
    const pending = game({ moves: [{ ply: 1, color: 'w', label: 'Best' }, { ply: 3, color: 'w', label: null }], classifiedMoves: 1 });
    const state = apply(emptyXpState(), 'training-finished', pending);
    expect(state.awards['training:game-1:quality']).toBeUndefined();
    const complete = apply(state, 'training-finished', game());
    expect(complete.xp - state.xp).toBe(XP_RULES.noBlunders);
    expect(apply(complete, 'training-finished', game())).toBe(complete);
  });
  it('requires classified saved moves, not merely a classified counter or repeated ply', () => {
    const bad = [game({ moves: [], classifiedMoves: 2 }), game({ moves: [{ ply: 1, color: 'w', label: 'Best' }, { ply: 1, color: 'w', label: 'Best' }] }),
      game({ moves: [{ ply: 1, color: 'w', label: 'Best' }, { ply: 3, color: 'w', label: 'Blunder' }] })];
    for (const event of bad) expect(apply(emptyXpState(), 'training-finished', event).awards['training:game-1:quality']).toBeUndefined();
  });
  it('supports black players, persisted PGN result scores and late win enrichment', () => {
    const base = game({ playerColor: 'b', result: '*', moves: [{ ply: 2, color: 'b', label: 'Good' }, { ply: 4, color: 'b', label: 'Best' }] });
    const state = apply(emptyXpState(), 'training-finished', base);
    expect(state.awards['training:game-1:win']).toBeUndefined();
    expect(apply(state, 'training-finished', { ...base, result: '0-1' }).xp - state.xp).toBe(XP_RULES.trainingWin);
  });
  it('cannot farm another base or win by undoing and repeating a mate', () => {
    const won = game({ plies: 1, moves: [{ ply: 1, color: 'w', label: 'Best' }] });
    const state = apply(emptyXpState(), 'training-finished', won);
    expect(apply(state, 'training-finished', won, NOW + 10000)).toBe(state);
    expect(apply(state, 'training-finished', { ...won, gameId: 'different-game' }).xp).toBe(state.xp * 2);
  });
  it('awards a puzzle once, adds first-try bonus only at its original solve, and no XP for failure', () => {
    const initial = emptyXpState();
    expect(apply(initial, 'puzzle-result', { id: 'p', solved: false, firstTry: true })).toBe(initial);
    const solved = apply(initial, 'puzzle-result', { id: 'p', solved: true, firstTry: false });
    expect(solved.xp).toBe(XP_RULES.puzzleSolved);
    expect(apply(solved, 'puzzle-result', { id: 'p', solved: true, firstTry: true })).toBe(solved);
    const perfect = apply(solved, 'puzzle-result', { id: 'p2', solved: true, firstTry: true });
    expect(perfect.xp - solved.xp).toBe(XP_RULES.puzzleSolved + XP_RULES.puzzleFirstTry);
  });
  it('deduplicates corrections by game and position without delimiter collisions', () => {
    const state = apply(emptyXpState(), 'correction', { gameId: 'a:b', key: 'c' });
    expect(apply(state, 'correction', { gameId: 'a:b', key: 'c' })).toBe(state);
    expect(apply(state, 'correction', { gameId: 'a', key: 'b:c' }).xp).toBe(XP_RULES.correction * 2);
    expect(apply(state, 'correction', { gameId: 'new', key: 'c' }).xp).toBe(XP_RULES.correction * 2);
  });
  it('awards review and daily goal at most once per local day', () => {
    expect(rewardDay(NOW, 'America/Guayaquil')).toBe('2026-11-01');
    expect(rewardDay(NOW, 'UTC')).toBe('2026-11-02');
    const review = apply(emptyXpState(), 'review-completed', { id: 'attempt-1' });
    expect(apply(review, 'review-completed', { id: 'attempt-2' })).toBe(review);
    const nextDay = apply(review, 'review-completed', {}, NOW + 86400000);
    expect(nextDay.xp).toBe(2 * XP_RULES.reviewCompleted);
    const goal = apply(nextDay, 'daily-goal');
    expect(goal.xp - nextDay.xp).toBe(XP_RULES.dailyGoal);
    expect(apply(goal, 'daily-goal')).toBe(goal);
  });
  it('ignores malformed events and allows JSON restoration without losing deduplication', () => {
    const initial = emptyXpState();
    expect(apply(initial, 'unknown')).toBe(initial);
    expect(apply(initial, 'correction', {})).toBe(initial);
    expect(apply(initial, 'training-finished', game({ id: undefined, gameId: undefined }))).toBe(initial);
    const state = apply(initial, 'training-finished', game());
    const restored = JSON.parse(JSON.stringify(state));
    expect(apply(restored, 'training-finished', game())).toBe(restored);
  });
});

describe('reward event bus', () => {
  it('delivers data, isolates failing listeners and supports repeated unsubscribe', () => {
    const received = [];
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsubscribeBad = onRewardEvent(() => { throw Error('subscriber failure'); });
    const unsubscribe = onRewardEvent((event) => received.push(event));
    const event = emitRewardEvent('puzzle-result', { id: 'p', solved: true });
    expect(received).toEqual([event]);
    expect(event).toEqual({ type: 'puzzle-result', data: { id: 'p', solved: true } });
    unsubscribe(); unsubscribe(); unsubscribeBad();
    emitRewardEvent('nothing');
    expect(received).toHaveLength(1);
    logger.mockRestore();
  });
});
