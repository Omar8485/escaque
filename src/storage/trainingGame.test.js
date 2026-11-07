import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { lineFromSans, moveKey } from '../coach/summary.js';
import { buildTrainingGame } from './trainingGame.js';

const line = lineFromSans(undefined, ['e4', 'e5', 'Nf3']);
const input = {
  id: 'session-1', line, playerColor: 'w', playerName: 'Ada', rival: { name: 'Héctor', level: 6, elo: 1500 },
  result: { reason: 'abandon', winner: 'b' }, startedAt: Date.UTC(2026, 10, 2, 12),
  endedAt: Date.UTC(2026, 10, 2, 12, 5), timeControl: { initialSeconds: 300, increment: 3 },
  times: { w: 12345, b: 9876 },
};

describe('buildTrainingGame', () => {
  it('does not save an unfinished game or abandonment before the first move', () => {
    expect(buildTrainingGame({ ...input, result: null })).toBeNull();
    expect(buildTrainingGame({ ...input, line: [] })).toBeNull();
  });

  it('produces a reloadable PGN with English SAN and all training headers', () => {
    const { game, moves } = buildTrainingGame(input);
    expect(game).toMatchObject({ id: 'escaque:session-1', source: 'escaque', white: 'Ada', black: 'Héctor',
      playerColor: 'w', result: '0-1', speed: 'blitz', timeControl: '300+3', rivalLevel: 6,
      timeUsedMs: { w: 12345, b: 9876 }, durationMs: 300000 });
    const chess = new Chess();
    chess.loadPgn(game.pgn);
    expect(chess.history()).toEqual(['e4', 'e5', 'Nf3']);
    expect(chess.getHeaders()).toMatchObject({ Rival: 'Héctor', RivalLevel: '6', PlayerColor: 'w',
      Date: '2026.11.02', UTCTime: '12:00:00', Result: '0-1', Termination: 'abandon', TimeControl: '300+3', WhiteTimeUsedMs: '12345' });
    expect(moves).toHaveLength(3);
    expect(moves[0]).toMatchObject({ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', phase: 'apertura',
      label: null, loss: null, evalBefore: null, evalAfter: null, motif: null, moveMotif: null,
      hintsUsed: 0, coachInterrupted: false, takebackUsed: false });
  });

  it.each(['checkmate', 'stalemate', 'insufficient', 'threefold', 'fifty', 'draw', 'timeout', 'abandon'])(
    'preserves termination %s without needing any new analysis', (reason) => {
      const winner = ['checkmate', 'timeout', 'abandon'].includes(reason) ? 'w' : null;
      const { game } = buildTrainingGame({ ...input, result: { reason, winner } });
      expect(game.termination).toBe(reason);
      expect(game.result).toBe(winner ? '1-0' : '1/2-1/2');
      expect(game.pgn).toContain(`[Termination "${reason}"]`);
    });

  it('keeps profile names intact while making quoted names safe to reload as PGN', () => {
    const name = 'Ada "the rook"\nPlayer';
    const { game } = buildTrainingGame({ ...input, playerName: name });
    expect(game.playerName).toBe(name);
    const chess = new Chess();
    chess.loadPgn(game.pgn);
    expect(chess.history()).toEqual(['e4', 'e5', 'Nf3']);
    expect(chess.getHeaders().White).toBe("Ada 'the rook' Player");
  });

  it('stores black player, stable identity, no-clock games and elapsed times', () => {
    const { game } = buildTrainingGame({ ...input, id: 'escaque:session-1', playerColor: 'b', timeControl: null,
      times: { timeUsedMs: { w: 300, b: 900 }, durationMs: 1200 } });
    expect(game).toMatchObject({ id: 'escaque:session-1', white: 'Héctor', black: 'Ada', whiteElo: 1500,
      blackElo: null, timeControl: null, speed: 'unknown', timeUsedMs: { w: 300, b: 900 }, durationMs: 1200 });
  });

  it('reuses ledger classifications and coach facts and records interactions', () => {
    const key = moveKey(line[0]);
    const classification = { label: 'Mistake', loss: 15, evalBefore: { type: 'cp', value: 35 },
      evalAfter: { type: 'cp', value: -170 }, winBefore: 53, winAfter: 38 };
    const { moves } = buildTrainingGame({ ...input,
      classifications: { [key]: classification },
      coachRecords: { [key]: { request: { refutation: { motif: 'ataque_doble' }, game: { phase: 'apertura' } }, interrupt: true } },
      interactions: { [key]: { hintsUsed: 2, takebackUsed: true } },
    });
    expect(moves[0]).toMatchObject({ ...classification, motif: 'ataque_doble', coachInterrupted: true, takebackUsed: true, hintsUsed: 2 });
    // El motivo de la refutación no se confunde con el de la propia jugada.
    expect(moves[0]).toHaveProperty('moveMotif');
    expect(moves[1].label).toBeNull();
  });

  it('accepts coach classification when the ledger is still pending', () => {
    const { moves } = buildTrainingGame({ ...input, coachRecords: {
      [moveKey(line[0])]: { request: { classification: { label: 'Good', loss: 0 } }, decision: 'takeback' },
    } });
    expect(moves[0]).toMatchObject({ label: 'Good', loss: 0, takebackUsed: true });
  });

  it('attaches position-level help and keeps withdrawn attempts separate from the played line', () => {
    const attempt = { san: 'd4', uci: 'd2d4', takebackUsed: true, hintsUsed: 1 };
    const { game, moves } = buildTrainingGame({ ...input,
      interactions: { [line[0].before]: { hintsUsed: 3, takebackUsed: true } },
      retractedMoves: [attempt],
    });
    expect(moves[0]).toMatchObject({ hintsUsed: 3, takebackUsed: true });
    expect(game.retractedMoves).toEqual([attempt]);
    expect(game.retractedMoves[0]).not.toBe(attempt);
    expect(moves).toHaveLength(3);
  });

  it('preserves checkmate result and a nonstandard initial FEN', () => {
    const mateLine = lineFromSans('7k/8/5KQ1/8/8/8/8/8 w - - 0 1', ['Qg7#']);
    const { game } = buildTrainingGame({ ...input, line: mateLine, result: { reason: 'checkmate', winner: 'w' } });
    const chess = new Chess();
    chess.loadPgn(game.pgn);
    expect(chess.isCheckmate()).toBe(true);
    expect(chess.getHeaders().FEN).toBe(mateLine[0].before);
    expect(chess.getHeaders().Result).toBe('1-0');
  });
});
