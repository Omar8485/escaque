// Sesiones en D1 con cookie HttpOnly de mismo origen, y protección CSRF.
import { MAX_SESSIONS_PER_USER, SESSION_DAYS, WEBHOOK_EVENTS_DAYS } from '../config.js';
import { cookieName, parseCookies, serializeCookie, clearCookie } from '../lib/cookies.js';
import { base64UrlEncode, hmacSha256, randomToken, sha256Base64Url, timingSafeEqual } from '../lib/crypto.js';
import { TERMS_VERSION } from '../../shared/legal.js';

export const SESSION_COOKIE = 'escaque_sid';
export const CSRF_HEADER = 'X-CSRF-Token';
const DAY_MS = 86_400_000;

export const sessionCookieName = (url) => cookieName(url, SESSION_COOKIE);

/**
 * Crea la sesión y devuelve el valor Set-Cookie. Limpieza de paso (por índices, barata): sesiones
 * caducadas de todos los usuarios (no se acumulan en la base tras sus SESSION_DAYS) y avisos de
 * Polar de más de WEBHOOK_EVENTS_DAYS (además de la que hace cada webhook); y las sesiones que
 * sobran del usuario.
 */
export async function createSession(db, url, userId, now = Date.now()) {
  const token = randomToken(32);
  const idHash = await sha256Base64Url(token);
  const expires = now + SESSION_DAYS * DAY_MS;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM webhook_events WHERE received_at < ?').bind(now - WEBHOOK_EVENTS_DAYS * DAY_MS),
    db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .bind(idHash, userId, now, expires, now),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND id_hash NOT IN (
        SELECT id_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)`)
      .bind(userId, userId, MAX_SESSIONS_PER_USER),
  ]);
  return serializeCookie(sessionCookieName(url), token, { maxAge: SESSION_DAYS * 86_400 });
}

/**
 * Sesión válida de la petición, o null.
 * @returns {Promise<null|{idHash:string, user:{id:string, provider:string, email:string|null, name:string|null},
 *   consent:{version:string|null, at:number|null}}>}
 */
export async function getSession(request, env, url, { now = Date.now(), waitUntil } = {}) {
  const token = parseCookies(request)[sessionCookieName(url)];
  if (!token || token.length > 100 || !env.DB) return null;
  const idHash = await sha256Base64Url(token);
  const row = await env.DB.prepare(
    `SELECT s.id_hash, s.expires_at, s.last_seen_at, u.id, u.provider, u.email, u.name, u.terms_version, u.consent_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
  ).bind(idHash).first();
  if (!row || row.expires_at <= now) return null;
  // Último uso como mucho una vez al día: cada UPDATE es una fila escrita del cupo diario de D1.
  if (now - row.last_seen_at > DAY_MS) {
    const p = env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').bind(now, idHash).run().catch(() => {});
    if (waitUntil) waitUntil(p); else await p;
  }
  return {
    idHash,
    user: { id: row.id, provider: row.provider, email: row.email, name: row.name },
    consent: { version: row.terms_version ?? null, at: row.consent_at ?? null },
  };
}

/**
 * ¿Falta aceptar los términos vigentes? (cuenta anterior al consentimiento o versión antigua).
 * Mientras falte, el Worker no sincroniza ni abre compras; sí deja cerrar sesión, borrar la cuenta o
 * los datos sincronizados y gestionar (cancelar) una suscripción.
 */
export const consentRequired = (session) => session?.consent?.version !== TERMS_VERSION;

/** Registra la aceptación de la versión vigente. */
export async function recordConsent(db, userId, now = Date.now()) {
  await db.prepare('UPDATE users SET terms_version = ?, consent_at = ?, updated_at = ? WHERE id = ?')
    .bind(TERMS_VERSION, now, now, userId).run();
}

export async function deleteSession(db, idHash) {
  await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run();
}

export const clearSessionCookie = (url) => clearCookie(sessionCookieName(url));

/** Token CSRF ligado a la sesión (lo entrega /api/me; el cliente lo manda en X-CSRF-Token). */
export async function csrfToken(env, idHash) {
  return base64UrlEncode(await hmacSha256(env.SESSION_SECRET, `csrf:${idHash}`));
}

/**
 * Peticiones que modifican: mismo origen (Origin o Sec-Fetch-Site) y cabecera X-CSRF-Token válida.
 * La cabecera propia obliga además a un preflight CORS que este Worker nunca concede a otros orígenes.
 */
export async function checkCsrf(request, url, env, session) {
  const origin = request.headers.get('Origin');
  if (origin) {
    if (origin !== url.origin) return false;
  } else {
    const site = request.headers.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin') return false;
  }
  const sent = request.headers.get(CSRF_HEADER) ?? '';
  if (!session || !sent) return false;
  return timingSafeEqual(sent, await csrfToken(env, session.idHash));
}
