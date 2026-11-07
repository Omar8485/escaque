import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gameFromLegacy, gamesFromText, pgnDateToMs, pgnHeaders, speedOf, splitPgn } from './sources.js';

const PGN = fs.readFileSync(new URL('../__fixtures__/games.pgn', import.meta.url), 'utf8');

describe('sources (solo Node/tests)', () => {
  it('separa un PGN con varias partidas y lee cabeceras', () => {
    const parts = splitPgn(PGN);
    expect(parts).toHaveLength(3);
    expect(pgnHeaders(parts[1])).toMatchObject({ White: 'rival_b', Black: 'Tester', TimeControl: '600' });
  });

  it('convierte a Game, de la más reciente a la más antigua', () => {
    const games = gamesFromText(PGN, { user: 'tester' });
    expect(games.map((g) => g.id.split(':')[0])).toEqual(['lichess', 'chesscom', 'pgn']);
    expect(games[0]).toMatchObject({ id: 'lichess:AbCdEf12', url: 'https://lichess.org/AbCdEf12', playerColor: 'w', speed: 'blitz', rated: true, whiteElo: 1500, endTime: Date.UTC(2025, 9, 1, 18, 30) });
    expect(games[1]).toMatchObject({ id: 'chesscom:123456789', playerColor: 'b', speed: 'rapid', rated: null, result: '1-0' });
    expect(games[2].playerColor).toBe('w');
    // Reimportar el mismo archivo da los mismos ids.
    expect(gamesFromText(PGN, { user: 'tester' }).map((g) => g.id)).toEqual(games.map((g) => g.id));
  });

  it('lee el formato antiguo de partidas.json conservando el orden del día', () => {
    const legacy = [
      { evento: 'rated blitz game', sitio: 'https://lichess.org/Demo0014', fecha: '2025.10.10', blancas: 'x', negras: 'jugador_demo', resultado: '0-1', elo_blancas: 1458, elo_negras: 1495, control_tiempo: '300+3', apertura: 'Pirc Defense', movimientos: '1. e4 d6 0-1' },
      { evento: 'rated blitz game', sitio: 'https://lichess.org/Demo0006', fecha: '2025.10.10', blancas: 'jugador_demo', negras: 'y', resultado: '1-0', control_tiempo: '180+2', movimientos: '1. d4 d5 1-0' },
    ];
    const games = gamesFromText(JSON.stringify(legacy));
    expect(games.map((g) => g.id)).toEqual(['lichess:Demo0014', 'lichess:Demo0006']);
    expect(games.map((g) => g.playerColor)).toEqual(['b', 'w']);
    expect(games[0].pgn).toContain('[White "x"]');
    expect(gameFromLegacy(legacy[0]).opening).toBe('Pirc Defense');
  });

  it('fechas y ritmos', () => {
    expect(pgnDateToMs('2025.??.??')).toBeNull();
    expect(pgnDateToMs('2025.01.02')).toBe(Date.UTC(2025, 0, 2, 12));
    expect(speedOf('60+0')).toBe('bullet');
    expect(speedOf('-')).toBe('unknown');
    expect(speedOf('1800+30')).toBe('classical');
  });
});
