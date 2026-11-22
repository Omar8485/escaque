import { DEFAULT_RIVAL_LEVEL, RIVAL_LEVELS } from '../engine/rivalLevels.js';

/** La fuerza orientativa que ve el jugador; UCI_Elo es un parámetro interno del motor. */
export function nearestRivalLevel(rating) {
  if (!Number.isFinite(rating)) return DEFAULT_RIVAL_LEVEL;
  const distance = (rival) => Math.abs(Number(rival.nominalElo.replace('≈', '')) - rating);
  return RIVAL_LEVELS.filter((rival) => Number.isFinite(distance(rival)))
    .reduce((best, rival) => distance(rival) < distance(best) ? rival : best).level;
}
