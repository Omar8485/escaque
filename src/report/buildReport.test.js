import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeChessComGame, normalizeLichessGame } from '../import/normalize.js';
import { buildReport } from './buildReport.js';
import { nearestRivalLevel } from './rival.js';

const fixtures = (file) => JSON.parse(readFileSync(new URL(`../import/__fixtures__/${file}`, import.meta.url), 'utf8'));
const base = normalizeLichessGame(fixtures('lichess-user.ndjson'), 'bonerook');
const options = { platform: 'lichess', username: 'BONEROOK', now: base.endTime + 10 * 86_400_000 };
const chessCom = fixtures('chesscom-2025-01.json').games.map((game) => normalizeChessComGame(game, 'ramakrishnan3001')).filter(Boolean);
const sample = (n, attrs = {}) => Array.from({ length: n }, (_, i) => ({
  ...base, rated: true, id: `sample-${i}`, endTime: base.endTime - i * 86_400_000, ...attrs,
}));

describe('buildReport', () => {
  it('uses the requested account perspective, even when imported for the other player', () => {
    const data = buildReport([{ ...base, playerColor: 'b', rated: true }], options);
    expect(data).toMatchObject({
      gameCount: 1, form: ['L'], bySpeed: [], colors: { w: { n: 1, score: 0 }, b: { n: 0, score: null } },
      highlights: [], openings: { best: [], worst: [] }, timeLosses: null,
      rating: { current: 1780, speed: 'blitz', delta30: null },
    });
    expect(buildReport([base], { ...options, username: 'other' }).gameCount).toBe(0);
    expect(buildReport([base], { ...options, platform: 'chesscom' }).gameCount).toBe(0);
  });

  it('does not report openings below four, speeds below five or time losses below ten', () => {
    expect(buildReport(sample(3), options).openings.worst).toEqual([]);
    const four = buildReport(sample(4), options);
    expect(four.openings.worst[0]).toMatchObject({ n: 4, score: 0 });
    expect(four.bySpeed).toEqual([]);
    expect(four.highlights.map(({ id }) => id)).toEqual(['weakOpening']);
    expect(buildReport(sample(5), options).bySpeed).toEqual([{ speed: 'blitz', n: 5, w: 0, d: 0, l: 5 }]);
    expect(buildReport(sample(9), options).timeLosses).toBeNull();
    expect(buildReport(sample(10), options).timeLosses).toEqual({ n: 10, pct: 100 });
    expect(buildReport(sample(10, { termination: null }), options).timeLosses).toBeNull();
  });

  it('ranks openings, values draws at half a point, and caps highlights at three', () => {
    const games = sample(12).map((g, i) => i < 6 ? g : {
      ...g, white: 'Opponent', black: 'bonerook', opening: 'French Defense', eco: 'C00',
      result: i === 6 ? '1/2-1/2' : '0-1',
    });
    const report = buildReport(games.reverse(), options);
    expect(report.openings.best[0]).toMatchObject({ name: 'French Defense', eco: 'C00', n: 6, score: 100 * 5.5 / 6 });
    expect(report.colors.b).toEqual({ n: 6, score: 100 * 5.5 / 6 });
    expect(report.timeLosses).toEqual({ n: 6, pct: 50 });
    expect(report.form).toEqual(['L', 'L', 'L', 'L', 'L', 'L', 'D', 'W', 'W', 'W']);
    expect(report.highlights.map(({ id }) => id)).toEqual(['weakOpening', 'whiteLosses', 'timeLosses']);
  });

  it('counts a Chess.com timeout loss with the imported termination', () => {
    const game = chessCom.find(({ termination }) => termination?.endsWith('won on time'));
    expect(game).toBeTruthy();
    const games = Array.from({ length: 10 }, (_, i) => ({ ...game, id: String(i) }));
    const report = buildReport(games, { platform: 'chesscom', username: 'ramakrishnan3001' });
    expect(report.timeLosses).toEqual({ n: 10, pct: 100 });
  });

  it('uses up to 50 games and an earlier rating in the same time control for the 30-day change', () => {
    const games = sample(55).map((g, i) => ({ ...g, whiteElo: 1500 - i }));
    expect(buildReport(games, options)).toMatchObject({
      gameCount: 50, period: { from: games[49].endTime, to: base.endTime },
      rating: { speed: 'blitz', current: 1500, delta30: 20 },
    });
    expect(nearestRivalLevel(1500)).toBe(6);
    expect(nearestRivalLevel(850)).toBe(2);
    expect(nearestRivalLevel()).toBe(6);
  });
});
