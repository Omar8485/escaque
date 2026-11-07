// Sincronización entre dispositivos (solo Premium): IndexedDB del navegador ↔ D1.
//
//   POST   /api/sync/push   { items: [{ store, key, updatedAt, deleted, data }] }
//   GET    /api/sync/pull?cursor=N            → cambios con seq > N, en orden
//   GET    /api/sync/status                   → uso y límites
//   DELETE /api/sync                          → borra los datos sincronizados del servidor
//
// Última escritura gana por `updatedAt` (lo pone el cliente al escribir); los borrados son lápidas.
// Cada escritura aceptada recibe un `seq` nuevo del contador del usuario (sync_state.seq) dentro del
// mismo batch (transacción de D1), así el cursor nunca se salta cambios.
import { SYNC_STORES, syncLimits } from '../config.js';
import { allow, json, jsonError, readJsonBody } from '../lib/http.js';
import { allowRequest } from '../lib/ratelimit.js';
import { checkCsrf, consentRequired, getSession } from '../auth/session.js';
import { loadPlan } from '../billing/entitlements.js';

const SEP = '\u001f';
const DAY_MS = 86_400_000;
const MAX_KEY_LENGTH = 300;
const MAX_FUTURE_MS = DAY_MS;

export const itemKey = (store, key) => `${store}${SEP}${key}`;
const today = (now) => new Date(now).toISOString().slice(0, 10);
const secondsToMidnightUtc = (now) => Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));

/**
 * Valida un registro recibido. Devuelve el registro normalizado o `{ error }`.
 * El tamaño se mide en unidades de la cadena JSON (aprox. bytes; el JSON es casi todo ASCII).
 */
export function validateItem(raw, limits, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return { error: 'item' };
  const { store, key, updatedAt } = raw;
  if (!SYNC_STORES.includes(store)) return { error: 'store' };
  if (typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH || key.includes(SEP)) return { error: 'key' };
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > now + MAX_FUTURE_MS) return { error: 'updatedAt' };
  const deleted = raw.deleted === true;
  let data = null;
  if (!deleted) {
    if (raw.data === undefined) return { error: 'data' };
    data = JSON.stringify(raw.data);
    if (data.length > limits.maxItemBytes) return { error: 'item_too_large' };
  }
  return { k: itemKey(store, key), store, key, updatedAt, deleted, data, size: data ? data.length : 0 };
}

async function premiumSession(request, url, env) {
  if (!env.DB) return { error: jsonError(503, 'accounts_not_configured') };
  const session = await getSession(request, env, url);
  if (!session) return { error: jsonError(401, 'unauthenticated') };
  if (!(await allowRequest(env, 'RL_API', `user:${session.user.id}`))) return { error: jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' }) };
  // Sin la aceptación de los términos vigentes no se suben ni se bajan datos (borrarlos sí se puede).
  if (consentRequired(session)) return { error: jsonError(403, 'consent_required') };
  const plan = await loadPlan(env.DB, session.user.id);
  if (!plan.premium) return { error: jsonError(402, 'premium_required') };
  return { session };
}

const usageOf = (state, limits, now) => ({
  bytes: state?.bytes ?? 0,
  items: state?.items ?? 0,
  dayWrites: state?.day === today(now) ? state.day_writes : 0,
  limits: { maxUserBytes: limits.maxUserBytes, maxUserItems: limits.maxUserItems, maxDailyWrites: limits.maxDailyWrites,
    maxItemsPerPush: limits.maxItemsPerPush, maxPushBytes: limits.maxPushBytes, maxItemBytes: limits.maxItemBytes },
});

/** POST /api/sync/push */
export async function handlePush(request, url, env, { now = Date.now() } = {}) {
  const bad = allow(request, 'POST');
  if (bad) return bad;
  const { session, error } = await premiumSession(request, url, env);
  if (error) return error;
  if (!(await checkCsrf(request, url, env, session))) return jsonError(403, 'csrf');
  const limits = syncLimits(env);
  const body = await readJsonBody(request, limits.maxPushBytes);
  if (!body.ok) return jsonError(body.status, body.kind);
  const rawItems = body.value?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return jsonError(400, 'no_items');
  if (rawItems.length > limits.maxItemsPerPush) return jsonError(413, 'too_many_items', { max: limits.maxItemsPerPush });

  // Validar y quedarse con la versión más nueva de cada clave repetida en la petición.
  const byKey = new Map();
  const rejected = [];
  for (const raw of rawItems) {
    const item = validateItem(raw, limits, now);
    if (item.error) {
      rejected.push({ store: raw?.store, key: typeof raw?.key === 'string' ? raw.key.slice(0, MAX_KEY_LENGTH) : null, reason: item.error });
      continue;
    }
    const prev = byKey.get(item.k);
    if (!prev || item.updatedAt > prev.updatedAt) byKey.set(item.k, item);
  }
  const items = [...byKey.values()];
  const userId = session.user.id;
  const db = env.DB;
  const [stateRes, existingRes] = await db.batch([
    db.prepare('SELECT seq, bytes, items, day, day_writes FROM sync_state WHERE user_id = ?').bind(userId),
    db.prepare('SELECT k, updated_at, size, deleted, seq FROM sync_items WHERE user_id = ? AND k IN (SELECT value FROM json_each(?))')
      .bind(userId, JSON.stringify(items.map((i) => i.k))),
  ]);
  const state = stateRes.results?.[0] ?? null;
  const existing = new Map((existingRes.results ?? []).map((r) => [r.k, r]));

  const winners = [];
  const stale = [];
  let deltaBytes = 0;
  let newLiveItems = 0;
  for (const item of items) {
    const old = existing.get(item.k);
    if (old && item.updatedAt <= old.updated_at) {
      stale.push({ store: item.store, key: item.key, updatedAt: old.updated_at, seq: old.seq });
      continue;
    }
    winners.push(item);
    deltaBytes += item.size - (old?.size ?? 0);
    if (!item.deleted && (!old || old.deleted)) newLiveItems += 1;
    if (item.deleted && old && !old.deleted) newLiveItems -= 1;
  }

  const day = today(now);
  const dayWrites = state?.day === day ? state.day_writes : 0;
  if (winners.length && dayWrites + winners.length > limits.maxDailyWrites) {
    const retry = secondsToMidnightUtc(now);
    return jsonError(429, 'quota_daily', { retryAfter: retry, usage: usageOf(state, limits, now) }, { 'Retry-After': String(retry) });
  }
  if (deltaBytes > 0 && (state?.bytes ?? 0) + deltaBytes > limits.maxUserBytes) return jsonError(413, 'quota_storage', { usage: usageOf(state, limits, now) });
  if (newLiveItems > 0 && (state?.items ?? 0) + newLiveItems > limits.maxUserItems) return jsonError(413, 'quota_items', { usage: usageOf(state, limits, now) });

  if (!winners.length) {
    return json({ ok: true, applied: 0, stale, rejected, seq: state?.seq ?? 0, usage: usageOf(state, limits, now) });
  }
  const n = winners.length;
  const statements = [];
  if (!state) statements.push(db.prepare('INSERT OR IGNORE INTO sync_state (user_id) VALUES (?)').bind(userId));
  statements.push(db.prepare(
    `UPDATE sync_state SET seq = seq + ?, bytes = MAX(0, bytes + ?), items = MAX(0, items + ?), day = ?, day_writes = ?
     WHERE user_id = ?`,
  ).bind(n, deltaBytes, newLiveItems, day, dayWrites + n, userId));
  winners.forEach((item, i) => {
    statements.push(db.prepare(
      `INSERT INTO sync_items (user_id, k, store, key, updated_at, deleted, data, size, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT seq FROM sync_state WHERE user_id = ?) - ?)
       ON CONFLICT (user_id, k) DO UPDATE SET updated_at = excluded.updated_at, deleted = excluded.deleted,
         data = excluded.data, size = excluded.size, seq = excluded.seq
       WHERE excluded.updated_at > sync_items.updated_at`,
    ).bind(userId, item.k, item.store, item.key, item.updatedAt, item.deleted ? 1 : 0, item.data, item.size, userId, n - 1 - i));
  });
  statements.push(db.prepare('SELECT seq, bytes, items, day, day_writes FROM sync_state WHERE user_id = ?').bind(userId));
  const results = await db.batch(statements);
  const after = results.at(-1).results?.[0];
  return json({
    ok: true,
    applied: n,
    stale,
    rejected,
    fromSeq: after.seq - n + 1,
    toSeq: after.seq,
    seq: after.seq,
    usage: usageOf(after, limits, now),
  });
}

/** GET /api/sync/pull?cursor=N&limit=M — el JSON de cada registro se devuelve tal cual (sin reparsear). */
export async function handlePull(request, url, env, { now = Date.now() } = {}) {
  const bad = allow(request, 'GET');
  if (bad) return bad;
  const { session, error } = await premiumSession(request, url, env);
  if (error) return error;
  const limits = syncLimits(env);
  const cursor = Number(url.searchParams.get('cursor') ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return jsonError(400, 'invalid_cursor');
  const asked = Number(url.searchParams.get('limit') ?? limits.maxPullItems);
  const limit = Number.isSafeInteger(asked) && asked > 0 ? Math.min(asked, limits.maxPullItems) : limits.maxPullItems;
  const db = env.DB;
  const userId = session.user.id;
  const [rowsRes, stateRes] = await db.batch([
    db.prepare('SELECT store, key, updated_at, deleted, data, seq FROM sync_items WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?').bind(userId, cursor, limit),
    db.prepare('SELECT seq, bytes, items, day, day_writes FROM sync_state WHERE user_id = ?').bind(userId),
  ]);
  const state = stateRes.results?.[0] ?? null;
  const latest = state?.seq ?? 0;
  const parts = [];
  let bytes = 0;
  let last = cursor;
  for (const r of rowsRes.results ?? []) {
    const piece = `{"store":${JSON.stringify(r.store)},"key":${JSON.stringify(r.key)},"updatedAt":${Number(r.updated_at)},"deleted":${r.deleted ? 'true' : 'false'},"data":${r.deleted || r.data == null ? 'null' : r.data}}`;
    if (parts.length && bytes + piece.length > limits.maxPullBytes) break;
    parts.push(piece);
    bytes += piece.length;
    last = r.seq;
  }
  const head = `{"ok":true,"cursor":${last},"latest":${latest},"more":${last < latest ? 'true' : 'false'},"usage":${JSON.stringify(usageOf(state, limits, now))},"items":[`;
  return new Response(`${head}${parts.join(',')}]}`, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** GET /api/sync/status · DELETE /api/sync */
export async function handleSyncState(request, url, env, { now = Date.now() } = {}) {
  const bad = allow(request, 'GET', 'DELETE');
  if (bad) return bad;
  if (!env.DB) return jsonError(503, 'accounts_not_configured');
  const session = await getSession(request, env, url);
  if (!session) return jsonError(401, 'unauthenticated');
  const userId = session.user.id;
  const limits = syncLimits(env);
  if (request.method === 'DELETE') {
    if (!(await checkCsrf(request, url, env, session))) return jsonError(403, 'csrf');
    // Se conserva el contador `seq` (los cursores de otros dispositivos siguen siendo válidos).
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sync_items WHERE user_id = ?').bind(userId),
      env.DB.prepare('UPDATE sync_state SET bytes = 0, items = 0 WHERE user_id = ?').bind(userId),
    ]);
    return json({ ok: true, cleared: true });
  }
  const state = await env.DB.prepare('SELECT seq, bytes, items, day, day_writes FROM sync_state WHERE user_id = ?').bind(userId).first();
  return json({ ok: true, seq: state?.seq ?? 0, usage: usageOf(state, limits, now) });
}
