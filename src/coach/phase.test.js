import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import {
  gameFacts,
  gamePhase,
  material,
  materialBalance,
  moveNumberOf,
  nonPawnMaterial,
  plyOf,
} from './phase.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};

describe('ply y número de jugada', () => {
  it('cuentan desde la posición inicial', () => {
    expect(plyOf(START)).toBe(1);
    expect(moveNumberOf(START)).toBe(1);
    const afterE4 = play(['e4']);
    expect(plyOf(afterE4)).toBe(2);
    expect(moveNumberOf(afterE4)).toBe(1);
    expect(plyOf(play(['e4', 'e5']))).toBe(3);
  });

  it('falla con un FEN sin turno', () => {
    expect(() => plyOf('8/8/8/8/8/8/8/8')).toThrow();
  });
});

describe('material', () => {
  it('posición inicial: 39 por bando, 62 sin peones entre ambos', () => {
    expect(material(START)).toEqual({ w: { total: 39, nonPawn: 31 }, b: { total: 39, nonPawn: 31 } });
    expect(nonPawnMaterial(START)).toBe(62);
    expect(materialBalance(START, 'w')).toBe(0);
  });

  it('balance en perspectiva del jugador', () => {
    const fen = play(['e4', 'd5', 'exd5']);
    expect(materialBalance(fen, 'w')).toBe(1);
    expect(materialBalance(fen, 'b')).toBe(-1);
  });
});

describe('gamePhase (§4.3)', () => {
  it('apertura con todo el material antes de la jugada 13', () => {
    expect(gamePhase(START)).toBe('apertura');
    expect(gamePhase(START, 12)).toBe('apertura');
    expect(gamePhase(START, 13)).toBe('medio juego');
  });

  it('medio juego si se cambiaron las damas pronto (44 < 54)', () => {
    const fen = 'rnb1kbnr/pppp1ppp/8/8/8/8/PPP2PPP/RNB1KBNR w KQkq - 0 5';
    expect(nonPawnMaterial(fen)).toBe(44);
    expect(gamePhase(fen)).toBe('medio juego');
  });

  it('final con material sin peones ≤ 26', () => {
    const fen26 = '2r1kb1r/pp4pp/8/8/8/8/PP4PP/2R1KB1R w - - 0 30';
    expect(nonPawnMaterial(fen26)).toBe(26);
    expect(gamePhase(fen26)).toBe('final');
    const fen29 = '2r1kbnr/pp4pp/8/8/8/8/PP4PP/2R1KB1R w - - 0 30';
    expect(nonPawnMaterial(fen29)).toBe(29);
    expect(gamePhase(fen29)).toBe('medio juego');
    expect(gamePhase('4k3/8/8/8/8/8/4P3/R3K3 w - - 0 3')).toBe('final');
  });
});

describe('gameFacts (fixtures de §6)', () => {
  const fenBefore = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
  const fenAfter = play(['Nxe5'], fenBefore);

  it('§6.2: tras 4.Nxe5 con blancas', () => {
    expect(gameFacts({ fenBefore, fenAfter, color: 'w' })).toEqual({
      ply: 7,
      moveNumber: 4,
      phase: 'apertura',
      materialBalance: 1,
    });
  });

  it('§6.3: pista con negras en el turno tras 4.Nxe5', () => {
    expect(gameFacts({ fenBefore: fenAfter, color: 'b' })).toEqual({
      ply: 8,
      moveNumber: 4,
      phase: 'apertura',
      materialBalance: -1,
    });
  });
});
