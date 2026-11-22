import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { _resetDbForTests, STORES, put } from '../storage/db.js';
import { loadProgressData } from './loadData.js';

afterEach(async () => {
  await _resetDbForTests();
  await new Promise((resolve) => { const req = indexedDB.deleteDatabase('escaque'); req.onsuccess = req.onerror = resolve; });
});
it('loads a consistent snapshot and excludes orphan derived records', async () => {
  await put(STORES.games, { id: 'escaque:1' });
  for (const name of [STORES.analysis, STORES.moves, STORES.puzzles]) {
    await put(name, { id: 'valid', gameId: 'escaque:1' });
    await put(name, { id: 'orphan', gameId: 'removed' });
  }
  const data = await loadProgressData();
  expect(data.games).toEqual([{ id: 'escaque:1' }]);
  for (const name of ['analysis', 'moves', 'puzzles']) expect(data[name]).toEqual([{ id: 'valid', gameId: 'escaque:1' }]);
});
it('supports an empty database without generating analysis', async () => {
  expect(await loadProgressData()).toEqual({ games: [], analysis: [], moves: [], puzzles: [] });
});
