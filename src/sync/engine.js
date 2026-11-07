// Motor de sincronización (solo Premium): baja los cambios del servidor desde un cursor, aplica
// «última escritura gana» y sube lo pendiente por lotes acordes a los límites del servidor.
// Corre en segundo plano y nunca bloquea la partida; si falla, reintenta más tarde.
import { useSyncExternalStore } from 'react';
import { getMeta, setMeta } from '../storage/db.js';
import { ApiError, api as defaultApi } from '../account/api.js';
import { applyRemote, bootstrapChanges, bumpChanges, countDirty, getDirty, markClean } from './local.js';
import { applyRemotePrefs, bumpPrefs, collectPrefChanges, markPrefsClean } from './prefs.js';

export const SYNC_STATE_KEY = 'sync:state';
/** Lotes del cliente (por debajo de los topes del servidor: 100 registros, 512 KB, 128 KB por registro). */
export const CLIENT_BATCH = Object.freeze({ maxItems: 80, maxBytes: 384 * 1024, maxItemBytes: 120 * 1024 });
const MAX_PUSH_ROUNDS = 40;
const MAX_PULL_PAGES = 200;

/**
 * @typedef {{state:'off'|'idle'|'syncing'|'offline'|'quota'|'full'|'error', lastSyncAt:number|null,
 *   pending:number|null, tooLarge:number, usage:object|null, retryAfter:number|null, error:string|null}} SyncStatus
 */
let status = { state: 'off', lastSyncAt: null, pending: null, tooLarge: 0, usage: null, retryAfter: null, error: null };
const listeners = new Set();
const setStatus = (patch) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
};
export const getSyncStatus = () => status;
export const subscribeSyncStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** @returns {SyncStatus} */
export const useSyncStatus = () => useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
export const _resetSyncStatus = () => setStatus({ state: 'off', lastSyncAt: null, pending: null, tooLarge: 0, usage: null, retryAfter: null, error: null });

/**
 * Una pasada completa: bajar → subir → (si hizo falta) bajar otra vez.
 * @param {{userId:string, csrf:string, api?:typeof defaultApi, onData?:(stores:Set<string>, prefKeys:string[])=>void}} o
 * @returns {Promise<{pulled:number, pushed:number}>}
 */
export async function syncOnce({ userId, csrf, api = defaultApi, onData = () => {} }) {
  let st = (await getMeta(SYNC_STATE_KEY)) ?? {};
  let markAll = false;
  if (st.userId !== userId) {
    // Primera vez con esta cuenta en este navegador (o cambio de cuenta): subida inicial de todo.
    markAll = Boolean(st.userId);
    await bootstrapChanges({ markAll });
    st = { userId, cursor: 0, since: Date.now() };
    await setMeta(SYNC_STATE_KEY, st);
  }
  let pulled = 0;
  let pushed = 0;
  let tooLarge = 0;
  let usage = null;

  const pullAll = async () => {
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const res = await api.pull(st.cursor);
      usage = res.usage ?? usage;
      if (res.items?.length) {
        const prefKeys = await applyRemotePrefs(res.items);
        const { applied, stores } = await applyRemote(res.items);
        pulled += applied + prefKeys.length;
        if (stores.size || prefKeys.length) onData(stores, prefKeys);
      }
      st = { ...st, cursor: res.cursor };
      await setMeta(SYNC_STATE_KEY, st);
      if (!res.more) break;
    }
  };

  await pullAll();
  let needPull = false;
  let prefsPending = await collectPrefChanges({ markAll });
  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const room = CLIENT_BATCH.maxItems - prefsPending.length;
    const dirty = await getDirty({ ...CLIENT_BATCH, maxItems: Math.max(0, room) });
    tooLarge += dirty.tooLarge;
    const batch = [...prefsPending, ...dirty.items];
    if (!batch.length) break;
    const res = await api.push(batch, csrf);
    usage = res.usage ?? usage;
    const staleKeys = new Set((res.stale ?? []).map((s) => `${s.store}\u001f${s.key}`));
    const seen = (res.stale ?? []).filter((s) => Number.isFinite(s.seq) && s.seq <= st.cursor);
    if ((res.stale ?? []).length > seen.length) needPull = true;
    const seenKeys = new Set(seen.map((s) => `${s.store}\u001f${s.key}`));
    // Subidos, rechazados (no se reintentan) y «stale» aún no vistos (los traerá la bajada) → limpios.
    const clean = batch.filter((it) => !seenKeys.has(`${it.store}\u001f${it.key}`));
    await markClean(clean.filter((it) => it.store !== 'prefs'));
    await markPrefsClean(clean.filter((it) => it.store === 'prefs'));
    // «stale» ya vistos: nuestra edición es posterior; se re-fecha y se sube en la siguiente vuelta.
    await bumpChanges(seen.filter((s) => s.store !== 'prefs'));
    await bumpPrefs(seen.filter((s) => s.store === 'prefs'));
    pushed += batch.length - staleKeys.size;
    // Si nadie escribió entre nuestro cursor y esta subida, no hace falta volver a bajar lo nuestro.
    if (res.applied > 0 && res.fromSeq === st.cursor + 1) {
      st = { ...st, cursor: res.toSeq };
      await setMeta(SYNC_STATE_KEY, st);
    } else if (res.applied > 0) {
      needPull = true;
    }
    prefsPending = seen.some((s) => s.store === 'prefs') ? await collectPrefChanges() : [];
    if (!dirty.more && !seen.length && !prefsPending.length) break;
  }
  if (needPull) await pullAll();
  setStatus({ usage, tooLarge });
  return { pulled, pushed };
}

/** Clasifica un error de la API en un estado de la sincronización. */
export function statusForError(e) {
  if (!(e instanceof ApiError)) return { state: 'error', error: String(e?.message ?? e) };
  switch (e.kind) {
    case 'quota_daily': return { state: 'quota', retryAfter: e.retryAfter ?? null, usage: e.usage ?? null };
    case 'quota_storage':
    case 'quota_items': return { state: 'full', usage: e.usage ?? null };
    case 'premium_required':
    case 'unauthenticated': return { state: 'off' };
    case 'network':
    case 'unavailable':
    case 'rate_limited': return { state: 'offline' };
    default: return { state: 'error', error: e.kind };
  }
}

/** Una pasada con cerrojo entre pestañas (Web Locks) y estado para la interfaz. */
export async function runSync(o) {
  const run = async () => {
    setStatus({ state: 'syncing', error: null });
    try {
      await syncOnce(o);
      setStatus({ state: 'idle', lastSyncAt: Date.now(), retryAfter: null, pending: await countDirty() });
      return true;
    } catch (e) {
      setStatus({ ...statusForError(e), pending: await countDirty().catch(() => null) });
      return false;
    }
  };
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return run();
  return locks.request('escaque-sync', { ifAvailable: true }, (lock) => (lock ? run() : false));
}

export const markSyncOff = () => setStatus({ state: 'off' });
