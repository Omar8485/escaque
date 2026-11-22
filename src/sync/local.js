// Lado local de la sincronización: lee lo pendiente de subir del registro `changes` (IndexedDB v3)
// y aplica lo que llega del servidor con «última escritura gana» por `updatedAt`.
// Sin React y sin red (eso está en engine.js y api.js).
import { STORES, SYNCED_STORES, changeId, changeStamp, isTracked, keyOf, openDb } from '../storage/db.js';
import { sameValue } from '../rewards/merge.js';
import { isRewardKey, mergeRewardRecord } from '../rewards/store.js';

/**
 * Fusión de las claves de `meta` que no siguen «última escritura gana»: registros que acumulan lo
 * de todos los dispositivos (si no, el más reciente borraría lo del otro). Hoy, las recompensas
 * (`rewards` y `rewards:day:*`, ver src/rewards/store.js). Devuelve `merge(preferida, otra)` con
 * los `value` (la preferida es la copia más reciente) o null si la clave no se fusiona.
 */
const metaMerger = (key) => (isRewardKey(key) ? (preferred, other) => mergeRewardRecord(key, preferred, other) : null);

/** @typedef {{store:string, key:string, updatedAt:number, deleted:boolean, data?:any}} SyncItem */

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

function transaction(db, stores, mode) {
  const t = db.transaction([...new Set(stores)], mode);
  const finished = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transacción abortada'));
  });
  return { t, finished };
}

/** Orden de subida: primero las partidas, luego lo que depende de ellas. */
const STORE_ORDER = Object.fromEntries(SYNCED_STORES.map((s, i) => [s, i]));

/**
 * Registros pendientes de subir, con sus datos, hasta `maxItems` o `maxBytes` (aprox.).
 * Los que superan `maxItemBytes` se marcan `dirty: 2` (no se suben) y se cuentan en `tooLarge`.
 * @returns {Promise<{items: SyncItem[], tooLarge: number, more: boolean}>}
 */
export async function getDirty({ maxItems = 100, maxBytes = 400 * 1024, maxItemBytes = 128 * 1024 } = {}) {
  const db = await openDb();
  const { t, finished } = transaction(db, [STORES.changes, ...SYNCED_STORES], 'readwrite');
  const changes = t.objectStore(STORES.changes);
  const pending = await req(changes.index('dirty').getAll(1));
  pending.sort((a, b) => (STORE_ORDER[a.store] - STORE_ORDER[b.store]) || (a.updatedAt - b.updatedAt));
  const items = [];
  let bytes = 0;
  let tooLarge = 0;
  let more = false;
  for (const ch of pending) {
    if (items.length >= maxItems) { more = true; break; }
    let data = null;
    if (!ch.deleted) {
      data = await req(t.objectStore(ch.store).get(ch.key));
      if (data === undefined) {
        // Borrado sin anotar (no debería pasar): se sube como lápida.
        items.push({ store: ch.store, key: ch.key, updatedAt: ch.updatedAt, deleted: true });
        continue;
      }
    }
    const size = data == null ? 0 : JSON.stringify(data).length;
    if (size > maxItemBytes) {
      changes.put({ ...ch, dirty: 2 });
      tooLarge += 1;
      continue;
    }
    if (items.length && bytes + size > maxBytes) { more = true; break; }
    bytes += size + 100;
    items.push(ch.deleted ? { store: ch.store, key: ch.key, updatedAt: ch.updatedAt, deleted: true }
      : { store: ch.store, key: ch.key, updatedAt: ch.updatedAt, deleted: false, data });
  }
  await finished;
  return { items, tooLarge, more };
}

/** Marca como sincronizados los registros subidos (si no cambiaron mientras tanto). */
export async function markClean(items) {
  if (!items.length) return;
  const db = await openDb();
  const { t, finished } = transaction(db, [STORES.changes], 'readwrite');
  const changes = t.objectStore(STORES.changes);
  for (const it of items) {
    const r = changes.get(changeId(it.store, it.key));
    r.onsuccess = () => {
      const ch = r.result;
      if (ch && ch.updatedAt === it.updatedAt && ch.dirty) changes.put({ ...ch, dirty: 0 });
    };
  }
  await finished;
}

/**
 * El servidor tenía una versión más nueva que ya vimos (seq ≤ cursor) y aun así editamos después:
 * nuestra edición es posterior en la práctica (relojes desajustados). Se re-fecha para que gane.
 */
export async function bumpChanges(entries) {
  if (!entries.length) return;
  const db = await openDb();
  const { t, finished } = transaction(db, [STORES.changes], 'readwrite');
  const changes = t.objectStore(STORES.changes);
  for (const e of entries) {
    const r = changes.get(changeId(e.store, e.key));
    r.onsuccess = () => {
      const ch = r.result;
      if (ch && ch.dirty === 1) changes.put({ ...ch, updatedAt: Math.max(ch.updatedAt, e.updatedAt + 1) });
    };
  }
  await finished;
}

/**
 * Aplica registros del servidor (solo almacenes de IndexedDB; las preferencias van por prefs.js).
 * Gana el `updatedAt` mayor (ver empates abajo). No genera cambios pendientes.
 * @returns {Promise<{applied:number, stores:Set<string>}>}
 */
export async function applyRemote(items) {
  const usable = items.filter((it) => SYNCED_STORES.includes(it.store) && isTracked(it.store, it.key));
  const stores = new Set();
  if (!usable.length) return { applied: 0, stores };
  const db = await openDb();
  const { t, finished } = transaction(db, [STORES.changes, ...new Set(usable.map((i) => i.store))], 'readwrite');
  const changes = t.objectStore(STORES.changes);
  let applied = 0;
  for (const it of usable) {
    const r = changes.get(changeId(it.store, it.key));
    r.onsuccess = () => {
      const local = r.result;
      const merge = it.store === STORES.meta && !it.deleted ? metaMerger(it.key) : null;
      if (merge && local && !local.deleted) {
        mergeMeta(t, it, local, merge, () => { applied += 1; stores.add(it.store); });
        return;
      }
      // Gana el más reciente; con empate se queda lo local, salvo que lo local sea anterior a la
      // cuenta (updatedAt 1, sin fecha real): entonces manda la copia que ya estaba en el servidor.
      if (local && (local.updatedAt > it.updatedAt || (local.updatedAt === it.updatedAt && local.updatedAt > 1))) return;
      const target = t.objectStore(it.store);
      if (it.deleted) {
        target.delete(it.key);
      } else {
        // El registro debe traer su propia clave (keyPath) igual a la anunciada.
        if (!it.data || typeof it.data !== 'object' || String(keyOf(it.store, it.data)) !== it.key) return;
        target.put(it.data);
      }
      changes.put({ id: changeId(it.store, it.key), store: it.store, key: it.key, updatedAt: it.updatedAt, deleted: Boolean(it.deleted), dirty: 0 });
      applied += 1;
      stores.add(it.store);
    };
  }
  await finished;
  return { applied, stores };
}

/**
 * Fusiona un registro de `meta` fusionable (metaMerger) con la copia local dentro de la transacción.
 * - Si la fusión es la copia remota (la local no aportaba nada): se aplica como cualquier otra.
 * - Si es la local (la remota no aporta nada): no se toca.
 * - Si no: se guarda la fusión como cambio local pendiente, con fecha posterior a ambas, para que
 *   la subida que sigue a esta bajada la lleve al servidor y al resto de dispositivos.
 */
function mergeMeta(t, it, local, merge, onApplied) {
  const target = t.objectStore(it.store);
  const g = target.get(it.key);
  g.onsuccess = () => {
    const mine = g.result;
    if (!it.data || typeof it.data !== 'object' || String(keyOf(it.store, it.data)) !== it.key) return;
    const remote = it.data.value;
    if (!mine) {
      target.put(it.data);
      t.objectStore(STORES.changes).put({ id: changeId(it.store, it.key), store: it.store, key: it.key, updatedAt: it.updatedAt, deleted: false, dirty: 0 });
      onApplied();
      return;
    }
    const localNewer = local.updatedAt > it.updatedAt || (local.updatedAt === it.updatedAt && local.updatedAt > 1);
    const merged = localNewer ? merge(mine.value, remote) : merge(remote, mine.value);
    const sameMine = sameValue(merged, mine.value);
    const sameRemote = sameValue(merged, remote);
    const changes = t.objectStore(STORES.changes);
    const entry = (updatedAt, dirty) => ({ id: changeId(it.store, it.key), store: it.store, key: it.key, updatedAt, deleted: false, dirty });
    const newer = () => Math.max(changeStamp(), it.updatedAt + 1, local.updatedAt + 1);
    if (sameRemote && sameMine) {
      // Iguales: solo se adopta la fecha del servidor si era más reciente.
      if (!localNewer) changes.put(entry(it.updatedAt, 0));
    } else if (sameRemote) {
      target.put(it.data);
      changes.put(entry(it.updatedAt, 0));
      onApplied();
    } else if (sameMine) {
      // Lo local ya contiene lo remoto: hay que subirlo (si no estaba ya pendiente).
      if (local.dirty !== 1 || !localNewer) changes.put(entry(newer(), 1));
    } else {
      target.put({ ...mine, value: merged });
      changes.put(entry(newer(), 1));
      onApplied();
    }
  };
}

/**
 * Prepara la primera subida: todo registro sin entrada en `changes` (datos de antes de la v3)
 * se anota con updatedAt = 1 (así cualquier versión ya presente en el servidor gana) y pendiente.
 * Con `markAll`, además, todo lo anotado vuelve a quedar pendiente (cambio de cuenta).
 * @returns {Promise<number>} registros marcados como pendientes
 */
export async function bootstrapChanges({ markAll = false } = {}) {
  const db = await openDb();
  const { t, finished } = transaction(db, [STORES.changes, ...SYNCED_STORES], 'readwrite');
  const changes = t.objectStore(STORES.changes);
  const existing = await req(changes.getAll());
  const known = new Set(existing.map((c) => c.id));
  let marked = 0;
  if (markAll) {
    for (const ch of existing) {
      if (ch.dirty !== 1) { changes.put({ ...ch, dirty: 1 }); marked += 1; }
    }
  }
  for (const store of SYNCED_STORES) {
    const keys = await req(t.objectStore(store).getAllKeys());
    for (const key of keys) {
      if (!isTracked(store, key) || known.has(changeId(store, key))) continue;
      changes.put({ id: changeId(store, key), store, key: String(key), updatedAt: 1, deleted: false, dirty: 1 });
      marked += 1;
    }
  }
  await finished;
  return marked;
}

/** Cuántos registros faltan por subir. */
export async function countDirty() {
  const db = await openDb();
  const { t, finished } = transaction(db, [STORES.changes], 'readonly');
  const n = await req(t.objectStore(STORES.changes).index('dirty').count(1));
  await finished;
  return n;
}
