// Verificación de id_token (JWT RS256) con claves JWKS, sin dependencias.
// Pasos de OpenID Connect Core §3.1.3.7: firma con la clave publicada por el proveedor (jwks_uri),
// `iss` exacto, `aud` = nuestro client_id, `exp` futuro, `iat` no futuro y `nonce` igual al enviado.
import { base64UrlDecode } from './crypto.js';

const dec = new TextDecoder();
/** Tolerancia de reloj entre el proveedor y Cloudflare. */
export const CLOCK_SKEW_S = 300;

export class TokenError extends Error {
  constructor(reason) {
    super(`id_token inválido: ${reason}`);
    this.reason = reason;
  }
}

/** Separa un JWT compacto. No verifica nada. */
export function decodeJwt(token) {
  if (typeof token !== 'string' || token.length > 16384) throw new TokenError('format');
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('format');
  try {
    const header = JSON.parse(dec.decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(dec.decode(base64UrlDecode(parts[1])));
    const signature = base64UrlDecode(parts[2]);
    return { header, payload, signature, signingInput: `${parts[0]}.${parts[1]}` };
  } catch {
    throw new TokenError('format');
  }
}

/**
 * Caché de JWKS por URL (en memoria del isolate). Si llega un `kid` desconocido se vuelve a pedir,
 * como mucho una vez por minuto (rotación de claves de Google y Microsoft).
 */
const jwksCache = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_REFETCH_MIN_MS = 60 * 1000;

/** Solo para tests. */
export const _clearJwksCache = () => jwksCache.clear();

/**
 * Busca la clave `kid` en el JWKS remoto.
 * @param {string} url
 * @param {string} kid
 * @param {{fetchImpl?: typeof fetch, now?: number}} [o]
 */
export async function getJwk(url, kid, { fetchImpl = fetch, now = Date.now() } = {}) {
  let entry = jwksCache.get(url);
  const stale = !entry || now - entry.fetchedAt > JWKS_TTL_MS;
  const missing = entry && !entry.keys.some((k) => k.kid === kid) && now - entry.fetchedAt > JWKS_REFETCH_MIN_MS;
  if (stale || missing) {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new TokenError('jwks_unavailable');
    const body = await res.json();
    if (!Array.isArray(body?.keys)) throw new TokenError('jwks_invalid');
    entry = { keys: body.keys, fetchedAt: now };
    jwksCache.set(url, entry);
  }
  return entry.keys.find((k) => k.kid === kid) ?? null;
}

/**
 * Verifica firma y claims de un id_token.
 * @param {string} token
 * @param {{
 *   issuer: string|string[],
 *   audience: string,
 *   nonce: string,
 *   resolveKey: (kid:string)=>Promise<JsonWebKey|null>,
 *   now?: number,
 * }} o
 * @returns {Promise<Record<string, any>>} claims
 */
export async function verifyIdToken(token, { issuer, audience, nonce, resolveKey, now = Date.now() }) {
  const { header, payload, signature, signingInput } = decodeJwt(token);
  if (header.alg !== 'RS256') throw new TokenError('alg');
  if (typeof header.kid !== 'string') throw new TokenError('kid');
  const jwk = await resolveKey(header.kid);
  if (!jwk || jwk.kty !== 'RSA') throw new TokenError('unknown_key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(signingInput));
  if (!valid) throw new TokenError('signature');

  const issuers = Array.isArray(issuer) ? issuer : [issuer];
  if (!issuers.includes(payload.iss)) throw new TokenError('iss');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw new TokenError('aud');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience) throw new TokenError('azp');
  const nowS = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) throw new TokenError('exp');
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_S > nowS) throw new TokenError('iat');
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_S > nowS) throw new TokenError('nbf');
  if (payload.nonce !== nonce) throw new TokenError('nonce');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new TokenError('sub');
  return payload;
}
