// Proveedores OpenID Connect: Google y Microsoft (solo cuentas personales, tenant `consumers`).
// Endpoints tomados de los documentos de descubrimiento oficiales (consultados el 2026-11-02):
//   https://accounts.google.com/.well-known/openid-configuration
//   https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration
// Se fijan en el código (en vez de leer el descubrimiento en cada login) para ahorrar subpeticiones
// y tiempo de CPU en el plan gratuito; si cambiaran, basta con actualizar esta tabla.
import { getJwk } from '../lib/jwt.js';
import { createTestProvider } from './testProvider.js';
import { isTestMode } from '../config.js';

/** Tenant fijo de las cuentas personales de Microsoft (claims `tid` e `iss`). */
export const MS_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const STATIC = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    authParams: { prompt: 'select_account' },
    idVar: 'GOOGLE_CLIENT_ID',
    secretVar: 'GOOGLE_CLIENT_SECRET',
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/consumers/discovery/v2.0/keys',
    issuer: `https://login.microsoftonline.com/${MS_CONSUMER_TENANT}/v2.0`,
    scope: 'openid email profile',
    // query: el código vuelve en una navegación GET de primer nivel, así la cookie SameSite=Lax
    // con state/nonce/PKCE viaja (con form_post sería un POST entre sitios y no viajaría).
    authParams: { response_mode: 'query', prompt: 'select_account' },
    idVar: 'MS_CLIENT_ID',
    secretVar: 'MS_CLIENT_SECRET',
  },
};

export const PROVIDER_NAMES = Object.freeze(['google', 'microsoft']);

/**
 * Proveedor listo para usar, o null si no está configurado (faltan sus secretos).
 * @returns {null|{
 *   name: string, clientId: string, scope: string, issuer: string|string[],
 *   authorizeUrl: string, authParams: Record<string,string>,
 *   exchangeCode: (o:{code:string, verifier:string, redirectUri:string, fetchImpl?:typeof fetch}) => Promise<string>,
 *   resolveKey: (kid:string) => Promise<JsonWebKey|null>,
 *   checkClaims?: (claims:object) => boolean,
 * }}
 */
export function getProvider(name, env, url, { fetchImpl = fetch } = {}) {
  if (name === 'test') return isTestMode(env, url) ? createTestProvider(url) : null;
  const cfg = STATIC[name];
  if (!cfg) return null;
  const clientId = env?.[cfg.idVar];
  const clientSecret = env?.[cfg.secretVar];
  if (!clientId || !clientSecret) return null;
  return {
    name,
    clientId,
    scope: cfg.scope,
    issuer: cfg.issuer,
    authorizeUrl: cfg.authorizeUrl,
    authParams: cfg.authParams,
    async exchangeCode({ code, verifier, redirectUri }) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      });
      if (name === 'microsoft') body.set('scope', cfg.scope);
      const res = await fetchImpl(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });
      if (!res.ok) throw new Error(`token_endpoint_${res.status}`);
      const data = await res.json();
      if (typeof data?.id_token !== 'string') throw new Error('no_id_token');
      return data.id_token;
    },
    resolveKey: (kid) => getJwk(cfg.jwksUrl, kid, { fetchImpl }),
    checkClaims: name === 'microsoft' ? (claims) => claims.tid === MS_CONSUMER_TENANT : undefined,
  };
}

/** Proveedores con credenciales cargadas (lo muestra /api/me para pintar los botones). */
export function enabledProviders(env, url) {
  const list = PROVIDER_NAMES.filter((n) => getProvider(n, env, url));
  if (isTestMode(env, url)) list.push('test');
  return list;
}

/**
 * Datos de perfil a guardar. El correo solo se usa para mostrar y para el recibo de Polar.
 * @returns {{subject:string, email:string|null, emailVerified:boolean, name:string|null}}
 */
export function profileFromClaims(provider, claims) {
  const clip = (s, n) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null);
  let email = null;
  let emailVerified = false;
  if (provider === 'google') {
    email = clip(claims.email, 320);
    emailVerified = claims.email_verified === true;
  } else if (provider === 'microsoft') {
    email = clip(claims.email, 320) ?? (String(claims.preferred_username ?? '').includes('@') ? clip(claims.preferred_username, 320) : null);
    emailVerified = Boolean(clip(claims.email, 320));
  } else {
    email = clip(claims.email, 320);
    emailVerified = claims.email_verified === true;
  }
  return { subject: claims.sub, email, emailVerified, name: clip(claims.name, 120) };
}
