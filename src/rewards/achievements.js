// Logros locales: consumen hechos guardados/eventos, nunca solicitan análisis ni conceden XP.
import { eligibleTraining } from './activity.js';
import { Chess } from 'chess.js';
import { playerGameAccuracy } from '../coach/accuracy.js';
import { winPercentFor } from '../engine/uci.js';

const RIVALS = ['Ícaro', 'Narciso', 'Perseo', 'Jasón', 'Teseo', 'Héctor', 'Odiseo', 'Aquiles', 'Heracles', 'Atenea'];
export const ACHIEVEMENTS = Object.freeze([
  { id: 'firstGame' },
  ...RIVALS.map((rival, index) => ({ id: `rival${index + 1}`, vars: { rival } })),
  { id: 'athena' }, { id: 'cleanGame' }, { id: 'accuracy90' }, { id: 'conversion' },
  { id: 'puzzleChain10' }, { id: 'streak7' }, { id: 'firstImport' },
  { id: 'firstGenerated' }, { id: 'corrections10' }, { id: 'firstReview' },
].map((item) => Object.freeze({ ...item, nameKey: `rewards.ach.${item.id}.name`, descriptionKey: `rewards.ach.${item.id}.description` })));
const LABELS = new Set(['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']);
const scoreValid = (s) => s && Number.isFinite(s.value) && (s.type === 'cp' || (s.type === 'mate' && ['w', 'b'].includes(s.winner)));
const finishedResult = (result) => ['1-0', '0-1', '1/2-1/2'].includes(result);

export const initialAchievements = () => ({ unlocked: {}, counters: { puzzleStreak: 0, corrections: 0 }, seen: {}, correctedPositions: {}, hydrated: false });

function gameFacts(data) {
  const game = data.game ?? {};
  const playerColor = game.playerColor ?? data.playerColor;
  const result = game.result ?? data.result;
  const moves = data.moves?.moves ?? data.moves ?? [];
  let expected = null;
  // The saved PGN establishes completeness; partial ledgers never earn quality achievements.
  if (game.pgn) {
    try {
      const chess = new Chess(); chess.loadPgn(game.pgn);
      expected = chess.history({ verbose: true }).map((move, i) => ({ ply: i + 1, color: move.color }));
    } catch { /* malformed history gives no quality awards */ }
  } else if (Number.isInteger(data.plies) && data.plies > 0) {
    expected = Array.from({ length: data.plies }, (_, i) => ({ ply: i + 1, color: i % 2 ? 'b' : 'w' }));
  }
  const plies = expected?.length ?? data.plies ?? moves.length;
  const reason = game.termination ?? data.reason ?? result?.reason;
  const finished = finishedResult(result) || (result && typeof result === 'object' && result.reason);
  const valid = Boolean(finished && ['w', 'b'].includes(playerColor) && plies > 0
    && eligibleTraining({ plies, playerColor, startColor: expected?.[0]?.color, reason })
    && (!game.source || game.source === 'escaque'));
  const won = result && typeof result === 'object' ? result.winner === playerColor : result === (playerColor === 'w' ? '1-0' : '0-1');
  const ownLine = expected?.filter((move) => move.color === playerColor) ?? [];
  const byPly = new Map(moves.map((move) => [move.ply, move]));
  const ownMoves = ownLine.map((move) => byPly.get(move.ply));
  const classified = ownMoves.length > 0 && ownMoves.every((move) => move?.color === playerColor && LABELS.has(move.label));
  const evaluated = classified && ownMoves.every((move) => scoreValid(move.evalBefore) && scoreValid(move.evalAfter));
  return { game, valid, won, playerColor, ownMoves: ownMoves.filter(Boolean), classified, evaluated,
    level: game.rivalLevel ?? data.level, id: game.id ?? data.gameId ?? data.id };
}

/** Pure reducer. Stable activity identities deduplicate counters; enriched game snapshots may fill late analysis. */
export function reduceAchievements(previous = initialAchievements(), event, now = Date.now()) {
  if (!event?.type) return { state: previous, unlocked: [] };
  const data = event.data ?? {};
  const at = Number.isFinite(event.at) ? event.at : now;
  const state = { ...initialAchievements(), ...previous, unlocked: { ...previous.unlocked },
    counters: { puzzleStreak: 0, corrections: 0, ...previous.counters }, seen: { ...previous.seen },
    correctedPositions: { ...previous.correctedPositions } };
  const unlocked = [];
  const award = (id) => {
    if (!state.unlocked[id]) { state.unlocked[id] = { unlockedAt: at }; unlocked.push(id); }
  };
  const identity = data.puzzleId ?? data.id ?? event.id;
  const key = identity == null ? null : `${event.type}:${identity}`;
  const seen = key && state.seen[key];
  if (event.type !== 'training-finished' && seen) {
    if (event.type === 'puzzle-result' && (!data.solved || !data.firstTry) && previous.counters.puzzleStreak > 0) return { state: { ...previous, counters: { ...previous.counters, puzzleStreak: 0 } }, unlocked: [] };
    return { state: previous, unlocked: [] };
  }
  if (key) state.seen[key] = true;
  if (event.type === 'training-finished') {
    const facts = gameFacts(data);
    if (facts.valid) {
      award('firstGame');
      if (facts.won && Number.isInteger(facts.level) && facts.level >= 1 && facts.level <= 10) {
        award(`rival${facts.level}`);
        if (facts.level === 10) award('athena');
      }
      if (facts.classified && facts.ownMoves.every((move) => move.label !== 'Blunder')) award('cleanGame');
      if (facts.evaluated && playerGameAccuracy(facts.ownMoves) >= 90) award('accuracy90');
      if (facts.won && facts.ownMoves.some((move) => [move.evalBefore, move.evalAfter].some((score) => scoreValid(score) && winPercentFor(score, facts.playerColor) >= 80))) award('conversion');
    }
  } else if (event.type === 'puzzle-result' && key) {
    state.counters.puzzleStreak = data.solved && data.firstTry ? state.counters.puzzleStreak + 1 : 0;
    if (state.counters.puzzleStreak >= 10) award('puzzleChain10');
  } else if (event.type === 'correction' && key) {
    const position = data.gameId && (data.fenBefore ?? data.key) ? `${data.gameId}|${data.fenBefore ?? data.key}` : key;
    if (!state.correctedPositions[position]) {
      state.correctedPositions[position] = true;
      state.counters.corrections += 1;
      if (state.counters.corrections >= 10) award('corrections10');
    }
  } else if (event.type === 'import-completed' && (data.added > 0 || data.count > 0)) award('firstImport');
  else if (event.type === 'puzzles-generated' && (data.count > 0 || data.puzzles > 0 || data.puzzles?.length > 0)) award('firstGenerated');
  else if (event.type === 'review-completed' && data.completed !== false && (data.count > 0 || data.completedCount > 0)) award('firstReview');
  const streak = data.daily?.bestStreak ?? data.daily?.best ?? data.bestStreak ?? data.streak;
  if (Number.isFinite(streak) && streak >= 7) award('streak7');
  return { state, unlocked };
}

/** One-time recognition of existing evidence. Silent, no XP, no invented weekly-plan completion. */
export function hydrateHistory(previous = initialAchievements(), { games = [], moves = [], puzzles = [], puzzleProgress = {}, daily = {} } = {}, now = Date.now()) {
  if (previous.hydrated) return { state: previous, unlocked: [] };
  let state = previous;
  const apply = (type, data, at = now) => { state = reduceAchievements(state, { type, data, at }, now).state; };
  const moveMap = new Map(moves.map((record) => [record.gameId, record.moves ?? []]));
  for (const game of [...games].sort((a, b) => (a.endTime ?? now) - (b.endTime ?? now))) {
    if (game.source !== 'escaque') continue;
    const line = moveMap.get(game.id) ?? [];
    apply('training-finished', { game, moves: line }, Number.isFinite(game.endTime) ? game.endTime : now);
    // A withdrawn move plus a different Best/Excellent move at the same position proves a correction.
    for (const move of line.filter((item) => item.color === game.playerColor && ['Best', 'Excellent'].includes(item.label))) {
      const withdrawn = game.retractedMoves?.some((attempt) => attempt.takebackUsed && attempt.key === `${move.fenBefore}|${attempt.uci}` && attempt.uci !== move.uci);
      if (withdrawn) apply('correction', { id: `${game.id}|${move.fenBefore}`, gameId: game.id, key: move.fenBefore }, game.endTime ?? now);
    }
  }
  const imported = games.filter((game) => game.source && game.source !== 'escaque' && game.source !== 'demo');
  if (imported.length) apply('import-completed', { id: 'history:import', added: imported.length });
  if (puzzles.some((puzzle) => puzzle.gameId)) apply('puzzles-generated', { id: 'history:generated', count: puzzles.length });
  if (puzzleProgress.best >= 10) state = { ...state, unlocked: { ...state.unlocked, puzzleChain10: state.unlocked.puzzleChain10 ?? { unlockedAt: now } } };
  // Old results lack intra-day attempt ordering: preserve only their known current streak, never invent one.
  state = { ...state, counters: { ...state.counters, puzzleStreak: Math.max(state.counters.puzzleStreak, puzzleProgress.streak ?? 0) },
    seen: { ...state.seen, ...Object.fromEntries(Object.keys(puzzleProgress.results ?? {}).map((id) => [`puzzle-result:${id}`, true])) } };
  apply('daily-snapshot', { daily });
  return { state: { ...state, hydrated: true }, unlocked: [] };
}
