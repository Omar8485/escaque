import { colorOf, outcomeFor, SPEEDS, userEloOf, userRatingFromGames } from '../import/normalize.js';
import { FREE_LIMITS } from '../premium/limits.js';

/** @typedef {import('../storage/db.js').Game} Game */
/** @typedef {'lichess'|'chesscom'} Platform */
/** @typedef {{name:string, eco:string|null, n:number, score:number}} Opening */
/**
 * @typedef {object} ReportData
 * @property {Platform} platform
 * @property {string} username
 * @property {number} gameCount
 * @property {{from:number|null, to:number|null}} period
 * @property {{speed:Game['speed'], current:number, delta30:number|null}|null} rating
 * @property {{speed:Game['speed'], n:number, w:number, d:number, l:number}[]} bySpeed
 * @property {{w:{n:number, score:number|null}, b:{n:number, score:number|null}}} colors
 * @property {{best:Opening[], worst:Opening[]}} openings
 * @property {{n:number, pct:number}|null} timeLosses
 * @property {('W'|'D'|'L')[]} form
 * @property {{id:string, vars:Record<string, string|number>}[]} highlights
 */

const DAY = 86_400_000;
export const MIN_COLOR_GAMES = 5;
const OUTCOME = { win: 'W', draw: 'D', loss: 'L' };

function results(games) {
  const record = { n: games.length, w: 0, d: 0, l: 0 };
  for (const game of games) record[OUTCOME[outcomeFor(game)].toLowerCase()]++;
  return record;
}

const percent = (part, total) => 100 * part / total;
const score = ({ n, w, d }) => n ? percent(w + d / 2, n) : null;

function groupBy(games, keyFor) {
  const groups = new Map();
  for (const game of games) {
    const key = keyFor(game);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }
  return groups;
}

/** Recupera la perspectiva desde los nombres: una partida puede haberse guardado para el rival. */
export function gamesForReport(games, { username, platform }) {
  return games
    .filter((game) => game.source === platform && (game.variant ?? 'standard') === 'standard')
    .map((game) => ({ ...game, playerColor: colorOf(game.white, game.black, username) }))
    .filter((game) => outcomeFor(game))
    .sort((a, b) => b.endTime - a.endTime || a.id.localeCompare(b.id))
    .slice(0, FREE_LIMITS.recentGames);
}

/**
 * @param {Game[]} games
 * @param {{username:string, platform:Platform, now?:number}} options
 * @returns {ReportData}
 */
export function buildReport(games, { username, platform, now = Date.now() }) {
  const recent = gamesForReport(games, { username, platform });
  const dates = recent.map((game) => game.endTime).filter((time) => time > 0);
  const bySpeed = SPEEDS.map((speed) => ({ speed, ...results(recent.filter((game) => game.speed === speed)) }))
    .filter(({ n }) => n >= 5);

  const white = results(recent.filter((game) => game.playerColor === 'w'));
  const black = results(recent.filter((game) => game.playerColor === 'b'));
  const colors = { w: { n: white.n, score: score(white) }, b: { n: black.n, score: score(black) } };

  const openings = [...groupBy(recent, (game) => game.opening?.trim()).entries()]
    .filter(([, games]) => games.length >= 4)
    .map(([name, games]) => ({ name, eco: games.find((game) => game.eco)?.eco ?? null, n: games.length, score: score(results(games)) }));
  const best = openings.filter((opening) => opening.score > 50)
    .sort((a, b) => b.score - a.score || b.n - a.n || a.name.localeCompare(b.name)).slice(0, 3);
  const worst = openings.filter((opening) => opening.score < 50)
    .sort((a, b) => a.score - b.score || b.n - a.n || a.name.localeCompare(b.name)).slice(0, 3);

  const knownTerminations = recent.filter((game) => game.termination?.trim() && !/^(\?|unknownFinish)$/i.test(game.termination.trim()));
  const timedOut = knownTerminations.filter((game) => outcomeFor(game) === 'loss'
    && /^(?:outoftime|timeout|time forfeit)$|\bwon on time$/i.test(game.termination.trim())).length;
  const timeLosses = knownTerminations.length >= 10 ? { n: timedOut, pct: percent(timedOut, knownTerminations.length) } : null;

  const ratingSource = userRatingFromGames(recent.filter((game) => game.rated !== false && game.endTime > 0 && game.endTime <= now));
  const monthAgo = now - 30 * DAY;
  const baseline = ratingSource && recent.find((game) => game.speed === ratingSource.speed
    && game.rated !== false && userEloOf(game) != null && game.endTime > 0 && game.endTime <= monthAgo);
  const hasRecentRating = ratingSource && recent.some((game) => game.speed === ratingSource.speed
    && game.rated !== false && userEloOf(game) != null && game.endTime > monthAgo && game.endTime <= now);
  const rating = ratingSource ? {
    speed: ratingSource.speed, current: ratingSource.rating,
    delta30: baseline && hasRecentRating ? ratingSource.rating - userEloOf(baseline) : null,
  } : null;

  const highlights = [];
  if (worst.length) highlights.push({ id: 'weakOpening', vars: { opening: worst[0].name, n: worst[0].n, pct: Math.round(worst[0].score) } });
  const weakest = [['w', white], ['b', black]]
    .filter(([, stats]) => stats.n >= MIN_COLOR_GAMES && stats.l > stats.n / 2)
    .sort(([, a], [, b]) => b.l / b.n - a.l / a.n)[0];
  if (weakest) {
    const [color, stats] = weakest;
    highlights.push({ id: color === 'w' ? 'whiteLosses' : 'blackLosses', vars: { pct: Math.round(percent(stats.l, stats.n)), n: stats.n } });
  }
  if (timeLosses?.n) highlights.push({ id: 'timeLosses', vars: { n: timeLosses.n, pct: Math.round(timeLosses.pct) } });
  if (best.length) highlights.push({ id: 'strongOpening', vars: { opening: best[0].name, n: best[0].n, pct: Math.round(best[0].score) } });

  return {
    platform, username, gameCount: recent.length,
    period: { from: dates.at(-1) ?? null, to: dates[0] ?? null },
    rating, bySpeed, colors, openings: { best, worst }, timeLosses,
    form: recent.slice(0, 10).map((game) => OUTCOME[outcomeFor(game)]),
    highlights: highlights.slice(0, 3),
  };
}
