// Cookies de mismo origen. En HTTPS llevan el prefijo `__Host-` (exige Secure, Path=/ y sin Domain):
// así ningún subdominio puede fijarlas ni leerlas. En http://localhost (wrangler dev) se usa el nombre
// sin prefijo; `Secure` se mantiene porque los navegadores tratan localhost como contexto seguro.

/** Nombre real de la cookie según el esquema de la petición. */
export const cookieName = (url, base) => (url.protocol === 'https:' ? `__Host-${base}` : base);

export function parseCookies(request) {
  const out = {};
  const header = request.headers.get('Cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{maxAge?: number}} [o] segundos; 0 borra la cookie
 */
export function serializeCookie(name, value, { maxAge } = {}) {
  let c = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (maxAge != null) c += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
  return c;
}

export const clearCookie = (name) => serializeCookie(name, '', { maxAge: 0 });
