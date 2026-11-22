import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { upstreamPath } from './proxy.js';

const BASE = 'http://localhost:8787';
const env = { ASSETS: { fetch: vi.fn() } };

afterEach(() => vi.unstubAllGlobals());

describe('worker/proxy (Chess.com)', () => {
  it('lista blanca estricta de rutas', () => {
    const ok = (p) => upstreamPath(new URL(`${BASE}/api/proxy/chesscom${p}`));
    expect(ok('/pub/player/mreko0/games/archives')).toBe('/pub/player/mreko0/games/archives');
    expect(ok('/pub/player/MrEKO0/games/2025/01')).toBe('/pub/player/mreko0/games/2025/01');
    for (const bad of ['/pub/player/x/games/2025/01/pgn', '/pub/player/mreko0', '/pub/player/mreko0/games/archives?callback=x',
      '/pub/player/../../x/games/archives', '/pub/club/x', '//evil.example/pub/player/aa/games/archives']) {
      expect(ok(bad)).toBeNull();
    }
    expect(upstreamPath(new URL(`${BASE}/api/proxy/lichess/api/games/user/x`))).toBeNull();
  });

  it('reenvía GET al host oficial sin cookies, con User-Agent de contacto, y filtra cabeceras', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('{"archives":[]}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'a=b', ETag: '"1"' } }));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request(`${BASE}/api/proxy/chesscom/pub/player/mreko0/games/archives`, { headers: { Cookie: 'sesion=1', Authorization: 'x' } });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ archives: [] });
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('ETag')).toBe('"1"');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.chess.com/pub/player/mreko0/games/archives');
    expect(init.headers).toEqual({ Accept: 'application/json', 'User-Agent': expect.stringMatching(/^Escaque\/.*\+https:\/\//) });
  });

  it('rechaza otros métodos y rutas', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const post = await worker.fetch(new Request(`${BASE}/api/proxy/chesscom/pub/player/mreko0/games/archives`, { method: 'POST' }), env);
    expect(post.status).toBe(405);
    const other = await worker.fetch(new Request(`${BASE}/api/proxy/chesscom/pub/leaderboards`), env);
    expect(other.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pasa el 429 de Chess.com con Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } })));
    const res = await worker.fetch(new Request(`${BASE}/api/proxy/chesscom/pub/player/mreko0/games/2025/01`), env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });
});
