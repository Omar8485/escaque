// Reenvío mínimo a la Published-Data API de Chess.com para la importación de partidas.
// Solo se usa si el navegador no puede leer la respuesta directa (CORS no documentado por
// Chess.com; ver src/import/chesscom.js). Lichess no lo necesita: envía CORS abierto.
//
// Lista blanca estricta: solo GET/HEAD a dos rutas del host oficial (archivos de un jugador y un mes).
// No reenvía cabeceras, cookies ni parámetros del navegador; no devuelve Set-Cookie.
// Escaque no está afiliado a Chess.com.

const UPSTREAM = 'https://api.chess.com';
const PREFIX = '/api/proxy/chesscom';
const ALLOWED = [/^\/pub\/player\/[a-z0-9_-]{2,30}\/games\/archives$/, /^\/pub\/player\/[a-z0-9_-]{2,30}\/games\/\d{4}\/\d{2}$/];
const PASS_HEADERS = ['Content-Type', 'Cache-Control', 'ETag', 'Last-Modified', 'Retry-After'];
// Chess.com pide un User-Agent reconocible con datos de contacto. Se puede cambiar con PROXY_CONTACT.
const DEFAULT_CONTACT = 'https://github.com/Omar8485/escaque';

const jsonError = (status, kind, extra = {}) =>
  new Response(JSON.stringify({ ok: false, error: { kind } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

/** Ruta del host oficial para una petición `/api/proxy/chesscom/…`, o null si no está permitida. */
export function upstreamPath(url) {
  if (!url.pathname.startsWith(`${PREFIX}/`) || url.search) return null;
  const path = url.pathname.slice(PREFIX.length).toLowerCase();
  return ALLOWED.some((re) => re.test(path)) ? path : null;
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {(r:Response)=>Response} [wrap] añade COOP/COEP (lo pasa worker/index.js)
 * @param {{PROXY_CONTACT?:string}} [env]
 */
export async function handleProxy(request, url, wrap = (r) => r, env = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return wrap(jsonError(405, 'method_not_allowed', { Allow: 'GET, HEAD' }));
  const path = upstreamPath(url);
  if (!path) return wrap(jsonError(404, 'not_found'));

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}${path}`, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        'User-Agent': `Escaque/1.0 (importador de partidas; +${env.PROXY_CONTACT || DEFAULT_CONTACT})`,
      },
      redirect: 'manual',
      // Caché en el borde de Cloudflare: Chess.com refresca estos datos como mucho cada 12–24 h.
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch {
    return wrap(jsonError(502, 'upstream_unreachable'));
  }
  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  if (upstream.status >= 300 && upstream.status < 400) return wrap(jsonError(502, 'upstream_redirect'));
  return wrap(new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers }));
}
