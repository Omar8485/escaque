import { expect, it } from 'vitest';
import { eligibleTraining } from './activity.js';
it('excludes the first own move even if the opponent has already replied', () => {
  expect(eligibleTraining({ plies: 2, playerColor: 'w', reason: 'abandon' })).toBe(false);
  expect(eligibleTraining({ plies: 3, playerColor: 'b', reason: 'abandon' })).toBe(false);
  expect(eligibleTraining({ plies: 3, playerColor: 'w', reason: 'abandon' })).toBe(true);
  expect(eligibleTraining({ plies: 4, playerColor: 'b', reason: 'abandon' })).toBe(true);
});
it('permits a genuine short mate or draw, and supports a black-to-move initial FEN', () => {
  expect(eligibleTraining({ plies: 1, playerColor: 'w', reason: 'checkmate' })).toBe(true);
  expect(eligibleTraining({ plies: 1, playerColor: 'w', reason: 'stalemate' })).toBe(true);
  expect(eligibleTraining({ plies: 3, playerColor: 'b', startColor: 'b', reason: 'abandon' })).toBe(true);
  expect(eligibleTraining({ plies: 0, reason: 'checkmate' })).toBe(false);
});
