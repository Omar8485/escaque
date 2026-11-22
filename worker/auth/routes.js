// Rutas de cuenta: inicio de sesión OIDC (authorization code + PKCE + state + nonce),
// callback, cierre de sesión, /api/me, aceptación de los términos y borrado de la cuenta.
//
// Consentimiento (LOPDP arts. 8 y 33; RGPD arts. 7 y 49.1.a): la app solo deja iniciar sesión tras
// marcar la casilla «Tengo 16 años o más y acepto…», y manda `consent=<versión>` al empezar el login.
// La versión viaja en la cookie FIRMADA del inicio de sesión (no se puede añadir ni cambiar a mitad
// del flujo) y el callback la registra en users.terms_version / consent_at. Sin ella NO se crea un
// usuario nuevo. Un usuario existente sin la versión vigente entra, pero /api/me devuelve
// `consent.required` y la app le pide aceptar antes de seguir (POST /api/me/consent).
//
// El inicio de sesión es una navegación completa (no un popup): con COOP same-origin un popup
// perdería `window.opener`, y al volver la app se carga de nuevo con COOP/COEP (crossOriginIsolated).
import { LOGIN_COOKIE_SECONDS } from '../config.js';
import { allow, clientIp, json, jsonError, readJsonBody, redirect } from '../lib/http.js';
import { cookieName, parseCookies, serializeCookie, clearCookie } from '../lib/cookies.js';
import { pkceChallenge, randomToken, signValue, verifySignedValue } from '../lib/crypto.js';
import { verifyIdToken } from '../lib/jwt.js';
import { allowRequest } from '../lib/ratelimit.js';
import { enabledProviders, getProvider, profileFromClaims } from './providers.js';
import { checkCsrf, clearSessionCookie, consentRequired, createSession, csrfToken, deleteSession, getSession, recordConsent } from './session.js';
import { TERMS_VERSION } from '../../shared/legal.js';
import { loadPlan } from '../billing/entitlements.js';
import { polarProducts } from '../config.js';

const LOGIN_COOKIE = 'escaque_oidc';

/** Ruta interna segura a la que volver tras el login (nunca otro origen). */
export function safeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 200) return '/';
  if (!/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(value)) return '/';
  return value;
}

function withParam(path, key, value) {
  const u = new URL(path, 'https://x.invalid');
  u.searchParams.set(key, value);
  return `${u.pathname}${u.search}`;
}

const redirectUriFor = (url, provider) => `${url.origin}/api/auth/callback/${provider}`;

export function accountsConfigured(env) {
  return Boolean(env?.DB && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32);
}

/** GET /api/auth/login/:provider?return=/ruta&consent=<versión aceptada> */
export async function handleLogin(request, url, env, providerName) {
  const bad = allow(request, 'GET');
  if (bad) return bad;
  if (!accountsConfigured(env)) return jsonError(503, 'accounts_not_configured');
  if (!(await allowRequest(env, 'RL_AUTH', `ip:${clientIp(request)}`))) return jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' });
  const provider = getProvider(providerName, env, url);
  if (!provider) return jsonError(404, 'unknown_provider');

  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48); // 64 caracteres base64url (RFC 7636: 43–128)
  const back = safeReturnPath(url.searchParams.get('return'));
  // Solo se guarda la versión vigente: una versión antigua o inventada cuenta como «sin consentimiento».
  const consent = url.searchParams.get('consent') === TERMS_VERSION ? TERMS_VERSION : null;
  const cookie = await signValue(env.SESSION_SECRET, {
    p: provider.name, s: state, n: nonce, v: verifier, r: back, t: Date.now(), ...(consent ? { c: consent } : {}),
  });

  const auth = new URL(provider.authorizeUrl);
  auth.searchParams.set('client_id', provider.clientId);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('redirect_uri', redirectUriFor(url, provider.name));
  auth.searchParams.set('scope', provider.scope);
  auth.searchParams.set('state', state);
  auth.searchParams.set('nonce', nonce);
  auth.searchParams.set('code_challenge', await pkceChallenge(verifier));
  auth.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(provider.authParams ?? {})) auth.searchParams.set(k, v);
  const hint = url.searchParams.get('hint');
  if (provider.name === 'test' && hint) auth.searchParams.set('login_hint', hint);

  return redirect(auth.toString(), [serializeCookie(cookieName(url, LOGIN_COOKIE), cookie, { maxAge: LOGIN_COOKIE_SECONDS })]);
}

/** GET /api/auth/callback/:provider?code&state */
export async function handleCallback(request, url, env, providerName, { fetchImpl, now = Date.now() } = {}) {
  const bad = allow(request, 'GET');
  if (bad) return bad;
  const loginCookieName = cookieName(url, LOGIN_COOKIE);
  const fail = (reason, back = '/') => redirect(withParam(back, 'account', `error:${reason}`), [clearCookie(loginCookieName)]);
  if (!accountsConfigured(env)) return fail('not_configured');
  if (!(await allowRequest(env, 'RL_AUTH', `ip:${clientIp(request)}`))) return fail('rate_limited');

  const saved = await verifySignedValue(env.SESSION_SECRET, parseCookies(request)[loginCookieName]);
  if (!saved || saved.p !== providerName || now - saved.t > LOGIN_COOKIE_SECONDS * 1000) return fail('expired');
  const back = safeReturnPath(saved.r);
  if (url.searchParams.get('error')) return fail('cancelled', back);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || code.length > 4096 || state !== saved.s) return fail('state', back);

  const provider = getProvider(providerName, env, url, fetchImpl ? { fetchImpl } : undefined);
  if (!provider) return fail('unknown_provider', back);

  let claims;
  try {
    const idToken = await provider.exchangeCode({ code, verifier: saved.v, redirectUri: redirectUriFor(url, providerName) });
    claims = await verifyIdToken(idToken, {
      issuer: provider.issuer, audience: provider.clientId, nonce: saved.n, resolveKey: provider.resolveKey, now,
    });
    if (provider.checkClaims && !provider.checkClaims(claims)) throw new Error('tenant');
  } catch {
    // No se registra el token ni el código: solo el motivo genérico.
    return fail('token', back);
  }

  const profile = profileFromClaims(providerName, claims);
  const db = env.DB;
  const consented = saved.c === TERMS_VERSION;
  const existing = await db.prepare('SELECT id, terms_version FROM users WHERE provider = ? AND subject = ?').bind(providerName, profile.subject).first();
  let userId;
  if (existing) {
    userId = existing.id;
    await db.prepare(
      `UPDATE users SET email = ?, name = ?, updated_at = ?
       WHERE id = ? AND (COALESCE(email, '') <> COALESCE(?, '') OR COALESCE(name, '') <> COALESCE(?, ''))`,
    ).bind(profile.email, profile.name, now, userId, profile.email, profile.name).run();
    if (consented && existing.terms_version !== TERMS_VERSION) await recordConsent(db, userId, now);
  } else {
    // Cuenta nueva: solo con el consentimiento explícito de la versión vigente. Nada se guarda sin él.
    if (!consented) return fail('consent_required', back);
    userId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO users (id, provider, subject, email, name, created_at, updated_at, terms_version, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider, subject) DO NOTHING`,
    ).bind(userId, providerName, profile.subject, profile.email, profile.name, now, now, TERMS_VERSION, now).run();
    // Carrera (dos callbacks a la vez del mismo usuario): se usa la fila que quedó.
    const row = await db.prepare('SELECT id FROM users WHERE provider = ? AND subject = ?').bind(providerName, profile.subject).first();
    userId = row.id;
  }
  const sessionCookie = await createSession(db, url, userId, now);
  return redirect(withParam(back, 'account', 'ok'), [clearCookie(loginCookieName), sessionCookie]);
}

/** POST /api/auth/logout */
export async function handleLogout(request, url, env) {
  const bad = allow(request, 'POST');
  if (bad) return bad;
  if (!accountsConfigured(env)) return jsonError(503, 'accounts_not_configured');
  const session = await getSession(request, env, url);
  if (!session) return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(url) });
  if (!(await checkCsrf(request, url, env, session))) return jsonError(403, 'csrf');
  await deleteSession(env.DB, session.idHash);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(url) });
}

/**
 * GET /api/me → usuario, plan, token CSRF y estado del consentimiento.
 * DELETE /api/me → borra la cuenta y sus datos del servidor (no hace falta haber aceptado los términos).
 */
export async function handleMe(request, url, env, ctx) {
  const bad = allow(request, 'GET', 'DELETE');
  if (bad) return bad;
  const base = {
    ok: true,
    accounts: accountsConfigured(env),
    providers: accountsConfigured(env) ? enabledProviders(env, url) : [],
    billing: Object.keys(polarProducts(env)).length > 0,
  };
  if (!base.accounts) return json({ ...base, user: null, plan: { premium: false, plan: 'free' } });
  if (!(await allowRequest(env, 'RL_API', `ip:${clientIp(request)}`))) return jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' });
  const session = await getSession(request, env, url, { waitUntil: ctx?.waitUntil?.bind(ctx) });
  if (request.method === 'DELETE') {
    if (!session) return jsonError(401, 'unauthenticated');
    if (!(await checkCsrf(request, url, env, session))) return jsonError(403, 'csrf');
    // Cascada: sesiones, derechos y datos sincronizados. Los pagos siguen en Polar (comerciante registrado).
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(session.user.id).run();
    return json({ ok: true, deleted: true }, 200, { 'Set-Cookie': clearSessionCookie(url) });
  }
  if (!session) return json({ ...base, user: null, plan: { premium: false, plan: 'free' } });
  const plan = await loadPlan(env.DB, session.user.id);
  return json({
    ...base,
    user: session.user,
    plan,
    consent: { version: TERMS_VERSION, accepted: session.consent.version, acceptedAt: session.consent.at, required: consentRequired(session) },
    csrf: await csrfToken(env, session.idHash),
    checkedAt: Date.now(),
  });
}

/**
 * POST /api/me/consent { version } → registra que el usuario con sesión acepta la versión vigente
 * de los términos y la privacidad (cuentas anteriores al consentimiento o tras un cambio de versión).
 */
export async function handleConsent(request, url, env, { now = Date.now() } = {}) {
  const bad = allow(request, 'POST');
  if (bad) return bad;
  if (!accountsConfigured(env)) return jsonError(503, 'accounts_not_configured');
  if (!(await allowRequest(env, 'RL_API', `ip:${clientIp(request)}`))) return jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' });
  const session = await getSession(request, env, url);
  if (!session) return jsonError(401, 'unauthenticated');
  if (!(await checkCsrf(request, url, env, session))) return jsonError(403, 'csrf');
  const body = await readJsonBody(request, 256);
  if (!body.ok) return jsonError(body.status, body.kind);
  if (body.value?.version !== TERMS_VERSION) return jsonError(400, 'consent_version', { version: TERMS_VERSION });
  await recordConsent(env.DB, session.user.id, now);
  return json({ ok: true, consent: { version: TERMS_VERSION, accepted: TERMS_VERSION, acceptedAt: now, required: false } });
}
