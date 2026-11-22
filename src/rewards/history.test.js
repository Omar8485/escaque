import { expect, it } from 'vitest';
import { recognizeHistory } from './history.js';
import { emptyXpState } from './xp.js';
import { createDailyState, getDailyStatus } from './daily.js';
it('recognizes seven historical local training days silently without retroactive XP', () => {
  const now = Date.UTC(2026, 10, 8, 15);
  const games = Array.from({ length: 7 }, (_, i) => ({ id: `escaque:${i}`, source: 'escaque', playerColor: 'w', result: '1-0', pgn: '1. e4 e5 1-0', rivalLevel: 1, endTime: now - i * 86400000 }));
  const model = { xp: emptyXpState(), daily: createDailyState() };
  const next = recognizeHistory(model, { games }, now, 'America/Guayaquil');
  expect(next.achievements.unlocked.streak7).toBeDefined();
  expect(next.achievements.unlocked.firstGame).toBeDefined();
  expect(getDailyStatus(next.daily, { now, timeZone: 'America/Guayaquil' }).bestStreak).toBe(7);
  expect(next.xp).toBe(model.xp);
  expect(model.daily.days).toEqual({});
  expect(recognizeHistory(next, { games }, now + 1, 'America/Guayaquil')).toBe(next);
});
