import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORES, _resetDbForTests, count, getMeta, listGamesNewestFirst, setMeta } from '../storage/db.js';
import { buildLichessUrl, importLichess, readNdjson } from './lichess.js';
import { archiveMonth, importChessCom } from './chesscom.js';
import { detectPlayer, hashPgn, importPgnGames, readPgnFiles, splitPgn } from './pgn.js';
import { clearAllGames, getAccounts, setAccount } from './store.js';
import { importErrorText } from './net.js';
import { getT } from '../i18n/core.js';

const fixture = (name) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const LICHESS = JSON.parse(fixture('lichess-user.ndjson').trim());

afterEach(async () => {
  await _resetDbForTests();
  await new Promise((resolve) => {
    const r = indexedDB.deleteDatabase('escaque');
    r.onsuccess = r.onerror = resolve;
  });
});

/** Respuesta en streaming partida a partida, cortando las líneas en trozos arbitrarios. */
function streamResponse(text, { status = 200, chunk = 37, headers = {} } = {}) {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
  return new Response(body, { status, headers });
}
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/** N partidas de Lichess a partir del ejemplo oficial (ids y fechas distintos). */
const lichessGames = (n, base = 1_700_000_000_000) =>
  Array.from({ length: n }, (_, i) => ({ ...LICHESS, id: `g${String(i).padStart(7, '0')}`, createdAt: base + i * 1000, lastMoveAt: base + i * 1000 + 500 }));
const ndjson = (games) => games.map((g) => JSON.stringify(g)).join('\n') + '\n';

describe('Lichess', () => {
  it('URL con los parámetros documentados', () => {
    const u = new URL(buildLichessUrl('jugador_demo', { max: 20, since: 5, sort: 'dateAsc' }));
    expect(u.origin + u.pathname).toBe('https://lichess.org/api/games/user/jugador_demo');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      max: '20', since: '5', sort: 'dateAsc', pgnInJson: 'true', clocks: 'true', opening: 'true', finished: 'true',
      perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence',
    });
  });

  it('lee NDJSON por trozos', async () => {
    const seen = [];
    await readNdjson(streamResponse('{"a":1}\n\n{"a":2}\n{"a":3}', { chunk: 3 }), (o) => seen.push(o.a));
    expect(seen).toEqual([1, 2, 3]);
  });

  it('importa con progreso, guarda la marca y la siguiente vez solo pide las nuevas', async () => {
    const games = lichessGames(3);
    const variant = { ...LICHESS, id: 'v960xxxx', variant: 'chess960', createdAt: 1 };
    const fetchImpl = vi.fn(async () => streamResponse(ndjson([...games].reverse().concat(variant))));
    const progress = [];
    const r = await importLichess('Lance5500', { max: 200, fetchImpl, onProgress: (p) => progress.push(p) });
    expect(r).toMatchObject({ received: 4, added: 3, skipped: 1, incremental: false, hasMore: false, aborted: false });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Accept: 'application/x-ndjson' });
    expect(progress.filter((p) => p.phase === 'reading').map((p) => p.received)).toEqual([1, 2, 3, 4]);
    expect(await count(STORES.games)).toBe(3);
    const mark = await getMeta('import:lichess:lance5500');
    expect(mark.lastCreatedAt).toBe(games[2].createdAt);

    // Segunda importación: since = marca + 1, en orden ascendente; reimportar no duplica.
    const more = lichessGames(5);
    fetchImpl.mockImplementation(async () => streamResponse(ndjson(more.slice(2))));
    const r2 = await importLichess('Lance5500', { max: 200, fetchImpl });
    const url = new URL(fetchImpl.mock.calls[1][0]);
    expect(url.searchParams.get('since')).toBe(String(games[2].createdAt + 1));
    expect(url.searchParams.get('sort')).toBe('dateAsc');
    expect(r2).toMatchObject({ incremental: true, received: 3, added: 2 });
    expect(await count(STORES.games)).toBe(5);
  });

  it('ante 429 espera lo indicado y reintenta (una petición a la vez)', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : streamResponse(ndjson(lichessGames(1)))));
    const phases = [];
    const r = await importLichess('Lance5500', { fetchImpl, onProgress: (p) => phases.push(p.phase) });
    expect(r.added).toBe(1);
    expect(phases).toContain('waiting');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('usuario inexistente y nombre no válido', async () => {
    await expect(importLichess('nadie', { fetchImpl: async () => new Response('', { status: 404 }) })).rejects.toMatchObject({ kind: 'not_found' });
    await expect(importLichess('../x', { fetchImpl: vi.fn() })).rejects.toMatchObject({ kind: 'invalid_user' });
  });

  it('cancelar conserva lo leído y no mueve la marca en la primera importación', async () => {
    const ctrl = new AbortController();
    const games = lichessGames(120).reverse();
    const fetchImpl = async () => streamResponse(ndjson(games), { chunk: 4000 });
    const r = await importLichess('Lance5500', {
      fetchImpl,
      signal: ctrl.signal,
      onProgress: (p) => p.received === 60 && ctrl.abort(),
    });
    expect(r.aborted).toBe(true);
    expect(await count(STORES.games)).toBeGreaterThanOrEqual(50);
    expect(await getMeta('import:lichess:lance5500')).toBeUndefined();
  });
});

describe('Chess.com', () => {
  const archives = JSON.parse(fixture('chesscom-archives.json'));
  const months = { '2024/12': JSON.parse(fixture('chesscom-2024-12.json')), '2025/01': JSON.parse(fixture('chesscom-2025-01.json')) };
  const api = (overrides = {}) =>
    vi.fn(async (url) => {
      const u = String(url);
      if (u in overrides) return overrides[u]();
      if (u.endsWith('/games/archives')) return jsonResponse(archives);
      const m = /games\/(\d{4}\/\d{2})$/.exec(u);
      return m && months[m[1]] ? jsonResponse(months[m[1]]) : jsonResponse({ code: 0, message: 'not found' }, 404);
    });

  it('archiveMonth solo acepta archivos mensuales del host oficial', () => {
    expect(archiveMonth('https://api.chess.com/pub/player/x/games/2025/01')).toBe('2025/01');
    expect(archiveMonth('https://evil.example/pub/player/x/games/2025/01')).toBeNull();
  });

  it('importa en serie del mes más nuevo hacia atrás, solo ajedrez estándar', async () => {
    const fetchImpl = api();
    const r = await importChessCom('MrEKO0', { fetchImpl, now: () => Date.UTC(2025, 1, 15) });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'https://api.chess.com/pub/player/mreko0/games/archives',
      'https://api.chess.com/pub/player/mreko0/games/2025/01',
      'https://api.chess.com/pub/player/mreko0/games/2024/12',
    ]);
    expect(r).toMatchObject({ received: 8, added: 7, skipped: 1, incremental: false });
    const saved = await listGamesNewestFirst();
    expect(saved.every((g) => g.source === 'chesscom' && g.playerColor)).toBe(true);
    expect(await getMeta('import:chesscom:mreko0')).toMatchObject({ lastArchive: '2025/01', monthClosed: true });

    // Incremental: el último mes ya estaba cerrado → no se vuelve a pedir ningún mes.
    const r2 = await importChessCom('mreko0', { fetchImpl, now: () => Date.UTC(2025, 1, 16) });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(r2).toMatchObject({ incremental: true, received: 0, added: 0 });
  });

  it('límite de partidas en la primera importación', async () => {
    const r = await importChessCom('mreko0', { fetchImpl: api(), max: 4 });
    expect(r).toMatchObject({ received: 4, hasMore: true });
  });

  it('si el navegador bloquea la respuesta (CORS), reintenta por el Worker', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const u = String(url);
      if (u.startsWith('https://')) throw new TypeError('Failed to fetch');
      if (u === '/api/proxy/chesscom/pub/player/mreko0/games/archives') return jsonResponse({ archives: archives.archives.slice(1) });
      return jsonResponse(months['2025/01']);
    });
    const r = await importChessCom('mreko0', { fetchImpl });
    expect(r.added).toBe(5);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toContain('/api/proxy/chesscom/pub/player/mreko0/games/2025/01');
  });

  it('sin Worker (respuesta HTML) da un error de red claro', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).startsWith('https://')) throw new TypeError('Failed to fetch');
      return new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
    });
    await expect(importChessCom('mreko0', { fetchImpl })).rejects.toMatchObject({ kind: 'network' });
  });

  it('usuario inexistente', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, message: 'User "x" not found.' }, 404));
    await expect(importChessCom('noexiste', { fetchImpl })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('los errores se muestran en el idioma de la interfaz (textKey + vars)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, message: 'User "x" not found.' }, 404));
    const err = await importChessCom('noexiste', { fetchImpl }).catch((e) => e);
    expect(importErrorText(err, getT('es'))).toBe('Chess.com no tiene el usuario «noexiste».');
    expect(importErrorText(err, getT('en'))).toBe('Chess.com has no user "noexiste".');
    expect(importErrorText(new Error('otro'), getT('en')), 'otros errores: su mensaje').toBe('otro');
  });
});

describe('archivo PGN', () => {
  const text = fixture('demo-lichess.pgn');
  const file = (name, body) => ({ name, text: async () => body });

  it('separa partidas (CRLF, BOM, comentarios con corchetes)', () => {
    const crlf = `\uFEFF${text.replace(/\n/g, '\r\n')}`;
    expect(splitPgn(crlf)).toHaveLength(3);
    expect(splitPgn('[Event "a"]\n\n1. e4 { [%clk 0:05:00]\n[no es cabecera] } e5 *\n[Event "b"]\n1. d4 *')).toHaveLength(2);
  });

  it('hash estable: mismo contenido con otros espacios → mismo id', async () => {
    const [a] = splitPgn(text);
    expect(await hashPgn(a)).toBe(await hashPgn(a.replace(/\n/g, '\r\n').replace(/ /g, '  ')));
    expect(await hashPgn(a)).toMatch(/^[0-9a-f]{24}$/);
  });

  it('detecta al usuario, ignora duplicados y guarda con su color', async () => {
    const read = await readPgnFiles([file('a.pgn', text), file('b.pgn', splitPgn(text)[0])]);
    expect(read).toMatchObject({ files: 2, duplicates: 1, suggested: 'jugador_demo' });
    expect(read.entries).toHaveLength(3);
    expect(detectPlayer(read.entries)[0]).toEqual({ name: 'jugador_demo', count: 3 });
    const r = await importPgnGames(read.entries, read.suggested);
    expect(r).toEqual({ received: 3, added: 3, skipped: 0 });
    const games = await listGamesNewestFirst();
    expect(games.map((g) => g.playerColor)).toEqual(['b', 'b', 'b']);
    expect(games.map((g) => g.speed).sort()).toEqual(['blitz', 'classical', 'rapid']);
    // Subir el mismo archivo otra vez no duplica.
    expect((await importPgnGames(read.entries, read.suggested)).added).toBe(0);
  });

  it('sin un nombre claramente mayoritario no sugiere ninguno', async () => {
    const read = await readPgnFiles([file('x.pgn', '[White "a"]\n[Black "b"]\n\n1. e4 *\n\n[White "c"]\n[Black "d"]\n\n1. d4 *')]);
    expect(read.suggested).toBeNull();
  });
});

describe('cuentas y borrado', () => {
  it('vincula cuentas y borrar todas quita partidas, análisis y marcas (no las cuentas)', async () => {
    await setAccount('lichess', 'jugador_demo');
    await setAccount('chesscom', 'mreko0');
    await setAccount('chesscom', null);
    expect(await getAccounts()).toEqual({ lichess: 'jugador_demo' });
    await importLichess('Lance5500', { fetchImpl: async () => streamResponse(ndjson(lichessGames(2))) });
    await setMeta('otra', 1);
    await clearAllGames();
    expect(await count(STORES.games)).toBe(0);
    expect(await getMeta('import:lichess:lance5500')).toBeUndefined();
    expect(await getMeta('otra')).toBe(1);
    expect(await getAccounts()).toEqual({ lichess: 'jugador_demo' });
  });
});
