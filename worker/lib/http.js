// Respuestas del Worker: JSON, redirecciones y cabeceras de seguridad.
// Todas las respuestas generadas aquí llevan COOP/COEP (Stockfish multihilo las exige en el documento;
// en las respuestas de la API no estorban) y cabeceras defensivas para una API JSON.

/** Mismos valores que vite.config.js y public/_headers (requeridos por Stockfish multihilo). */
export const CROSS_ORIGIN_ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
});

/** Cabeceras para respuestas de la API (no se aplican a los assets que sirve Cloudflare). */
export const API_SECURITY_HEADERS = Object.freeze({
  ...CROSS_ORIGIN_ISOLATION_HEADERS,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Permissions-Policy': 'interest-cohort=()',
});

/** Añade COOP/COEP a una respuesta (p. ej. assets servidos por la vía de respaldo). */
export function withIsolationHeaders(response) {
  const res = new Response(response.body, response);
  for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS)) res.headers.set(name, value);
  return res;
}

/** Añade las cabeceras de seguridad de la API (y HSTS si la petición fue por HTTPS). */
export function withSecurityHeaders(response, url) {
  const res = new Response(response.body, response);
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) res.headers.set(name, value);
  if (url?.protocol === 'https:') res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

/** Error JSON uniforme: `{ ok: false, error: { kind, ...extra } }`. */
export const jsonError = (status, kind, extra = {}, headers = {}) => json({ ok: false, error: { kind, ...extra } }, status, headers);

/** Redirección 302 sin caché; `cookies` es una lista de valores Set-Cookie. */
export function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/**
 * Lee un cuerpo JSON con tope de tamaño (sin confiar en Content-Length).
 * @returns {Promise<{ok:true, value:any, bytes:number}|{ok:false, status:number, kind:string}>}
 */
export async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, kind: 'payload_too_large' };
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, status: 415, kind: 'unsupported_media_type' };
  const text = await readTextBody(request, maxBytes);
  if (text == null) return { ok: false, status: 413, kind: 'payload_too_large' };
  try {
    return { ok: true, value: JSON.parse(text), bytes: text.length };
  } catch {
    return { ok: false, status: 400, kind: 'invalid_json' };
  }
}

/** Texto del cuerpo, o null si supera `maxBytes` (corta la lectura en cuanto lo supera). */
export async function readTextBody(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ya cerrado */ }
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(buf);
}

/** IP del cliente según Cloudflare (o 'local' en pruebas). */
export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'local';

/** Método permitido o 405. */
export function allow(request, ...methods) {
  if (methods.includes(request.method)) return null;
  return jsonError(405, 'method_not_allowed', {}, { Allow: methods.join(', ') });
}
