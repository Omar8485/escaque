// Almacenamiento local de Escaque en IndexedDB (sin dependencias).
//
// Contrato común para la importación de partidas, el generador de puzles y el
// seguimiento del progreso. Todo vive en el navegador del usuario: no hay servidor.
//
// Base de datos `escaque`, versión 3. Almacenes:
//   - games     (keyPath `id`)      partidas normalizadas (ver `Game`). Índices: `endTime`, `source`.
//   - analysis  (keyPath `gameId`)  evaluaciones del motor por partida (ver `GameAnalysis`).
//   - puzzles   (keyPath `id`)      puzles generados (formato de src/data/puzzles.json + `gameId`). Índice: `gameId`.
//   - moves     (keyPath `gameId`)  jugadas y ayuda del coach por partida de Entrenar (ver `GameMoves`).
//   - meta      (keyPath `key`)     cuentas vinculadas, fechas de última importación, etc. `{ key, value }`.
//   - changes   (keyPath `id`)      v3: cuándo cambió cada registro de los almacenes anteriores (ver `Change`),
//                                   para la sincronización opcional entre dispositivos (src/sync/). Índice: `dirty`.
//
// Toda escritura de games/analysis/puzzles/moves/meta hecha con las funciones de este archivo anota en
// `changes`, en la misma transacción, la hora del cambio (`updatedAt`) y si fue un borrado (lápida).
// Sin cuenta no sale nada del navegador: el registro solo sirve si el usuario activa la sincronización.
// Las claves de `meta` que empiezan por `sync:` son estado local de la sincronización y no se anotan.
//
// Para añadir un almacén o índice: subir DB_VERSION y agregarlo en `upgrade()` sin borrar los existentes.

/**
 * Partida normalizada, venga de donde venga.
 * @typedef {Object} Game
 * @property {string} id              `${source}:${externalId}` (único; reimportar no duplica).
 * @property {'lichess'|'chesscom'|'pgn'|'demo'|'escaque'} source
 * @property {string} externalId      id en la plataforma (o hash del PGN si es un archivo).
 * @property {string|null} url        enlace a la partida en la plataforma.
 * @property {string} white
 * @property {string} black
 * @property {number|null} whiteElo
 * @property {number|null} blackElo
 * @property {'1-0'|'0-1'|'1/2-1/2'|'*'} result
 * @property {number} endTime         ms desde epoch (fin de la partida; si no se sabe, inicio o fecha del PGN).
 * @property {string|null} timeControl  p. ej. '300+3' (segundos + incremento).
 * @property {'ultraBullet'|'bullet'|'blitz'|'rapid'|'classical'|'correspondence'|'unknown'} speed
 * @property {boolean|null} rated
 * @property {string} variant         'standard' (las demás variantes no se importan).
 * @property {string|null} eco
 * @property {string|null} opening
 * @property {string|null} termination
 * @property {string} pgn             PGN completo (con relojes `[%clk]` si la plataforma los da).
 * @property {string} playerName      cuenta del usuario de Escaque en esa plataforma.
 * @property {'w'|'b'|null} playerColor  color del usuario en esta partida.
 * @property {number} importedAt      ms desde epoch.
 */

/**
 * Evaluaciones del motor de una partida (las produce el generador de puzles; las reutiliza el seguimiento).
 * @typedef {Object} GameAnalysis
 * @property {string} gameId
 * @property {number} depth
 * @property {Array<{type:'cp'|'mate', value:number, winner?:'w'|'b'}>} scores  una por posición (ply 0..n), perspectiva de blancas.
 * @property {Array<string|null>} bestMoves  mejor jugada UCI por posición.
 * @property {number} analyzedAt
 * @property {number} generatorVersion
 */

export const DB_NAME = 'escaque'
/**
 * Jugadas de una partida de Entrenar. Registro separado de `analysis`: no simula
 * una evaluación completa del generador, admite clasificaciones todavía pendientes
 * y permite actualizar el ledger sin reescribir el PGN ni lanzar búsquedas nuevas.
 * @typedef {Object} GameMoves
 * @property {string} gameId
 * @property {Array<object>} moves datos por ply producidos por el registro de Entrenar.
 */
export const DB_VERSION = 3
export const STORES = Object.freeze({ games: 'games', analysis: 'analysis', puzzles: 'puzzles', meta: 'meta', moves: 'moves', changes: 'changes' })

/**
 * Registro de cambios (v3) de un registro sincronizable.
 * @typedef {Object} Change
 * @property {string} id         `${store}\u001f${key}`
 * @property {string} store
 * @property {string} key
 * @property {number} updatedAt  ms; última escritura gana entre dispositivos
 * @property {boolean} deleted   lápida
 * @property {0|1|2} dirty       1 = pendiente de subir; 0 = sincronizado; 2 = demasiado grande para subir
 */

/** Almacenes cuyos registros se pueden sincronizar (con cuenta Premium). */
export const SYNCED_STORES = Object.freeze([STORES.games, STORES.analysis, STORES.moves, STORES.puzzles, STORES.meta])
const KEY_PATHS = Object.freeze({ games: 'id', analysis: 'gameId', puzzles: 'id', moves: 'gameId', meta: 'key' })
export const changeId = (store, key) => `${store}\u001f${key}`
/** Claves de `meta` propias de cada aparato: no viajan (p. ej. el estado del generador en curso). */
const LOCAL_ONLY_META = new Set(['puzzleGenerator'])
/** ¿Se anota este registro? (las claves `sync:*` de meta son estado local de la sincronización). */
export const isTracked = (store, key) =>
  SYNCED_STORES.includes(store) &&
  !(store === STORES.meta && (String(key).startsWith('sync:') || LOCAL_ONLY_META.has(String(key))))
/** Clave de un registro según el keyPath de su almacén. */
export const keyOf = (store, value) => value?.[KEY_PATHS[store]]

let lastStamp = 0
/** Hora del cambio, estrictamente creciente en esta pestaña (dos escrituras seguidas no empatan). */
export function changeStamp(now = Date.now()) {
  lastStamp = Math.max(now, lastStamp + 1)
  return lastStamp
}

const changeListeners = new Set()
/** Avisa de escrituras locales anotadas (la sincronización programa una subida). */
export function onLocalChange(fn) {
  changeListeners.add(fn)
  return () => changeListeners.delete(fn)
}
const emitLocalChange = () => changeListeners.forEach((fn) => { try { fn() } catch { /* oyente roto */ } })

/** Anota un cambio dentro de una transacción que incluye `changes`. Devuelve si anotó. */
function track(t, store, key, deleted) {
  if (key == null || !isTracked(store, key)) return false
  t.objectStore(STORES.changes).put({ id: changeId(store, key), store, key: String(key), updatedAt: changeStamp(), deleted, dirty: 1 })
  return true
}

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const games = db.createObjectStore(STORES.games, { keyPath: 'id' })
    games.createIndex('endTime', 'endTime')
    games.createIndex('source', 'source')
    db.createObjectStore(STORES.analysis, { keyPath: 'gameId' })
    const puzzles = db.createObjectStore(STORES.puzzles, { keyPath: 'id' })
    puzzles.createIndex('gameId', 'gameId')
    db.createObjectStore(STORES.meta, { keyPath: 'key' })
  }
  if (oldVersion < 2) {
    db.createObjectStore(STORES.moves, { keyPath: 'gameId' })
  }
  if (oldVersion < 3) {
    // Solo se añade el registro de cambios: los datos existentes no se tocan. Los registros sin
    // entrada en `changes` se anotan al activar la sincronización (src/sync/local.js → bootstrap).
    const changes = db.createObjectStore(STORES.changes, { keyPath: 'id' })
    changes.createIndex('dirty', 'dirty')
  }
}

let dbPromise = null

/** @param {IDBFactory} [factory] para tests (fake-indexeddb). */
export function openDb(factory = globalThis.indexedDB) {
  if (!factory) return Promise.reject(new Error('IndexedDB no está disponible en este navegador'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion)
      req.onsuccess = () => {
        const db = req.result
        // Otra pestaña con una versión nueva: cerrar para no bloquearla.
        db.onversionchange = () => { db.close(); dbPromise = null }
        resolve(db)
      }
      req.onerror = () => { dbPromise = null; reject(req.error) }
      req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB bloqueada por otra pestaña')) }
    })
  }
  return dbPromise
}

/** Solo para tests: olvida la conexión abierta. */
export async function _resetDbForTests() {
  if (dbPromise) {
    try { (await dbPromise).close() } catch { /* ya cerrada */ }
  }
  dbPromise = null
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

async function tx(storeName, mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode)
    let result
    Promise.resolve(fn(t.objectStore(storeName))).then((r) => { result = r }, reject)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('Transacción abortada'))
  })
}

export const get = (store, key) => tx(store, 'readonly', (s) => done(s.get(key)))
export const getAll = (store) => tx(store, 'readonly', (s) => done(s.getAll()))
export const count = (store) => tx(store, 'readonly', (s) => done(s.count()))

/**
 * Transacción de escritura sobre `stores` + `changes`. `fn(t, mark)` hace las escrituras y llama a
 * `mark(store, key, deleted)` por cada una (anota el cambio si el registro es sincronizable).
 */
export async function writeTx(stores, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction([...new Set([...stores, STORES.changes])], 'readwrite')
    let result
    let tracked = false
    const mark = (store, key, deleted = false) => { tracked = track(t, store, key, deleted) || tracked }
    t.oncomplete = () => {
      if (tracked) emitLocalChange()
      resolve(result)
    }
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('Transacción abortada'))
    try {
      Promise.resolve(fn(t, mark)).then((r) => { result = r }, (e) => { try { t.abort() } catch { /* ya terminada */ } reject(e) })
    } catch (error) {
      try { t.abort() } catch { /* ya terminada */ }
      reject(error)
    }
  })
}

export const put = (store, value) =>
  writeTx([store], (t, mark) => {
    const req = t.objectStore(store).put(value)
    mark(store, keyOf(store, value) ?? null)
    return done(req)
  })

export const remove = (store, key) =>
  writeTx([store], (t, mark) => {
    const req = t.objectStore(store).delete(key)
    mark(store, key, true)
    return done(req)
  })

/** Vacía un almacén dejando una lápida por cada registro (para que el borrado llegue a otros dispositivos). */
export const clear = (store) =>
  writeTx([store], (t, mark) => new Promise((resolve, reject) => {
    const s = t.objectStore(store)
    const keys = s.getAllKeys()
    keys.onsuccess = () => {
      for (const key of keys.result) mark(store, key, true)
      s.clear().onsuccess = () => resolve()
    }
    keys.onerror = () => reject(keys.error)
  }))

/** Escribe varios registros en una sola transacción. Devuelve cuántos escribió. */
export const putMany = (store, values) =>
  writeTx([store], (t, mark) => {
    const s = t.objectStore(store)
    for (const v of values) {
      s.put(v)
      mark(store, keyOf(store, v) ?? null)
    }
    return values.length
  })

/** Borra las claves de `meta` que empiezan por `prefix` (con lápidas). */
export const removeMetaByPrefix = (prefix) =>
  writeTx([STORES.meta], (t, mark) => new Promise((resolve, reject) => {
    const s = t.objectStore(STORES.meta)
    const req = s.getAllKeys()
    req.onsuccess = () => {
      let n = 0
      for (const key of req.result) {
        if (!String(key).startsWith(prefix)) continue
        s.delete(key)
        mark(STORES.meta, key, true)
        n += 1
      }
      resolve(n)
    }
    req.onerror = () => reject(req.error)
  }))

/** Registros de un índice con una clave exacta (p. ej. puzles de una partida). */
export const getAllByIndex = (store, index, key) =>
  tx(store, 'readonly', (s) => done(s.index(index).getAll(key)))

/** Partidas ordenadas de la más reciente a la más antigua. */
export async function listGamesNewestFirst() {
  const all = await getAll(STORES.games)
  return all.sort((a, b) => b.endTime - a.endTime)
}

export const getMeta = async (key) => (await get(STORES.meta, key))?.value
export const setMeta = (key, value) => put(STORES.meta, { key, value })

/** Rango de claves que empiezan por `prefix`. */
const prefixRange = (prefix) => IDBKeyRange.bound(prefix, `${prefix}\uffff`)

/** Lee juntas la clave `key` de `meta` y las que empiezan por `prefix`: `{ clave: valor }`. */
export const getMetaGroup = (key, prefix) =>
  tx(STORES.meta, 'readonly', (s) => new Promise((resolve, reject) => {
    const out = {}
    const one = s.get(key)
    const many = s.getAll(prefixRange(prefix))
    many.onsuccess = () => {
      for (const r of many.result) out[r.key] = r.value
      if (one.result) out[one.result.key] = one.result.value
      resolve(out)
    }
    one.onerror = () => reject(one.error)
    many.onerror = () => reject(many.error)
  }))

/**
 * Lee y reescribe un grupo de claves de `meta` (`key` y las que empiezan por `prefix`) en UNA
 * transacción: nada (otra pestaña, la sincronización) puede escribir entre la lectura y la escritura. `fn({ clave: valor })` es síncrona y devuelve `{ clave: valorNuevo }` con lo que
 * hay que escribir (o `undefined`).
 */
export const updateMetaGroup = (key, prefix, fn) =>
  writeTx([STORES.meta], (t, mark) => new Promise((resolve, reject) => {
    const s = t.objectStore(STORES.meta)
    const records = {}
    const one = s.get(key)
    const many = s.getAll(prefixRange(prefix))
    many.onsuccess = () => {
      for (const r of many.result) records[r.key] = r.value
      if (one.result) records[one.result.key] = one.result.value
      let writes
      try {
        writes = fn(records)
      } catch (error) {
        reject(error)
        return
      }
      for (const [k, value] of Object.entries(writes ?? {})) {
        s.put({ key: k, value })
        mark(STORES.meta, k)
      }
      resolve(writes)
    }
    one.onerror = () => reject(one.error)
    many.onerror = () => reject(many.error)
  }))

/**
 * Guarda la partida y sus jugadas juntas: nunca queda una partida sin su ledger
 * por un fallo parcial de escritura (cuota, clonación o transacción abortada).
 * Repetir con el mismo id actualiza el registro sin duplicarlo.
 * @param {{game: Game, moves: Array<object>}} record
 */
export function saveTrainingGame({ game, moves }) {
  return writeTx([STORES.games, STORES.moves], (t, mark) => {
    t.objectStore(STORES.games).put(game)
    t.objectStore(STORES.moves).put({ gameId: game.id, moves })
    mark(STORES.games, game.id)
    mark(STORES.moves, game.id)
    return game.id
  })
}

/** Borra partidas y sus análisis/jugadas juntos (con lápidas); conserva puzles y preferencias. */
export function clearGameData() {
  const stores = [STORES.games, STORES.analysis, STORES.moves]
  return writeTx(stores, (t, mark) => Promise.all(stores.map((store) => new Promise((resolve, reject) => {
    const s = t.objectStore(store)
    const keys = s.getAllKeys()
    keys.onsuccess = () => {
      for (const key of keys.result) mark(store, key, true)
      s.clear().onsuccess = () => resolve()
    }
    keys.onerror = () => reject(keys.error)
  }))).then(() => undefined))
}

/** Retira un resultado deshecho junto a sus jugadas en la misma transacción. */
export function removeTrainingGame(id) {
  return writeTx([STORES.games, STORES.moves], (t, mark) => {
    t.objectStore(STORES.games).delete(id)
    t.objectStore(STORES.moves).delete(id)
    mark(STORES.games, id, true)
    mark(STORES.moves, id, true)
  })
}
