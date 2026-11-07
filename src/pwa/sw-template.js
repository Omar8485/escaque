// Service worker de Escaque (plantilla). No se importa desde la app: el plugin de Vite
// (build-tools/pwa.js) lo copia a dist/sw.js tras el build y sustituye la configuración de abajo
// por la lista real de archivos y la versión del build. Sin dependencias.
//
// Estrategia:
//  - install: guarda en caché el "shell" (index.html, JS/CSS del build, iconos, manifiestos, páginas
//    legales) y los archivos de Stockfish (≈7 MB). La app lo registra cuando la página cargó y el
//    motor está "Listo" (src/startup.js), así no compite con la primera visita: el motor se toma de
//    la caché HTTP (lo acaba de descargar la página) y se comprueba su SHA-256 antes de guardarlo.
//  - Stockfish va en una caché propia identificada por el hash de sus archivos: una versión nueva de
//    la app no vuelve a descargarlo si el motor no cambió.
//  - fetch: solo GET del mismo origen y fuera de /api. Primero la caché (los archivos llevan hash o
//    son del mismo build) y, si no está, la red. Las navegaciones sin red caen en index.html.
//  - Excepción: las páginas legales y de licencias van primero a la red (la caché solo sirve sin
//    conexión). Así quien acepta los términos lee siempre la versión publicada, aunque su app sea
//    la de antes y todavía no haya pulsado "Actualizar".
//  - Todas las respuestas que sirve llevan COOP/COEP: sin ellas el navegador no aísla la página
//    (crossOriginIsolated) y Stockfish multihilo no arranca.
//  - Versión nueva: el navegador detecta un sw.js distinto, lo instala y lo deja esperando; la app
//    muestra "Nueva versión disponible — Actualizar", que manda SKIP_WAITING y recarga.

/** @type {{build: string, shell: string[], engine: string[], engineHash: string, engineSha256: Record<string, string>}} */
const CONFIG = __ESCAQUE_SW_CONFIG__;

const PREFIX = 'escaque-';
const SHELL_CACHE = `${PREFIX}shell-${CONFIG.build}`;
const ENGINE_CACHE = `${PREFIX}engine-${CONFIG.engineHash}`;

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * Clave de caché de una ruta: las páginas HTML se guardan sin `.html` (Cloudflare redirige
 * `/x.html` → `/x`) e `index.html` como `/`.
 * @param {string} pathname
 */
function cacheKey(pathname) {
  if (pathname === '/index.html') return '/';
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length);
  if (pathname.endsWith('.html')) return pathname.slice(0, -'.html'.length);
  return pathname;
}

/** Copia la respuesta con COOP/COEP (y sin la marca de "redirigida", que no se puede servir). */
function withIsolation(response) {
  if (!response || response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  if ([101, 204, 205, 304].includes(response.status)) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Archivos con hash en el nombre (assets/…-AbC123.js): inmutables, se pueden copiar de otra caché. */
const isHashedAsset = (path) => path.startsWith('/assets/');

/**
 * Guarda `paths` en la caché `cacheName`. Lo que ya está no se vuelve a pedir; los assets con hash
 * se toman de cualquier caché anterior antes que de la red.
 */
async function fill(cacheName, paths) {
  const cache = await caches.open(cacheName);
  await Promise.all(
    paths.map(async (path) => {
      const key = cacheKey(path);
      if (await cache.match(key)) return;
      if (isHashedAsset(path)) {
        const old = await caches.match(key);
        if (old) return cache.put(key, old);
      }
      // Lo que no lleva hash (index.html, manifiestos…) se pide revalidando la caché HTTP.
      const res = await fetch(path, { cache: isHashedAsset(path) ? 'default' : 'no-cache' });
      if (!res.ok) throw new Error(`precache ${path}: HTTP ${res.status}`);
      await cache.put(key, withIsolation(res));
    }),
  );
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Motor: primero la caché HTTP (sin red si la página ya lo descargó); si su contenido no es el de
 * este build, se pide de nuevo a la red.
 */
async function fillEngine() {
  const cache = await caches.open(ENGINE_CACHE);
  for (const path of CONFIG.engine) {
    if (await cache.match(path)) continue;
    let res = null;
    for (const mode of ['force-cache', 'no-cache']) {
      const r = await fetch(path, { cache: mode });
      if (!r.ok) continue;
      const body = await r.clone().arrayBuffer();
      if (hex(await crypto.subtle.digest('SHA-256', body)) === CONFIG.engineSha256[path]) {
        res = r;
        break;
      }
    }
    if (!res) throw new Error(`precache ${path}: contenido distinto del build`);
    await cache.put(path, withIsolation(res));
  }
}

self.addEventListener('install', (event) => {
  // Sin skipWaiting: la versión nueva espera a que el usuario pulse "Actualizar".
  event.waitUntil(Promise.all([fill(SHELL_CACHE, CONFIG.shell), fillEngine()]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ENGINE_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !keep.has(name)) await caches.delete(name);
      }
      // Toma el control de las pestañas abiertas: así, en la primera visita, lo que se cargue después
      // (pantallas diferidas, el motor) ya sale de la caché y sirve sin conexión.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ build: CONFIG.build });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Otros orígenes (Lichess, Chess.com, proveedores de IA, analítica) y la API: siempre a la red.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
  event.respondWith(respond(req, url));
});

/** Páginas que se piden primero a la red (claves de caché, sin `.html`). */
const NETWORK_FIRST = new Set(['/privacidad', '/privacy', '/terminos', '/terms', '/licencias', '/licenses']);

async function networkFirst(req, key) {
  try {
    // Por URL (no el Request de navegación, que no sigue redirecciones /x.html → /x).
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(key, withIsolation(res.clone())).catch(() => {});
      return withIsolation(res);
    }
    const cached = await caches.match(key);
    return withIsolation(cached ?? res);
  } catch (err) {
    const cached = await caches.match(key);
    if (cached) return withIsolation(cached);
    throw err;
  }
}

async function respond(req, url) {
  const key = cacheKey(url.pathname);
  if (NETWORK_FIRST.has(key)) return networkFirst(req, key);
  const isNavigation = req.mode === 'navigate';
  const cached = await caches.match(key, { ignoreSearch: isNavigation });
  if (cached) return withIsolation(cached);
  try {
    return withIsolation(await fetch(req));
  } catch (err) {
    // Sin conexión y fuera de la caché: una navegación abre la app; lo demás falla como sin SW.
    if (isNavigation) {
      const shell = await caches.match('/');
      if (shell) return withIsolation(shell);
    }
    throw err;
  }
}
