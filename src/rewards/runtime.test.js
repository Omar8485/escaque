import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { setMeta, saveTrainingGame } from '../storage/db.js';
import { readRewards } from './store.js';
import { savePlayedGame } from '../import/store.js';
import { emitRewardEvent } from './events.js';
import { getRewardsSnapshot, startRewardsRuntime, rewardsSettled } from './runtime.js';

it('persists once per stable game, enriches quality later, and does not award old history XP', async () => {
  await setMeta('rewards', { xp: { xp: 20, awards: {} }, futureSetting: 'preserve' });
  await saveTrainingGame({ game: { id: 'escaque:old' }, moves: [] });
  startRewardsRuntime();
  await rewardsSettled();
  expect(getRewardsSnapshot().model.xp.xp).toBe(20);
  emitRewardEvent('training-finished', { id: 'session', plies: 2, level: 1, playerColor: 'w', result: { reason: 'checkmate', winner: 'w' } });
  emitRewardEvent('training-finished', { id: 'escaque:session', plies: 2, level: 1, playerColor: 'w', result: '1-0', reason: 'checkmate' });
  await rewardsSettled();
  expect(getRewardsSnapshot().model.xp.xp).toBe(73);
  await savePlayedGame({ game: { id: 'escaque:session', rivalLevel: 1, playerColor: 'w', result: '1-0', termination: 'checkmate' },
    moves: [{ ply: 1, color: 'w', label: 'Best' }, { ply: 2, color: 'b', label: 'Good' }] });
  await expect.poll(async () => (await readRewards()).xp.xp).toBe(88);
  expect((await readRewards()).futureSetting).toBe('preserve');
  emitRewardEvent('puzzle-result', { id: 'one', solved: true, firstTry: true });
  emitRewardEvent('puzzle-result', { id: 'one', solved: true, firstTry: true });
  await rewardsSettled();
  expect((await readRewards()).xp.xp).toBe(103);
  emitRewardEvent('review-started', { ids: ['one', 'two'] });
  emitRewardEvent('puzzle-result', { id: 'one', solved: true });
  emitRewardEvent('review-completed', { id: 'today' });
  await rewardsSettled();
  expect((await readRewards()).xp.xp).toBe(103);
  emitRewardEvent('puzzle-result', { id: 'two', solved: false });
  emitRewardEvent('review-completed', { id: 'today' });
  emitRewardEvent('review-completed', { id: 'today' });
  await rewardsSettled();
  expect((await readRewards()).xp.xp).toBe(123);
});

it('observes the first new generation after a previously hydrated install', async () => {
  const { vi } = await import('vitest');
  const { initialAchievements } = await import('./achievements.js');
  const db = await import('../storage/db.js');
  const raw = await readRewards();
  await db.setMeta('rewards', { ...raw, achievements: { ...initialAchievements(), hydrated: true } });
  await db.clear(db.STORES.puzzles);
  vi.resetModules();
  const runtime = await import('./runtime.js');
  await runtime.observeGeneratedPuzzles(0);
  await db.put(db.STORES.puzzles, { id: 'generated-live', gameId: 'escaque:session' });
  await runtime.observeGeneratedPuzzles(1);
  await runtime.rewardsSettled();
  expect((await readRewards()).achievements.unlocked.firstGenerated).toBeDefined();
  expect((await readRewards()).xp.xp).toBe(raw.xp.xp);
});
