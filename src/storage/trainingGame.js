// Pure snapshot of a finished training game. Never requests engine analysis: missing
// classifications stay null and can be filled by the caller as the ledger completes.
import { Chess } from 'chess.js';
import { moveKey } from '../coach/summary.js';
import { gamePhase } from '../coach/phase.js';
import { moveMotif } from '../coach/tactics.js';
import { speedFromTimeControl } from '../import/normalize.js';

// chess.js 1.4 cannot reload escaped quotes in PGN tag values. Normalize only
// tag display names; Game.white/black/playerName keep the original profile text.
const pgnTag = (value) => String(value).replaceAll('"', "'").replace(/[\r\n]/g, ' ');

const nonNegative = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * Build the Game and per-ply records from an immutable final-state snapshot.
 * @param {object} input
 * @param {string} input.id stable session identifier (repeated snapshots overwrite)
 * @param {import('../coach/summary.js').LineMove[]} input.line
 * @param {Record<string, object>} [input.classifications] keyed by moveKey
 * @param {Record<string, object>} [input.coachRecords] useCoach records, keyed by moveKey
 * @param {Record<string, {hintsUsed?:number,takebackUsed?:boolean,coachInterrupted?:boolean}>} [input.interactions]
 * @param {object[]} [input.retractedMoves] withdrawn attempts retained for coach history
 * @param {'w'|'b'} input.playerColor
 * @param {string} input.playerName name captured at game start
 * @param {{name:string,level:number,elo?:number|null}} input.rival
 * @param {{reason:string,winner:'w'|'b'|null}|null} input.result
 * @param {number} input.startedAt epoch milliseconds
 * @param {number} input.endedAt epoch milliseconds
 * @param {{initialSeconds:number,increment:number}|null} [input.timeControl]
 * @param {{w?:number,b?:number,timeUsedMs?:{w:number,b:number},durationMs?:number}} [input.times] milliseconds used, as in summarizeGame.time
 * @returns {{game:import('./db.js').Game,moves:object[]}|null}
 */
export function buildTrainingGame({ id, line, classifications = {}, coachRecords = {}, interactions = {}, playerColor,
  playerName, rival, result, startedAt, endedAt, timeControl = null, times = {}, retractedMoves = [] }) {
  if (!result || !line?.length) return null;
  const gameId = String(id).startsWith('escaque:') ? String(id) : `escaque:${id}`;
  const score = result.winner === 'w' ? '1-0' : result.winner === 'b' ? '0-1' : '1/2-1/2';
  const used = times.timeUsedMs ?? times;
  const timeUsedMs = { w: nonNegative(used.w), b: nonNegative(used.b) };
  const durationMs = nonNegative(times.durationMs ?? endedAt - startedAt);
  const control = timeControl ? `${timeControl.initialSeconds}+${timeControl.increment ?? 0}` : null;
  const chess = new Chess(line[0].before);
  // chess.js keeps FEN/SetUp automatically for a nonstandard initial position.
  const white = playerColor === 'w' ? playerName : rival.name;
  const black = playerColor === 'b' ? playerName : rival.name;
  const date = new Date(startedAt).toISOString();
  chess.header('Event', 'Escaque', 'Site', 'Escaque', 'Date', date.slice(0, 10).replaceAll('-', '.'),
    'UTCTime', date.slice(11, 19), 'Round', '-', 'White', pgnTag(white), 'Black', pgnTag(black),
    'Result', score, 'Termination', result.reason, 'TimeControl', control ?? '-',
    'Rival', pgnTag(rival.name), 'RivalLevel', String(rival.level), 'PlayerColor', playerColor,
    'WhiteTimeUsedMs', String(timeUsedMs.w), 'BlackTimeUsedMs', String(timeUsedMs.b));
  for (const move of line) chess.move(move.san);
  // chess.js may update Result on game-over moves, so restore the authoritative
  // loop result (also covers timeout and abandonment in a legal live position).
  chess.header('Result', score);
  const game = {
    id: gameId, source: 'escaque', externalId: gameId.slice('escaque:'.length), url: null,
    white, black, whiteElo: playerColor === 'b' ? rival.elo ?? null : null,
    blackElo: playerColor === 'w' ? rival.elo ?? null : null,
    result: score, startedAt, endTime: endedAt, importedAt: endedAt,
    timeControl: control, speed: speedFromTimeControl(control), rated: false, variant: 'standard',
    eco: null, opening: null, termination: result.reason, pgn: chess.pgn(),
    playerName, playerColor, rivalLevel: rival.level, timeUsedMs, durationMs,
    retractedMoves: structuredClone(retractedMoves),
  };
  const moves = line.map((move) => {
    const key = moveKey(move);
    const record = coachRecords[key];
    const request = record?.request;
    const c = classifications[key] ?? request?.classification;
    const interaction = interactions[key] ?? interactions[move.before] ?? {};
    return {
      ply: move.ply, color: move.color, san: move.san, uci: move.uci ?? move.lan,
      fenBefore: move.before, fenAfter: move.after,
      label: c?.label ?? null, loss: c?.loss ?? null,
      evalBefore: c?.evalBefore ?? null, evalAfter: c?.evalAfter ?? null,
      winBefore: c?.winBefore ?? null, winAfter: c?.winAfter ?? null,
      phase: request?.game?.phase ?? gamePhase(move.after, move.moveNumber),
      // Dos campos distintos (no mezclarlos en las métricas de P2):
      // - motif: qué castigó esta jugada (motivo de la refutación del rival). Solo existe cuando el
      //   coach analizó el error; si no, null ("desconocido"), nunca inventado.
      // - moveMotif: qué hizo la propia jugada (captura, jaque, ataque doble, mate…).
      motif: request?.refutation?.motif ?? null,
      moveMotif: moveMotif(move.before, move.uci ?? move.lan, { score: c?.evalAfter })?.motif ?? null,
      coachInterrupted: Boolean(interaction.coachInterrupted || record?.interrupt || record?.interrupted),
      takebackUsed: Boolean(interaction.takebackUsed || record?.decision === 'takeback'),
      hintsUsed: nonNegative(interaction.hintsUsed),
    };
  });
  return { game, moves };
}
