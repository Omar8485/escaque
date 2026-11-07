import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  displayPlayerName, platformIdFromUrl,
  normalizeChessComGame, normalizeLichessGame, normalizePgnGame, openingFromEcoUrl, outcomeFor, parsePgnHeaders,
  parseTimeControl, pgnDateTimeToMs, speedFromTimeControl, userRatingFromGames,
} from './normalize.js';
import { getT } from '../i18n/core.js';

const fixture = (name) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
// Ejemplo oficial de la documentación de la API de Lichess (partida real BLce71aZ).
const LICHESS = JSON.parse(fixture('lichess-user.ndjson').trim().split('\n')[0]);
// Mes real de la Published-Data API de Chess.com (recortado a 6 partidas).
const CHESSCOM = JSON.parse(fixture('chesscom-2025-01.json')).games;

describe('ritmo con los cortes de Lichess', () => {
  it.each([
    ['15+0', 'ultraBullet'], ['0+1', 'bullet'], ['60', 'bullet'], ['120+1', 'bullet'], ['120+2', 'blitz'], ['180', 'blitz'],
    ['300+3', 'blitz'], ['480', 'rapid'], ['600', 'rapid'], ['900+10', 'rapid'], ['1500', 'classical'],
    ['1800+45', 'classical'], ['1/259200', 'correspondence'], ['-', 'unknown'], [null, 'unknown'], ['?', 'unknown'],
  ])('%s → %s', (tc, speed) => expect(speedFromTimeControl(tc)).toBe(speed));

  it('lee los formatos de control de tiempo', () => {
    expect(parseTimeControl('180+2')).toEqual({ base: 180, inc: 2 });
    expect(parseTimeControl('1/86400')).toEqual({ daily: 86400 });
    expect(parseTimeControl('')).toBeNull();
  });
});

describe('cabeceras PGN y fechas', () => {
  it('lee cabeceras con comillas escapadas', () => {
    expect(parsePgnHeaders('[White "A \\"B\\""]\n[Result "1-0"]\n\n1. e4 1-0')).toEqual({ White: 'A "B"', Result: '1-0' });
  });
  it('fecha y hora UTC; fecha desconocida → null', () => {
    expect(pgnDateTimeToMs('2026.10.26', '16:27:17')).toBe(Date.UTC(2026, 9, 26, 16, 27, 17));
    expect(pgnDateTimeToMs('????.??.??')).toBeNull();
  });
  it('apertura desde el enlace ECOUrl', () => {
    expect(openingFromEcoUrl('https://www.chess.com/openings/French-Defense-Advance-Variation-3...c5')).toBe('French Defense Advance Variation');
  });
});

describe('Lichess', () => {
  it('normaliza la partida del ejemplo oficial', () => {
    const g = normalizeLichessGame(LICHESS, 'lance5500', 123);
    expect(g).toMatchObject({
      id: 'lichess:BLce71aZ', source: 'lichess', externalId: 'BLce71aZ', url: 'https://lichess.org/BLce71aZ/black',
      white: 'bonerook', black: 'Lance5500', whiteElo: 1780, blackElo: 2563, result: '0-1',
      endTime: 1793032619869, timeControl: '300+0', speed: 'blitz', rated: false, variant: 'standard',
      eco: 'B50', opening: 'Sicilian Defense: Modern Variations', termination: 'outoftime',
      playerName: 'Lance5500', playerColor: 'b', importedAt: 123,
    });
    expect(g.pgn).toMatch(/^\[Event "Coach LM Lance5500 simul"\]/);
    expect(outcomeFor(g)).toBe('win');
  });
  it('descarta variantes, posiciones iniciales distintas y partidas sin terminar', () => {
    expect(normalizeLichessGame({ ...LICHESS, variant: 'chess960' }, 'x')).toBeNull();
    expect(normalizeLichessGame({ ...LICHESS, variant: 'fromPosition' }, 'x')).toBeNull();
    expect(normalizeLichessGame({ ...LICHESS, status: 'aborted' }, 'x')).toBeNull();
    expect(normalizeLichessGame({ ...LICHESS, pgn: '[Event "x"]\n\n*' }, 'x')).toBeNull();
  });
  it('tablas sin ganador y rival Stockfish', () => {
    const g = normalizeLichessGame(
      { ...LICHESS, winner: undefined, status: 'draw', players: { white: LICHESS.players.white, black: { aiLevel: 3 } } },
      'bonerook',
    );
    expect(g).toMatchObject({ result: '1/2-1/2', black: 'Stockfish nivel 3', blackElo: null, playerColor: 'w' });
  });
});

describe('Chess.com', () => {
  it('normaliza una partida rápida (usuario sin distinguir mayúsculas)', () => {
    const raw = CHESSCOM[0];
    const g = normalizeChessComGame(raw, 'mreko0', 1);
    expect(g).toMatchObject({
      id: `chesscom:${raw.url.split('/').pop()}`, source: 'chesscom', url: raw.url, white: 'MrEKO0', playerName: 'MrEKO0', playerColor: 'w',
      result: '1-0', timeControl: '600', speed: 'rapid', rated: true, endTime: raw.end_time * 1000, variant: 'standard',
    });
    expect(g.pgn).toContain('[%clk');
    expect(g.eco).toMatch(/^[A-E]\d\d$/);
  });
  it('tablas por tiempo contra material insuficiente, bullet y diaria', () => {
    const results = CHESSCOM.map((r) => normalizeChessComGame(r, 'MrEKO0')).filter(Boolean);
    expect(results.find((g) => g.timeControl === '600' && g.result === '1/2-1/2')).toBeTruthy();
    expect(results.find((g) => g.speed === 'bullet')).toBeTruthy();
    expect(results.find((g) => g.speed === 'correspondence')?.timeControl).toBe('1/259200');
  });
  it('descarta ajedrez con ventaja (oddschess) y posiciones iniciales distintas', () => {
    const odds = CHESSCOM.filter((r) => r.rules !== 'chess');
    expect(odds.length).toBeGreaterThan(0);
    for (const r of odds) expect(normalizeChessComGame(r, 'MrEKO0')).toBeNull();
    expect(normalizeChessComGame({ ...CHESSCOM[0], rules: 'chess960' }, 'MrEKO0')).toBeNull();
    expect(normalizeChessComGame({ ...CHESSCOM[0], initial_setup: '8/8/8/8/8/8/8/K6k w - - 0 1' }, 'MrEKO0')).toBeNull();
  });
});

describe('archivo PGN', () => {
  const pgn = fixture('demo-lichess.pgn').split(/\n(?=\[Event )/)[0];
  it('normaliza con el usuario indicado', () => {
    const g = normalizePgnGame({ pgn, hash: 'abc' }, 'JUGADOR_DEMO', 5);
    expect(g).toMatchObject({
      id: 'lichess:Demo0014', source: 'lichess', externalId: 'Demo0014', url: 'https://lichess.org/Demo0014', white: 'saeid88888', black: 'jugador_demo',
      whiteElo: 1458, blackElo: 1495, result: '0-1', timeControl: '300+3', speed: 'blitz', eco: 'B07', opening: 'Pirc Defense',
      playerColor: 'b', playerName: 'jugador_demo', endTime: Date.UTC(2025, 9, 10, 12), importedAt: 5,
    });
  });
  it('sin usuario: playerColor null; variantes fuera', () => {
    expect(normalizePgnGame({ pgn, hash: 'a' }, null).playerColor).toBeNull();
    expect(normalizePgnGame({ pgn: pgn.replace('Standard', 'Chess960'), hash: 'a' }, null)).toBeNull();
    expect(normalizePgnGame({ pgn: `[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n[SetUp "1"]\n${pgn}`, hash: 'a' }, null)).toBeNull();
  });
});

describe('rating del usuario', () => {
  const g = (speed, endTime, elo) => ({ speed, endTime, playerColor: 'w', whiteElo: elo, blackElo: 1000 });
  it('último Elo del ritmo más jugado', () => {
    const games = [g('blitz', 1, 1400), g('blitz', 3, 1450), g('blitz', 2, 1420), g('rapid', 9, 1600)];
    expect(userRatingFromGames(games)).toEqual({ rating: 1450, speed: 'blitz', games: 3 });
  });
  it('sin partidas con Elo → null', () => {
    expect(userRatingFromGames([])).toBeNull();
    expect(userRatingFromGames([{ ...g('blitz', 1, null), playerColor: null }])).toBeNull();
  });
});

describe('platformIdFromUrl (evita duplicados entre API y PGN)', () => {
  it('reconoce enlaces de Lichess y Chess.com', () => {
    expect(platformIdFromUrl('https://lichess.org/Demo0014')).toEqual({ source: 'lichess', externalId: 'Demo0014' })
    expect(platformIdFromUrl('https://lichess.org/Demo0014ab12/black#30')).toEqual({ source: 'lichess', externalId: 'Demo0014' })
    expect(platformIdFromUrl('https://www.chess.com/game/live/129983338309')).toEqual({ source: 'chesscom', externalId: '129983338309' })
    expect(platformIdFromUrl('https://www.chess.com/game/daily/123')).toEqual({ source: 'chesscom', externalId: '123' })
    expect(platformIdFromUrl('https://lichess.org/game/BLce71aZ')).toEqual({ source: 'lichess', externalId: 'BLce71aZ' })
    expect(platformIdFromUrl('https://lichess.org/@/jugador_demo')).toBeNull()
    expect(platformIdFromUrl('https://example.com/x')).toBeNull()
    expect(platformIdFromUrl(undefined)).toBeNull()
  })

  it('un PGN exportado de Lichess tiene el mismo id que la partida importada por la API', () => {
    const pgn = '[Event "x"]\n[Site "https://lichess.org/AbCd1234"]\n[White "a"]\n[Black "b"]\n[Result "1-0"]\n[Variant "Standard"]\n\n1. e4 e5 1-0'
    const g = normalizePgnGame({ pgn, hash: 'h' }, 'a')
    expect(g.id).toBe('lichess:AbCd1234')
  })
})

describe('displayPlayerName', () => {
  it('traduce los nombres que pone la importación y deja los demás', () => {
    expect(displayPlayerName('Stockfish nivel 3', getT('en'))).toBe('Stockfish level 3');
    expect(displayPlayerName('Anónimo', getT('en'))).toBe('Anonymous');
    expect(displayPlayerName('Anónimo', getT('es'))).toBe('Anónimo');
    expect(displayPlayerName('jugador_demo', getT('en'))).toBe('jugador_demo');
  });
});
