// Preferencias del navegador (localStorage) que viajan con la sincronización Premium.
// Nunca se sincroniza la clave de IA del usuario (escaque:ia) ni ajustes propios de cada aparato
// (tema claro/oscuro, idioma, sonido). localStorage no guarda fechas, así que se anota una huella
// de cada valor en meta `sync:prefs` y, si cambió desde la última vez, cuenta como cambio local.
import { getMeta, setMeta } from '../storage/db.js';

export const SYNCED_PREF_KEYS = Object.freeze([
  'escaque:puzzles', // progreso de puzles: resultados, Elo y repaso espaciado
  'coach-chess:profile', // nombre y avatar
  'alfred:prefs', // coach elegido y cuándo se detiene
  'escaque:board', // tema del tablero
  'escaque:rival-voice', // el rival habla
]);
const STAMPS_KEY = 'sync:prefs';

/** Huella FNV-1a de 32 bits + longitud (basta para detectar cambios, no es criptográfica). */
export function fingerprint(value) {
  if (value == null) return 'null';
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${value.length}:${h.toString(16)}`;
}

const storageOf = (s) => s ?? globalThis.localStorage ?? null;
function read(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

/**
 * Detecta cambios locales y devuelve los pendientes de subir (store 'prefs', data = texto guardado).
 * Un valor que nunca se anotó (preferencias de antes de la cuenta) cuenta con updatedAt = 1.
 * @param {{storage?:Storage, now?:number, markAll?:boolean}} [o]
 */
export async function collectPrefChanges({ storage, now = Date.now(), markAll = false } = {}) {
  const st = storageOf(storage);
  const stamps = { ...((await getMeta(STAMPS_KEY)) ?? {}) };
  let changed = false;
  for (const key of SYNCED_PREF_KEYS) {
    const value = read(st, key);
    const hash = fingerprint(value);
    const stamp = stamps[key];
    if (!stamp) {
      if (value == null) continue;
      stamps[key] = { hash, updatedAt: 1, dirty: true };
      changed = true;
    } else if (stamp.hash !== hash) {
      stamps[key] = { hash, updatedAt: Math.max(now, stamp.updatedAt + 1), dirty: true };
      changed = true;
    } else if (markAll && !stamp.dirty) {
      stamps[key] = { ...stamp, dirty: true };
      changed = true;
    }
  }
  if (changed) await setMeta(STAMPS_KEY, stamps);
  return SYNCED_PREF_KEYS.filter((key) => stamps[key]?.dirty).map((key) => {
    const value = read(st, key);
    return value == null
      ? { store: 'prefs', key, updatedAt: stamps[key].updatedAt, deleted: true }
      : { store: 'prefs', key, updatedAt: stamps[key].updatedAt, deleted: false, data: value };
  });
}

export async function markPrefsClean(items) {
  if (!items.length) return;
  const stamps = { ...((await getMeta(STAMPS_KEY)) ?? {}) };
  for (const it of items) {
    if (stamps[it.key]?.updatedAt === it.updatedAt) stamps[it.key] = { ...stamps[it.key], dirty: false };
  }
  await setMeta(STAMPS_KEY, stamps);
}

export async function bumpPrefs(entries) {
  if (!entries.length) return;
  const stamps = { ...((await getMeta(STAMPS_KEY)) ?? {}) };
  for (const e of entries) {
    if (stamps[e.key]?.dirty) stamps[e.key] = { ...stamps[e.key], updatedAt: Math.max(stamps[e.key].updatedAt, e.updatedAt + 1) };
  }
  await setMeta(STAMPS_KEY, stamps);
}

/**
 * Aplica preferencias del servidor si son más nuevas. Las pantallas abiertas leen su valor al
 * montarse, así que algunas preferencias se notan al recargar.
 * @returns {Promise<string[]>} claves cambiadas
 */
export async function applyRemotePrefs(items, { storage } = {}) {
  const st = storageOf(storage);
  const usable = items.filter((it) => it.store === 'prefs' && SYNCED_PREF_KEYS.includes(it.key));
  if (!usable.length || !st) return [];
  const stamps = { ...((await getMeta(STAMPS_KEY)) ?? {}) };
  const changed = [];
  for (const it of usable) {
    const local = stamps[it.key];
    const current = read(st, it.key);
    // Sin anotar = anterior a la cuenta (pierde); cambiado desde la última anotación = cambio de ahora.
    const localTs = !local ? 0 : local.hash === fingerprint(current) ? local.updatedAt : Date.now();
    if (localTs > it.updatedAt || (localTs === it.updatedAt && localTs > 1)) continue;
    const value = it.deleted ? null : typeof it.data === 'string' ? it.data : null;
    if (!it.deleted && value == null) continue;
    try {
      if (value == null) st.removeItem(it.key);
      else st.setItem(it.key, value);
    } catch {
      continue;
    }
    stamps[it.key] = { hash: fingerprint(value), updatedAt: it.updatedAt, dirty: false };
    changed.push(it.key);
  }
  if (changed.length) await setMeta(STAMPS_KEY, stamps);
  return changed;
}
