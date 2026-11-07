import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { BASE, Jar, call, loginTest, makeEnv, postJson, setCookies } from './test/helpers.js';
import { base64UrlDecode, base64UrlEncode } from './lib/crypto.js';
import { _clearJwksCache, verifyIdToken } from './lib/jwt.js';
import { _resetMemoryLimits } from './lib/ratelimit.js';
import { MS_CONSUMER_TENANT } from './auth/providers.js';
import { safeReturnPath } from './auth/routes.js';
import { TERMS_VERSION } from '../shared/legal.js';

const enc = new TextEncoder();
let rsa;

async function signJwt(payload, { key = rsa.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const head = base64UrlEncode(enc.encode(JSON.stringify({ alg, kid, typ: 'JWT' })));
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${base64UrlEncode(sig)}`;
}

async function publicJwk(kid = 'k1', key = rsa.publicKey) {
  return { ...(await crypto.subtle.exportKey('jwk', key)), kid, use: 'sig', alg: 'RS256' };
}

/** Lee state y nonce de la cookie firmada del login (el test hace de proveedor). */
function loginCookieValue(res) {
  const raw = setCookies(res).find((c) => c.startsWith('escaque_oidc='));
  const value = raw.split(';')[0].slice('escaque_oidc='.length);
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value.split('.')[0])));
}

beforeEach(async () => {
  rsa ??= await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  _clearJwksCache();
  _resetMemoryLimits();
});
afterEach(() => vi.unstubAllGlobals());

const GOOGLE = { GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret' };
const MS = { MS_CLIENT_ID: '11111111-2222-3333-4444-555555555555', MS_CLIENT_SECRET: 'msecret' };

/** Simula Google/Microsoft: token endpoint y JWKS. `claims(saved)` arma el id_token. */
function stubProvider({ tokenUrl, jwksUrl, claims, signOpts }) {
  const fetchMock = vi.fn(async (url, init) => {
    if (url === jwksUrl) return Response.json({ keys: [await publicJwk()] });
    if (url === tokenUrl) {
      const form = new URLSearchParams(init.body);
      stubProvider.lastForm = form;
      return Response.json({ id_token: await signJwt(claims(stubProvider.saved, form), signOpts), access_token: 'at' });
    }
    return new Response('no', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function runLogin(env, provider, claims, signOpts) {
  const jar = new Jar();
  const start = await call(env, jar, `/api/auth/login/${provider}?return=/?tab=x&consent=${TERMS_VERSION}`);
  expect(start.status).toBe(302);
  const saved = loginCookieValue(start);
  stubProvider.saved = saved;
  const loc = new URL(start.headers.get('Location'));
  stubProvider({
    tokenUrl: provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    jwksUrl: provider === 'google' ? 'https://www.googleapis.com/oauth2/v3/certs' : 'https://login.microsoftonline.com/consumers/discovery/v2.0/keys',
    claims, signOpts,
  });
  const cb = await call(env, jar, `/api/auth/callback/${provider}?code=abc&state=${encodeURIComponent(loc.searchParams.get('state'))}`);
  return { jar, cb, start, loc, saved };
}

const now = () => Math.floor(Date.now() / 1000);
const googleClaims = (over = {}) => (saved) => ({
  iss: 'https://accounts.google.com', aud: GOOGLE.GOOGLE_CLIENT_ID, sub: 'g-123', email: 'ana@gmail.com', email_verified: true,
  name: 'Ana', nonce: saved.n, iat: now(), exp: now() + 3600, ...over,
});

describe('inicio de sesión OIDC', () => {
  it('sin D1 o sin SESSION_SECRET responde 503 y /api/me dice que no hay cuentas', async () => {
    const env = makeEnv({ DB: undefined });
    const res = await call(env, null, '/api/auth/login/google');
    expect(res.status).toBe(503);
    const me = await (await call(env, null, '/api/me')).json();
    expect(me).toMatchObject({ ok: true, accounts: false, user: null, plan: { premium: false } });
  });

  it('login redirige a Google con PKCE S256, state, nonce y cookie firmada HttpOnly/Secure/SameSite=Lax', async () => {
    const env = makeEnv(GOOGLE);
    const res = await call(env, null, '/api/auth/login/google?return=/progreso');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location'));
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/callback/google`);
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    const cookie = setCookies(res)[0];
    expect(cookie).toMatch(/^escaque_oidc=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const saved = loginCookieValue(res);
    expect(saved.s).toBe(loc.searchParams.get('state'));
    expect(saved.n).toBe(loc.searchParams.get('nonce'));
    expect(saved.r).toBe('/progreso');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });

  it('en HTTPS las cookies llevan el prefijo __Host-', async () => {
    const env = makeEnv(GOOGLE);
    const res = await worker.fetch(new Request('https://escaque.example.workers.dev/api/auth/login/google'), env, {});
    expect(setCookies(res)[0]).toMatch(/^__Host-escaque_oidc=/);
    expect(res.headers.get('Strict-Transport-Security')).toMatch(/max-age/);
  });

  it('proveedor desconocido o sin credenciales → 404', async () => {
    const env = makeEnv();
    expect((await call(env, null, '/api/auth/login/google')).status).toBe(404);
    expect((await call(env, null, '/api/auth/login/github')).status).toBe(404);
  });

  it('Google: callback válido crea usuario y sesión; /api/me devuelve usuario, plan gratis y CSRF', async () => {
    const env = makeEnv(GOOGLE);
    const { jar, cb } = await runLogin(env, 'google', googleClaims());
    expect(cb.status).toBe(302);
    expect(cb.headers.get('Location')).toBe('/?tab=x&account=ok');
    const sid = setCookies(cb).find((c) => c.startsWith('escaque_sid='));
    expect(sid).toMatch(/HttpOnly; Secure; SameSite=Lax; Max-Age=2592000/);
    // Se canjeó con el verificador PKCE y el secreto, sin registrar nada.
    expect(stubProvider.lastForm.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(stubProvider.lastForm.get('client_secret')).toBe('gsecret');
    const me = await (await call(env, jar, '/api/me')).json();
    expect(me.user).toMatchObject({ provider: 'google', email: 'ana@gmail.com', name: 'Ana' });
    expect(me.plan).toMatchObject({ premium: false, plan: 'free' });
    expect(me.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // En D1 solo está el hash del token de sesión.
    const token = sid.split(';')[0].split('=')[1];
    const row = await env.DB.prepare('SELECT id_hash FROM sessions').first();
    expect(row.id_hash).not.toBe(token);
    // Volver a entrar no duplica el usuario.
    await runLogin(env, 'google', googleClaims());
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n).toBe(1);
  });

  it.each([
    ['aud', { aud: 'otro-cliente' }],
    ['iss', { iss: 'https://evil.example' }],
    ['exp', { exp: now() - 3600 }],
    ['nonce', { nonce: 'otro' }],
  ])('Google: rechaza id_token con %s incorrecto', async (_name, over) => {
    const env = makeEnv(GOOGLE);
    const { cb, jar } = await runLogin(env, 'google', googleClaims(over));
    expect(cb.headers.get('Location')).toMatch(/account=error%3Atoken/);
    expect((await (await call(env, jar, '/api/me')).json()).user).toBeNull();
  });

  it('rechaza id_token firmado con otra clave', async () => {
    const other = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const env = makeEnv(GOOGLE);
    const { cb } = await runLogin(env, 'google', googleClaims(), { key: other.privateKey });
    expect(cb.headers.get('Location')).toMatch(/account=error%3Atoken/);
  });

  it('rechaza state distinto y cookie de login ausente', async () => {
    const env = makeEnv(GOOGLE);
    const jar = new Jar();
    await call(env, jar, '/api/auth/login/google');
    const bad = await call(env, jar, '/api/auth/callback/google?code=abc&state=otro');
    expect(bad.headers.get('Location')).toMatch(/account=error%3Astate/);
    const none = await call(env, null, '/api/auth/callback/google?code=abc&state=x');
    expect(none.headers.get('Location')).toMatch(/account=error%3Aexpired/);
  });

  it('Microsoft: solo cuentas personales (tid de consumidores) con el issuer de consumidores', async () => {
    const msClaims = (over = {}) => (saved) => ({
      iss: `https://login.microsoftonline.com/${MS_CONSUMER_TENANT}/v2.0`, aud: MS.MS_CLIENT_ID, tid: MS_CONSUMER_TENANT,
      sub: 'ms-1', preferred_username: 'luis@outlook.com', name: 'Luis', nonce: saved.n, iat: now(), exp: now() + 3600, ...over,
    });
    const env = makeEnv(MS);
    const ok = await runLogin(env, 'microsoft', msClaims());
    expect(ok.loc.searchParams.get('response_mode')).toBe('query');
    expect(ok.cb.headers.get('Location')).toMatch(/account=ok/);
    const me = await (await call(env, ok.jar, '/api/me')).json();
    expect(me.user).toMatchObject({ provider: 'microsoft', email: 'luis@outlook.com' });
    const work = await runLogin(env, 'microsoft', msClaims({ tid: 'aaaaaaaa-0000-0000-0000-000000000000' }));
    expect(work.cb.headers.get('Location')).toMatch(/account=error%3Atoken/);
  });

  it('el proveedor simulado solo existe con AUTH_TEST_MODE=1 en localhost', async () => {
    const env = makeEnv();
    expect((await call(env, null, '/api/auth/login/test')).status).toBe(302);
    const prod = await worker.fetch(new Request('https://escaque.example.workers.dev/api/auth/login/test'), env, {});
    expect(prod.status).toBe(404);
    const prodAuthorize = await worker.fetch(new Request('https://escaque.example.workers.dev/api/test-oidc/authorize?redirect_uri=x'), env, {});
    expect(prodAuthorize.status).toBe(404);
    const off = makeEnv({ AUTH_TEST_MODE: undefined });
    expect((await call(off, null, '/api/auth/login/test')).status).toBe(404);
    expect((await (await call(off, null, '/api/me')).json()).providers).not.toContain('test');
  });

  it('logout exige CSRF y mismo origen; luego la sesión deja de valer', async () => {
    const env = makeEnv();
    const { jar, me } = await loginTest(env);
    expect((await postJson(env, jar, '/api/auth/logout', undefined, 'malo')).status).toBe(403);
    const cross = await call(env, jar, '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-CSRF-Token': me.csrf } });
    expect(cross.status).toBe(403);
    const ok = await postJson(env, jar, '/api/auth/logout', undefined, me.csrf);
    expect(ok.status).toBe(200);
    expect((await (await call(env, jar, '/api/me')).json()).user).toBeNull();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n).toBe(0);
  });

  it('DELETE /api/me borra la cuenta y todo lo asociado', async () => {
    const env = makeEnv();
    const { jar, me } = await loginTest(env);
    const res = await postJson(env, jar, '/api/me', undefined, me.csrf, 'DELETE');
    expect(res.status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n).toBe(0);
  });

  it('respuestas de la API con cabeceras de seguridad', async () => {
    const env = makeEnv();
    const res = await call(env, null, '/api/me');
    for (const [h, v] of [
      ['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp'],
      ['Cross-Origin-Resource-Policy', 'same-origin'], ['X-Content-Type-Options', 'nosniff'],
      ['X-Frame-Options', 'DENY'], ['Referrer-Policy', 'no-referrer'], ['Cache-Control', 'no-store'],
    ]) expect(res.headers.get(h)).toBe(v);
    expect(res.headers.get('Content-Security-Policy')).toMatch(/default-src 'none'/);
  });

  it('límite por IP en el login (429 tras 20 intentos por minuto)', async () => {
    const env = makeEnv();
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await call(env, null, '/api/auth/login/test', { headers: { 'CF-Connecting-IP': '9.9.9.9' } })).status);
    expect(statuses.slice(0, 20).every((s) => s === 302)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    // Otra IP no se ve afectada.
    expect((await call(env, null, '/api/auth/login/test', { headers: { 'CF-Connecting-IP': '8.8.8.8' } })).status).toBe(302);
  });

  it('usa el binding de Rate Limiting si existe', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const env = makeEnv({ RL_AUTH: { limit } });
    expect((await call(env, null, '/api/auth/login/test')).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'ip:local' });
  });
});

describe('utilidades', () => {
  it('safeReturnPath solo admite rutas internas', () => {
    expect(safeReturnPath('/a?b=1')).toBe('/a?b=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', 'javascript:x', '', null, '/a b']) expect(safeReturnPath(bad)).toBe('/');
  });

  it('verifyIdToken rechaza alg distinto de RS256', async () => {
    const token = `${base64UrlEncode(enc.encode('{"alg":"none","kid":"k1"}'))}.${base64UrlEncode(enc.encode('{}'))}.`;
    await expect(verifyIdToken(token, { issuer: 'x', audience: 'y', nonce: 'z', resolveKey: async () => null })).rejects.toThrow(/alg/);
  });
});
