// One-time historical recognition. This runs in a Worker in the browser.
import { Chess } from 'chess.js';
import { applyDailyEvent, createDailyState, getDailyStatus } from './daily.js';
import { hydrateHistory, initialAchievements } from './achievements.js';

export function recognizeHistory(model, data, now, timeZone) {
  if (model.achievements?.hydrated) return model;
  let daily = model.daily ?? createDailyState();
  for (const game of data.games ?? []) {
    if (game.source !== 'escaque' || !Number.isFinite(game.endTime) || game.endTime > now || !['1-0', '0-1', '1/2-1/2'].includes(game.result)) continue;
    try {
      const chess = new Chess(); chess.loadPgn(game.pgn);
      daily = applyDailyEvent(daily, { type: 'training-finished', id: game.id, plies: chess.history().length, reason: game.termination }, { now: game.endTime, timeZone });
    } catch { /* Unknown history cannot prove a training day. */ }
  }
  const result = hydrateHistory(model.achievements ?? initialAchievements(), { ...data, daily: getDailyStatus(daily, { now, timeZone }) }, now);
  return { ...model, daily, achievements: result.state };
}
