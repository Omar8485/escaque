// Estadísticas del usuario a partir de sus partidas importadas (tipo Game de src/storage/db.js).
import { outcomeFor, userEloOf } from '../import/normalize.js';

/** @typedef {import('../storage/db.js').Game} Game */

/** Partidas de un ritmo ('all' = todas). */
export const filterBySpeed = (games, speed) => (speed === 'all' ? games : games.filter((g) => g.speed === speed));

/** Ritmos presentes, del más jugado al menos jugado. */
export function speedsPlayed(games) {
  const counts = new Map();
  for (const g of games) counts.set(g.speed, (counts.get(g.speed) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([speed, count]) => ({ speed, count }));
}

/**
 * Victorias, derrotas, tablas e historial de Elo (del más antiguo al más reciente).
 * Las partidas sin color del usuario (PGN sin identificar) no cuentan.
 * @param {Game[]} games
 */
export function computeStats(games) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const eloHistory = [];
  const sorted = [...games].sort((a, b) => a.endTime - b.endTime);
  for (const g of sorted) {
    const o = outcomeFor(g);
    if (o === 'win') wins++;
    else if (o === 'loss') losses++;
    else if (o === 'draw') draws++;
    else continue;
    const elo = userEloOf(g);
    if (elo) eloHistory.push({ date: g.endTime ? new Date(g.endTime).toISOString().slice(0, 10) : '', rating: elo });
  }
  return { wins, losses, draws, total: wins + losses + draws, eloHistory };
}
