// Progress calculations over caller-supplied snapshots. No storage, network or engine work.
import { Chess } from 'chess.js';
import { classifyMove, LABELS } from '../engine/classify.js';
import { winPercentFor } from '../engine/uci.js';
import { playerGameAccuracy } from '../coach/accuracy.js';
import { gamePhase } from '../coach/phase.js';
import { openingFacts } from '../coach/opening.js';
import OPENINGS_MAP from '../data/openings_map.json';
import { START_FEN } from '../coach/summary.js';
import { hangingPieces, refutationFacts } from '../coach/tactics.js';
import { parseTimeControl } from '../import/normalize.js';

const PHASES = ['apertura', 'medio juego', 'final'];
const ERRORS = ['Inaccuracy', 'Mistake', 'Blunder'];
const WEIGHT = { Inaccuracy: 1, Mistake: 2, Blunder: 4 };
const DAY = 86400000;
const mean = (values) => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const percent = (a, b) => b ? a * 100 / b : null;
const counts = () => Object.fromEntries(LABELS.map((label) => [label, 0]));
const scoreValid = (s) => s && ['cp', 'mate'].includes(s.type) && Number.isFinite(s.value) && (s.type !== 'mate' || ['w', 'b'].includes(s.winner));
const error = (m) => ERRORS.includes(m.label);

function includeGame(game, filters, now) {
  const source = filters.source ?? 'all';
  if (source === 'escaque' && game.source !== 'escaque') return false;
  if (['imported', 'imports'].includes(source) && game.source === 'escaque') return false;
  if (source !== 'all' && !['escaque', 'imported', 'imports'].includes(source) && game.source !== source) return false;
  if (filters.speed && filters.speed !== 'all' && game.speed !== filters.speed) return false;
  const days = Number(filters.days ?? filters.period);
  const from = filters.from ?? (days > 0 ? now - days * DAY : null);
  if (from != null && !(game.endTime >= from)) return false;
  if (filters.to != null && !(game.endTime <= filters.to)) return false;
  return true;
}

/** PGN comments belong to the position after the move. A missing clock stays unknown. */
function readLine(game) {
  if (!game.pgn) return [];
  try {
    const chess = new Chess();
    chess.loadPgn(game.pgn);
    const comments = new Map(chess.getComments().map(({ fen, comment }) => [fen, comment]));
    return chess.history({ verbose: true }).map((move, index) => {
      const match = /\[%clk\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\]/.exec(comments.get(move.after) ?? '');
      const clockSeconds = match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
      return { ply: index + 1, color: move.color, san: move.san, uci: move.lan, fenBefore: move.before,
        fenAfter: move.after, phase: gamePhase(move.after, Number(move.before.split(' ')[5])), clockSeconds };
    });
  } catch { return []; }
}

function deriveClassification(move, analysis) {
  const i = move.ply - 1;
  const before = analysis?.scores?.[i];
  const after = analysis?.scores?.[i + 1];
  if (!scoreValid(before) || !scoreValid(after)) return null;
  const best = analysis.bestMoves?.[i] ?? null;
  return classifyMove({ fenBefore: move.fenBefore, moveUci: move.uci,
    before: { bestMove: best, lines: [{ score: before, pv: best ? [best] : [] }] },
    after: { fen: move.fenAfter, lines: [{ score: after, pv: [] }] }, pvPlies: 0 });
}

// Only a known legal best reply can support a tactical explanation of an error.
function deriveMotif(move, analysis) {
  if (!error(move)) return null;
  const reply = analysis?.bestMoves?.[move.ply];
  if (!reply || !scoreValid(move.evalAfter)) return 'unknown';
  const after = { bestMove: reply, lines: [{ multipv: 1, score: move.evalAfter, pv: [reply] }] };
  const refutation = refutationFacts({ fenAfter: move.fenAfter, after });
  if (!refutation) return 'unknown';
  if (refutation.motif === 'mate') return 'mate';
  if (hangingPieces({ fenAfter: move.fenAfter, after }).some((piece) => piece.confirmedByEngine)) return 'hanging';
  return refutation.motif ?? 'unknown';
}

function summarizeGame(game, analysis, savedMoves) {
  const line = readLine(game);
  if (!game.opening && line[0]?.fenBefore === START_FEN) {
    const opening = openingFacts(line.map((move) => move.san), OPENINGS_MAP).name;
    if (opening) game = { ...game, opening };
  }
  const saved = new Map((savedMoves ?? []).map((m) => [m.ply, m]));
  const control = parseTimeControl(game.timeControl);
  const moves = line.filter((m) => m.color === game.playerColor).map((m) => {
    const existing = saved.get(m.ply);
    const c = existing && LABELS.includes(existing.label) ? existing : deriveClassification(m, analysis);
    const move = { ...m, ...(c ?? {}), ply: m.ply, color: m.color, san: m.san, uci: m.uci,
      fenBefore: m.fenBefore, fenAfter: m.fenAfter, phase: existing?.phase ?? m.phase,
      label: LABELS.includes(c?.label) ? c.label : null,
      evalBefore: scoreValid(c?.evalBefore) ? c.evalBefore : null,
      evalAfter: scoreValid(c?.evalAfter) ? c.evalAfter : null };
    move.motif = error(move) ? existing?.motif ?? deriveMotif(move, analysis) : null;
    move.timeTrouble = m.clockSeconds != null && control?.base > 0 ? m.clockSeconds < control.base * 0.1 : null;
    return move;
  });
  const tally = counts();
  const errorsByPhase = Object.fromEntries(PHASES.map((phase) => [phase, { Blunder: 0, Mistake: 0, Inaccuracy: 0 }]));
  for (const move of moves) {
    if (move.label) tally[move.label] += 1;
    if (error(move) && errorsByPhase[move.phase]) errorsByPhase[move.phase][move.label] += 1;
  }
  // Unknown positions remain holes, rather than being compressed into adjacent moves.
  const accuracy = playerGameAccuracy(moves);
  const known = moves.filter((m) => m.label).length;
  let reachedWinningPosition = moves.some((m) => [m.evalBefore, m.evalAfter].some((s) => scoreValid(s) && winPercentFor(s, game.playerColor) >= 80));
  if (game.playerColor && analysis?.scores) reachedWinningPosition ||= analysis.scores.some((s) => scoreValid(s) && winPercentFor(s, game.playerColor) >= 80);
  if (game.playerColor) reachedWinningPosition ||= (savedMoves ?? []).some((m) => [m.evalBefore, m.evalAfter].some((s) => scoreValid(s) && winPercentFor(s, game.playerColor) >= 80));
  return { game, moves, accuracy, counts: tally, errorsByPhase, coverage: { total: moves.length, classified: known }, reachedWinningPosition };
}

const evidenceFor = (entry, move) => ({ gameId: entry.game.id, ply: move.ply, date: entry.game.endTime,
  color: entry.game.playerColor, phase: move.phase, motif: move.motif ?? 'unknown', label: move.label,
  opening: entry.game.opening ?? null });
function errorSummary(evidence) {
  return { count: evidence.length, blunders: evidence.filter((e) => e.label === 'Blunder').length,
    mistakes: evidence.filter((e) => e.label === 'Mistake').length,
    inaccuracies: evidence.filter((e) => e.label === 'Inaccuracy').length, evidence };
}

/**
 * @param {{games?:object[],analysis?:object[],moves?:object[],filters?:object,now?:number}} data
 * @param {{source?:string,speed?:string,period?:string|number,from?:number,to?:number,days?:number}} [filterOverride]
 */
export function computeProgress({ games = [], analysis = [], moves = [], filters = {}, now = Date.now() } = {}, filterOverride) {
  filters = filterOverride ?? filters;
  const byAnalysis = new Map(analysis.map((a) => [a.gameId, a]));
  const byMoves = new Map(moves.map((m) => [m.gameId, m.moves]));
  const entries = games.filter((game) => includeGame(game, filters, now))
    .sort((a, b) => a.endTime - b.endTime || a.id.localeCompare(b.id))
    .map((game) => summarizeGame(game, byAnalysis.get(game.id), byMoves.get(game.id)));
  const analyzed = entries.filter((entry) => entry.accuracy != null);
  const trend = entries.map((entry, index) => {
    const window = entries.slice(Math.max(0, index - 9), index + 1).map((item) => item.accuracy).filter((n) => n != null);
    return { gameId: entry.game.id, date: entry.game.endTime, accuracy: entry.accuracy, mean: mean(window), count: window.length };
  });
  const phases = PHASES.map((phase) => {
    const known = entries.flatMap((entry) => entry.moves).filter((m) => m.phase === phase && m.label);
    const tally = counts();
    known.forEach((m) => { tally[m.label] += 1; });
    return { phase, moves: known.length, counts: tally, rates: Object.fromEntries(ERRORS.map((label) => [label, percent(tally[label], known.length)])) };
  });
  const allEvidence = entries.flatMap((entry) => entry.moves.filter(error).map((m) => evidenceFor(entry, m)));
  const motifNames = [...new Set(allEvidence.map((e) => e.motif))].sort();
  const motifs = motifNames.map((motif) => ({ motif, ...errorSummary(allEvidence.filter((e) => e.motif === motif)) }))
    .sort((a, b) => b.count - a.count || a.motif.localeCompare(b.motif));
  const openingGroups = new Map();
  for (const entry of entries) {
    const { game } = entry;
    if (!game.playerColor || !(game.opening || game.eco)) continue;
    const key = `${game.playerColor}:${game.eco || game.opening}`;
    if (!openingGroups.has(key)) openingGroups.set(key, []);
    openingGroups.get(key).push(entry);
  }
  const openings = [...openingGroups].map(([key, group]) => {
    const completed = group.filter(({ game }) => ['1-0', '0-1', '1/2-1/2'].includes(game.result));
    const points = completed.reduce((sum, { game }) => sum + (game.result === '1/2-1/2' ? 0.5 : game.result === (game.playerColor === 'w' ? '1-0' : '0-1') ? 1 : 0), 0);
    const mistakes = group.flatMap((entry) => entry.moves.filter(error)).reduce((out, move) => {
      const k = move.motif ?? 'unknown'; out[k] = (out[k] ?? 0) + 1; return out;
    }, {});
    const frequent = Object.entries(mistakes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { key, name: group[0].game.opening || group[0].game.eco, color: group[0].game.playerColor,
      games: group.length, points, pointsPercent: percent(points, completed.length),
      accuracy: mean(group.map((e) => e.accuracy).filter((n) => n != null)),
      mostFrequentError: frequent ? { key: frequent[0], count: frequent[1] } : null };
  });
  const winning = entries.filter((entry) => entry.reachedWinningPosition && ['1-0', '0-1', '1/2-1/2'].includes(entry.game.result));
  const missed = winning.filter(({ game }) => game.result !== (game.playerColor === 'w' ? '1-0' : '0-1') && game.result !== '*');
  const clockMoves = entries.flatMap((entry) => entry.moves).filter((m) => m.timeTrouble != null && m.label);
  const lowTime = clockMoves.filter((m) => m.timeTrouble);
  const timeEvidence = entries.flatMap((entry) => entry.moves.filter((m) => m.timeTrouble && error(m)).map((m) => evidenceFor(entry, m)));
  const candidates = [
    ...PHASES.map((key) => ({ kind: 'phase', key, evidence: allEvidence.filter((e) => e.phase === key), denominator: phases.find((p) => p.phase === key).moves })),
    ...motifs.filter((m) => m.motif !== 'unknown').map((m) => ({ kind: 'motif', key: m.motif, evidence: m.evidence, denominator: entries.reduce((sum, e) => sum + e.coverage.classified, 0) })),
    ...openings.map((o) => ({ kind: 'opening', key: o.key, evidence: allEvidence.filter((e) => `${e.color}:${entries.find((en) => en.game.id === e.gameId)?.game.eco || e.opening}` === o.key),
      denominator: openingGroups.get(o.key).reduce((sum, e) => sum + e.coverage.classified, 0) })),
  ];
  const weaknesses = candidates.filter((c) => c.evidence.length).map((c) => {
    const frequency = c.evidence.length / c.denominator;
    const severity = mean(c.evidence.map((e) => WEIGHT[e.label]));
    // A 30-day half-life; injected now makes ranking reproducible.
    const recency = mean(c.evidence.map((e) => 2 ** (-Math.max(0, now - e.date) / (30 * DAY))));
    return { kind: c.kind, key: c.key, ...errorSummary(c.evidence), sampleGames: entries.length, sampleMoves: c.denominator, games: new Set(c.evidence.map((e) => e.gameId)).size,
      frequency, severity, recency, score: frequency * severity * recency };
  }).sort((a, b) => b.score - a.score || b.count - a.count || `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`)).slice(0, 3);
  return {
    games: entries, accuracy: { mean: mean(analyzed.map((entry) => entry.accuracy)), trend }, phases, motifs, openings,
    conversion: { eligible: winning.length, missed: missed.length, rate: percent(missed.length, winning.length), evidence: missed.map(({ game }) => ({ gameId: game.id, date: game.endTime })) },
    timeTrouble: { clockMoves: clockMoves.length, moves: lowTime.length, errors: timeEvidence.length, rate: percent(timeEvidence.length, lowTime.length), evidence: timeEvidence },
    weaknesses, coverage: { games: entries.length, analyzedGames: analyzed.length,
      playerMoves: entries.reduce((sum, e) => sum + e.coverage.total, 0), classifiedMoves: entries.reduce((sum, e) => sum + e.coverage.classified, 0),
      unanalysedImportedGames: entries.filter((e) => e.game.source !== 'escaque' && e.coverage.classified === 0).length },
  };
}
