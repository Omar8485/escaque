import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENGINE_FILES, isExcluded, precacheConfig, renderServiceWorker } from './pwa.js';

const files = [
  { path: '/index.html', hash: 'a' },
  { path: '/assets/index-abc.js', hash: 'b' },
  { path: '/stockfish/stockfish.js', hash: 'c' },
  { path: '/stockfish/stockfish.wasm', hash: 'd' },
  { path: '/sw.js', hash: 'e' },
  { path: '/_headers', hash: 'f' },
  { path: '/robots.txt', hash: 'g' },
  { path: '/og-image.png', hash: 'h' },
];

describe('precacheConfig', () => {
  it('separa el motor del shell y excluye lo que no hace falta sin conexión', () => {
    const c = precacheConfig(files, 't');
    expect(c.engine).toEqual(ENGINE_FILES);
    expect(c.shell).toEqual(['/assets/index-abc.js', '/index.html']);
    expect(isExcluded('/assets/x.js.map')).toBe(true);
  });
  it('la versión cambia con cualquier archivo o con la plantilla; la del motor solo con el motor', () => {
    const base = precacheConfig(files, 't');
    const otherJs = precacheConfig(files.map((f) => (f.path === '/assets/index-abc.js' ? { ...f, hash: 'x' } : f)), 't');
    const otherEngine = precacheConfig(files.map((f) => (f.path === '/stockfish/stockfish.wasm' ? { ...f, hash: 'x' } : f)), 't');
    expect(otherJs.build).not.toBe(base.build);
    expect(otherJs.engineHash).toBe(base.engineHash);
    expect(otherEngine.engineHash).not.toBe(base.engineHash);
    expect(precacheConfig(files, 'u').build).not.toBe(base.build);
    // Los excluidos no cuentan: robots.txt distinto no es versión nueva.
    expect(precacheConfig(files.map((f) => (f.path === '/robots.txt' ? { ...f, hash: 'z' } : f)), 't').build).toBe(base.build);
  });
  it('es estable ante el orden de entrada', () => {
    expect(precacheConfig([...files].reverse(), 't')).toEqual(precacheConfig(files, 't'));
  });
});

describe('renderServiceWorker', () => {
  it('incrusta la configuración en la plantilla real', () => {
    const template = readFileSync(new URL('../src/pwa/sw-template.js', import.meta.url), 'utf8');
    const out = renderServiceWorker(template, precacheConfig(files, 't'));
    expect(out).not.toContain('__ESCAQUE_SW_CONFIG__');
    expect(out).toContain('"/stockfish/stockfish.wasm"');
    expect(() => new Function(out)).not.toThrow();
  });
});

// El service worker nunca debe interceptar /api: inicio de sesión OIDC (y sus vueltas), webhooks,
// sincronización y /api/me van siempre a la red; una navegación a /api sin red no cae en la app.
describe('service worker: /api siempre a la red', () => {
  const ORIGIN = 'https://escaque.test';
  function loadSw() {
    const template = readFileSync(new URL('../src/pwa/sw-template.js', import.meta.url), 'utf8');
    const code = renderServiceWorker(template, precacheConfig(files, 't'));
    const handlers = {};
    const self = { location: new URL(`${ORIGIN}/sw.js`), addEventListener: (type, fn) => { handlers[type] = fn; }, clients: { claim: async () => {} }, skipWaiting: () => {} };
    const caches = { match: async () => new Response('shell'), open: async () => ({ match: async () => null, put: async () => {} }), keys: async () => [] };
    new Function('self', 'caches', 'fetch', code)(self, caches, async () => new Response('red'));
    /** ¿El SW responde a esta petición? */
    return (url, { method = 'GET', mode = 'cors' } = {}) => {
      let intercepted = false;
      handlers.fetch({ request: { url: new URL(url, ORIGIN).href, method, mode }, respondWith: () => { intercepted = true; } });
      return intercepted;
    };
  }

  it('no intercepta ninguna ruta de la API, ni como navegación ni como fetch', () => {
    const intercepts = loadSw();
    const api = ['/api', '/api/', '/api/me', '/api/health', '/api/auth/login/google?return=%2F', '/api/auth/callback/google?code=x&state=y',
      '/api/auth/callback/microsoft', '/api/auth/logout', '/api/billing/checkout', '/api/billing/portal', '/api/webhooks/polar',
      '/api/sync/pull?cursor=0', '/api/sync/push', '/api/test-oidc/authorize?state=z'];
    for (const path of api) {
      for (const mode of ['navigate', 'cors', 'same-origin']) {
        expect(intercepts(path, { mode }), `${mode} ${path}`).toBe(false);
      }
      expect(intercepts(path, { method: 'POST' }), `POST ${path}`).toBe(false);
    }
  });

  it('sí sirve el shell y los assets (y no confunde rutas parecidas con la API)', () => {
    const intercepts = loadSw();
    expect(intercepts('/', { mode: 'navigate' })).toBe(true);
    expect(intercepts('/?checkout=success', { mode: 'navigate' })).toBe(true);
    expect(intercepts('/assets/index-abc.js')).toBe(true);
    expect(intercepts('/apiary.html', { mode: 'navigate' })).toBe(true);
    expect(intercepts('/sw.js')).toBe(false);
    expect(intercepts('https://accounts.google.com/o/oauth2/v2/auth', { mode: 'navigate' })).toBe(false);
  });
});
