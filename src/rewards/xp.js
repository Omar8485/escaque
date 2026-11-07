import { eligibleTraining } from './activity.js';

// Pure XP ledger. Keys identify durable accomplishments, not transient UI events.
// Level L starts at 50*(L-1)*L XP, so each next level costs 100*L XP.
export const XP_RULES = Object.freeze({
  trainingBase: 30,
  rivalPerLevel: 3,
  trainingWin: 20,
  noBlunders: 15,
  puzzleSolved: 10,
  puzzleFirstTry: 5,
  reviewCompleted: 20,
  correction: 10,
  dailyGoal: 25,
});
const LABELS = new Set(['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']);
const saneXp = (xp) => Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
const validId = (id) => typeof id === 'string' && id.length > 0 || typeof id === 'number' && Number.isFinite(id);
export const emptyXpState = () => ({ xp: 0, awards: {} });

/** XP boundaries and fractional progress (0..1), with no iteration over prior levels. */
export function levelProgress(xp) {
  const totalXp = saneXp(xp);
  const level = Math.floor((1 + Math.sqrt(1 + 4 * totalXp / 50)) / 2);
  const currentLevelXp = 50 * (level - 1) * level;
  const nextLevelXp = 50 * level * (level + 1);
  const xpIntoLevel = totalXp - currentLevelXp;
  const xpForNextLevel = nextLevelXp - currentLevelXp;
  return { level, totalXp, xpIntoLevel, xpForNextLevel, currentLevelXp, nextLevelXp,
    currentXp: xpIntoLevel, requiredXp: xpForNextLevel, progress: xpIntoLevel / xpForNextLevel };
}

/** Civil day in the user's zone, independent from the process's timezone. */
export function rewardDay(now, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function allPlayerMovesKnown(data, plies) {
  if (!['w', 'b'].includes(data.playerColor)) return false;
  const start = data.startColor ?? 'w';
  const expected = data.playerColor === start ? Math.ceil(plies / 2) : Math.floor(plies / 2);
  if (expected <= 0 || !Array.isArray(data.moves)) return false;
  const player = data.moves.filter((move) => move.color === data.playerColor);
  const unique = new Map(player.map((move) => [move.ply, move]));
  if (unique.size !== expected) return false;
  return [...unique.values()].every((move) => Number.isInteger(move.ply) && move.ply > 0 && move.ply <= plies && LABELS.has(move.label) && move.label !== 'Blunder');
}

/**
 * Apply a {type,data} activity without mutating input. The same game can be enriched
 * later: base, win and quality awards deduplicate separately. A pending ledger never
 * earns no-blunder XP; withdrawn/replayed mate events retain the stable game id.
 */
export function applyXpEvent(state = emptyXpState(), event = {}, { now = Date.now(), timeZone } = {}) {
  const data = event.data ?? event;
  const original = state ?? emptyXpState();
  let next = original;
  const grant = (key, amount, kind, id) => {
    if (Object.hasOwn(next.awards ?? {}, key)) return;
    next = { ...next, xp: saneXp(next.xp) + amount,
      awards: { ...(next.awards ?? {}), [key]: { amount, kind, id, awardedAt: now } } };
  };
  const gameId = data.gameId ?? data.id;
  switch (event.type) {
    case 'training-finished': {
      const plies = data.plies ?? data.moves?.length ?? 0;
      const result = data.result;
      const reason = data.termination ?? data.reason ?? result?.reason;
      if (!validId(gameId) || !eligibleTraining({ plies, playerColor: data.playerColor, startColor: data.startColor, reason })) break;
      const level = Number.isFinite(data.level) ? Math.max(1, Math.min(10, Math.floor(data.level))) : 1;
      grant(`training:${gameId}:base`, XP_RULES.trainingBase + XP_RULES.rivalPerLevel * level, 'training', gameId);
      const winner = data.winner ?? result?.winner;
      const won = ['w', 'b'].includes(data.playerColor) && (winner === data.playerColor || result === (data.playerColor === 'w' ? '1-0' : '0-1'));
      if (won) grant(`training:${gameId}:win`, XP_RULES.trainingWin, 'win', gameId);
      if (allPlayerMovesKnown(data, plies)) grant(`training:${gameId}:quality`, XP_RULES.noBlunders, 'quality', gameId);
      break;
    }
    case 'puzzle-result': {
      const id = data.puzzleId ?? data.id;
      if (!validId(id) || !data.solved || Object.hasOwn(next.awards ?? {}, `puzzle:${id}:solve`)) break;
      grant(`puzzle:${id}:solve`, XP_RULES.puzzleSolved, 'puzzle', id);
      if (data.firstTry) grant(`puzzle:${id}:firstTry`, XP_RULES.puzzleFirstTry, 'firstTry', id);
      break;
    }
    case 'correction': {
      const key = data.key ?? data.position;
      if (validId(gameId) && validId(key)) grant(`correction:${JSON.stringify([gameId, key])}`, XP_RULES.correction, 'correction', gameId);
      break;
    }
    case 'review-completed':
    case 'daily-goal': {
      const day = data.day ?? rewardDay(now, timeZone);
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) break;
      const review = event.type === 'review-completed';
      grant(`${review ? 'review' : 'goal'}:${day}`, review ? XP_RULES.reviewCompleted : XP_RULES.dailyGoal, review ? 'review' : 'goal', day);
      break;
    }
  }
  return next;
}
