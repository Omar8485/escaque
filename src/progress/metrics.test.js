import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { computeProgress } from './metrics.js';
import { classifyMove } from '../engine/classify.js';
import { playerGameAccuracy } from '../coach/accuracy.js';

const NOW = Date.UTC(2026, 10, 2);
const DAY = 86400000;
const cp = (value) => ({ type: 'cp', value });
function game(id = 'g', options = {}) {
  const chess = new Chess();
  for (const san of options.sans ?? ['e4', 'e5', 'Nf3', 'Nc6']) chess.move(san);
  return { id, source: 'pgn', playerColor: 'w', result: '0-1', endTime: NOW,
    speed: 'blitz', timeControl: '300+0', pgn: chess.pgn(), ...options };
}
const analysis = (id = 'g', scores = [0, -300, -300, -300, -300]) => ({ gameId: id, scores: scores.map(cp), bestMoves: ['d2d4', 'e7e5', 'g1f3', 'b8c6', null] });
const compute = (data) => computeProgress({ ...data, now: NOW });

describe('computeProgress', () => {
  it('returns honest empty states without NaN or invented weaknesses', () => {
    const result = compute({});
    expect(result.games).toEqual([]);
    expect(result.accuracy).toEqual({ mean: null, trend: [] });
    expect(result.weaknesses).toEqual([]);
    expect(result.conversion).toMatchObject({ eligible: 0, missed: 0, rate: null });
    expect(result.phases.every((phase) => phase.moves === 0 && phase.rates.Blunder === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('NaN');
  });

  it('keeps unanalysed games without making zero accuracy or counting unclassified moves', () => {
    const result = compute({ games: [game()] });
    expect(result.games[0].accuracy).toBeNull();
    expect(result.games[0].coverage).toEqual({ total: 2, classified: 0 });
    expect(result.coverage).toMatchObject({ games: 1, analyzedGames: 0, playerMoves: 2, classifiedMoves: 0, unanalysedImportedGames: 1 });
    expect(result.phases[0].moves).toBe(0);
  });

  it('derives imported classification with classifyMove and accuracy with the shared formula', () => {
    const imported = game();
    const result = compute({ games: [imported], analysis: [analysis()] });
    const [entry] = result.games;
    const move = new Chess().move('e4');
    const expected = classifyMove({ fenBefore: move.before, moveUci: move.lan,
      before: { bestMove: 'd2d4', lines: [{ score: cp(0), pv: ['d2d4'] }] },
      after: { fen: move.after, lines: [{ score: cp(-300), pv: [] }] } });
    expect(entry.moves[0].label).toBe(expected.label);
    expect(entry.accuracy).toBeCloseTo(playerGameAccuracy(entry.moves));
    expect(entry.counts.Blunder).toBe(1);
    expect(entry.errorsByPhase.apertura.Blunder).toBe(1);
    expect(result.phases[0]).toMatchObject({ moves: 2, rates: { Blunder: 50, Mistake: 0, Inaccuracy: 0 } });
  });

  it('uses only player moves and flips black evaluations correctly', () => {
    const a = analysis('black', [0, 0, 300, 300, 300]);
    a.bestMoves[1] = 'd7d5';
    const result = compute({ games: [game('black', { playerColor: 'b', result: '1-0' })], analysis: [a] });
    expect(result.games[0].moves.map((m) => m.color)).toEqual(['b', 'b']);
    expect(result.games[0].moves[0]).toMatchObject({ label: 'Blunder', ply: 2 });
  });

  it('reuses persisted Escaque classifications and motifs instead of relabeling', () => {
    const result = compute({ games: [game('local', { source: 'escaque' })], analysis: [analysis('local')],
      moves: [{ gameId: 'local', moves: [{ ply: 1, label: 'Mistake', evalBefore: cp(0), evalAfter: cp(-170), phase: 'final', motif: 'ataque_doble' }] }] });
    expect(result.games[0].moves[0]).toMatchObject({ label: 'Mistake', phase: 'final', motif: 'ataque_doble' });
    expect(result.motifs[0]).toMatchObject({ motif: 'ataque_doble', count: 1 });
    expect(result.weaknesses.some((w) => w.kind === 'motif' && w.key === 'ataque_doble')).toBe(true);
  });

  it('does not guess motifs when the best reply is missing or illegal', () => {
    const a = analysis();
    a.bestMoves[1] = 'a8a1';
    const result = compute({ games: [game()], analysis: [a] });
    expect(result.motifs).toMatchObject([{ motif: 'unknown', count: 1 }]);
    expect(result.weaknesses.some((w) => w.kind === 'motif')).toBe(false);
  });

  it('recognizes a verified allowed mate from the known reply', () => {
    const g = game('mate', { sans: ['f3', 'e5', 'g4', 'Qh4#'] });
    const a = { gameId: g.id, scores: [cp(0), cp(0), cp(0), { type: 'mate', value: -1, winner: 'b' }, { type: 'mate', value: 0, winner: 'b' }],
      bestMoves: ['e2e4', 'e7e5', 'g2g3', 'd8h4', null] };
    const result = compute({ games: [g], analysis: [a] });
    expect(result.games[0].moves[1]).toMatchObject({ label: 'Blunder', motif: 'mate' });
  });

  it('filters source, speed, periods and explicit inclusive dates without mutating inputs', () => {
    const games = [game('recent', { source: 'escaque', endTime: NOW - DAY }), game('old', { endTime: NOW - 60 * DAY }), game('rapid', { speed: 'rapid' })];
    const before = structuredClone(games);
    expect(compute({ games, filters: { source: 'escaque' } }).games.map((e) => e.game.id)).toEqual(['recent']);
    expect(compute({ games, filters: { source: 'imported', speed: 'blitz', period: '90' } }).games.map((e) => e.game.id)).toEqual(['old']);
    expect(compute({ games, filters: { period: '30' } }).games.map((e) => e.game.id)).toEqual(['recent', 'rapid']);
    expect(compute({ games, filters: { from: NOW - DAY, to: NOW - DAY } }).games.map((e) => e.game.id)).toEqual(['recent']);
    expect(games).toEqual(before);
  });

  it('computes rolling means over the last ten chronological games', () => {
    const games = Array.from({ length: 12 }, (_, i) => game(`g${i}`, { endTime: NOW - (12 - i) * DAY }));
    const analyses = games.map((g, i) => analysis(g.id, [0, -i * 30, -i * 30, -i * 30, -i * 30]));
    const result = compute({ games: [...games].reverse(), analysis: analyses });
    expect(result.accuracy.trend.at(-1).count).toBe(10);
    expect(result.accuracy.trend.at(-1).mean).toBeCloseTo(result.games.slice(2).reduce((sum, e) => sum + e.accuracy, 0) / 10);
    expect(result.accuracy.mean).toBeCloseTo(result.games.reduce((sum, e) => sum + e.accuracy, 0) / 12);
  });

  it('keeps holes in partial analysis and does not count missing moves in phase denominators', () => {
    const a = analysis(); a.scores[3] = null;
    const result = compute({ games: [game()], analysis: [a] });
    expect(result.coverage.classifiedMoves).toBe(1);
    expect(result.games[0].moves[1].label).toBeNull();
    expect(result.phases[0].rates.Blunder).toBe(100);
  });

  it('groups openings separately by color, points and observed error', () => {
    const games = [game('w', { opening: 'Sicilian Defense', eco: 'B20', result: '1-0' }),
      game('b', { opening: 'Sicilian Defense', eco: 'B20', playerColor: 'b', result: '1/2-1/2' })];
    const result = compute({ games, analysis: [analysis('w'), analysis('b')] });
    expect(result.openings).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'w:B20', color: 'w', games: 1, pointsPercent: 100, mostFrequentError: { key: 'unknown', count: 1 } }),
      expect.objectContaining({ key: 'b:B20', color: 'b', games: 1, pointsPercent: 50 }),
    ]));
  });

  it('recognizes an opening for local games without changing the original record', () => {
    const local = game('local', { source: 'escaque', opening: null, sans: ['e4', 'c5'] });
    const result = compute({ games: [local] });
    expect(local.opening).toBeNull();
    expect(result.games[0].game.opening).toBe('Sicilian Defense');
    expect(result.openings[0]).toMatchObject({ name: 'Sicilian Defense', color: 'w' });
  });

  it('does not assign a standard opening to games starting from a custom FEN', () => {
    const chess = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2');
    chess.move('e4'); chess.move('c5');
    const result = compute({ games: [game('custom', { pgn: chess.pgn(), opening: null })] });
    expect(result.games[0].game.opening).toBeNull();
    expect(result.openings).toEqual([]);
  });

  it('counts missed winning positions from either color, without inventing conversion in unanalysed games', () => {
    const games = [game('lost'), game('draw', { result: '1/2-1/2', playerColor: 'b' }), game('won', { result: '1-0' }), game('unknown')];
    const result = compute({ games, analysis: [analysis('lost', [500, 500, 0, 0, 0]), analysis('draw', [-500, -500, 0, 0, 0]), analysis('won', [500, 500, 0, 0, 0])] });
    expect(result.conversion).toMatchObject({ eligible: 3, missed: 2 });
    expect(result.conversion.rate).toBeCloseTo(200 / 3);
    expect(result.conversion.evidence.map((e) => e.gameId).sort()).toEqual(['draw', 'lost']);
  });

  it('includes positions gained after the final rival move but excludes unfinished results', () => {
    const games = [game('timeout', { source: 'escaque', sans: ['e4', 'e5'], termination: 'timeout' }),
      game('unfinished', { result: '*', opening: 'Italian Game' }), game('won', { result: '1-0', opening: 'Italian Game' })];
    const result = compute({ games, analysis: [analysis('unfinished', [500, 500, 500, 500, 500])],
      moves: [{ gameId: 'timeout', moves: [{ ply: 2, color: 'b', label: 'Blunder', evalBefore: cp(0), evalAfter: cp(500) }] }] });
    expect(result.conversion).toMatchObject({ eligible: 1, missed: 1, rate: 100 });
    expect(result.conversion.evidence).toMatchObject([{ gameId: 'timeout' }]);
    expect(result.openings.find((opening) => opening.name === 'Italian Game')).toMatchObject({ games: 2, points: 1, pointsPercent: 100 });
  });

  it('reads PGN clocks, counts strictly below ten percent, and leaves missing clocks unknown', () => {
    const chess = new Chess();
    chess.move('e4'); chess.setComment('[%clk 0:00:29]');
    chess.move('e5'); chess.setComment('[%clk 0:04:50]');
    chess.move('Nf3'); chess.setComment('[%clk 0:00:30]');
    chess.move('Nc6');
    const result = compute({ games: [game('clock', { pgn: chess.pgn() })], analysis: [analysis('clock')] });
    expect(result.timeTrouble).toMatchObject({ clockMoves: 2, moves: 1, errors: 1, rate: 100 });
    expect(result.timeTrouble.evidence[0]).toMatchObject({ gameId: 'clock', ply: 1 });
    expect(compute({ games: [game()], analysis: [analysis()] }).timeTrouble).toMatchObject({ clockMoves: 0, rate: null });
  });

  it('ranks at most three weaknesses by explainable frequency × severity × recency', () => {
    const games = [game('old', { endTime: NOW - 120 * DAY }), game('new')];
    const result = compute({ games, analysis: [analysis('old'), analysis('new')] });
    expect(result.weaknesses.length).toBeLessThanOrEqual(3);
    const weakness = result.weaknesses[0];
    expect(weakness.score).toBeCloseTo(weakness.frequency * weakness.severity * weakness.recency);
    expect(weakness).toMatchObject({ count: 2, blunders: 2, games: 2 });
    expect(weakness.evidence[0]).toMatchObject({ gameId: 'old', ply: 1, label: 'Blunder', color: 'w', date: NOW - 120 * DAY });
    expect(weakness.recency).toBeCloseTo((1 + 1 / 16) / 2);
  });

  it('ignores malformed PGNs and unavailable player colors safely', () => {
    const result = compute({ games: [game('bad', { pgn: 'invalid PGN' }), game('spectator', { playerColor: null })], analysis: [analysis('spectator')] });
    expect(result.coverage.playerMoves).toBe(0);
    expect(result.accuracy.mean).toBeNull();
    expect(result.weaknesses).toEqual([]);
  });
});
