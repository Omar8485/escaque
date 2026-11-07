import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DB_NAME, STORES, _resetDbForTests, changeId, clear, clearGameData, get, getAll, getMeta, onLocalChange, openDb, put, putMany,
  remove, removeMetaByPrefix, removeTrainingGame, saveTrainingGame, setMeta,
} from './db.js'

afterEach(async () => {
  await _resetDbForTests()
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = resolve })
})

const game = (id, endTime = 1) => ({ id, source: 'lichess', externalId: id, endTime, pgn: '1. e4 *', playerColor: 'w' })
const change = (store, key) => get(STORES.changes, changeId(store, key))

/** Base v2 tal como la dejaba la versión anterior de la app, con datos. */
async function createV2() {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 2)
    r.onupgradeneeded = () => {
      const d = r.result
      const games = d.createObjectStore('games', { keyPath: 'id' })
      games.createIndex('endTime', 'endTime')
      games.createIndex('source', 'source')
      d.createObjectStore('analysis', { keyPath: 'gameId' })
      const puzzles = d.createObjectStore('puzzles', { keyPath: 'id' })
      puzzles.createIndex('gameId', 'gameId')
      d.createObjectStore('meta', { keyPath: 'key' })
      d.createObjectStore('moves', { keyPath: 'gameId' })
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  await new Promise((resolve, reject) => {
    const t = db.transaction(['games', 'analysis', 'puzzles', 'meta', 'moves'], 'readwrite')
    t.objectStore('games').put(game('lichess:a', 5))
    t.objectStore('analysis').put({ gameId: 'lichess:a', scores: [] })
    t.objectStore('puzzles').put({ id: 'p1', gameId: 'lichess:a' })
    t.objectStore('moves').put({ gameId: 'lichess:a', moves: [{ ply: 1 }] })
    t.objectStore('meta').put({ key: 'accounts', value: { lichess: 'x' } })
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
  })
  db.close()
}

describe('IndexedDB v3: registro de cambios para la sincronización', () => {
  it('migra v2 → v3 sin perder datos ni índices y sin anotar nada', async () => {
    await createV2()
    const db = await openDb()
    expect(db.version).toBe(3)
    expect([...db.objectStoreNames].sort()).toEqual(['analysis', 'changes', 'games', 'meta', 'moves', 'puzzles'])
    expect(await get(STORES.games, 'lichess:a')).toEqual(game('lichess:a', 5))
    expect(await get(STORES.moves, 'lichess:a')).toEqual({ gameId: 'lichess:a', moves: [{ ply: 1 }] })
    expect(await get(STORES.puzzles, 'p1')).toEqual({ id: 'p1', gameId: 'lichess:a' })
    expect(await getMeta('accounts')).toEqual({ lichess: 'x' })
    expect(await getAll(STORES.changes)).toEqual([])
  })

  it('cada escritura anota updatedAt creciente y queda pendiente', async () => {
    const before = Date.now()
    await put(STORES.games, game('g1'))
    await putMany(STORES.puzzles, [{ id: 'p1', gameId: 'g1' }, { id: 'p2', gameId: 'g1' }])
    await setMeta('rewards:xp', 10)
    const c1 = await change('games', 'g1')
    expect(c1).toMatchObject({ store: 'games', key: 'g1', deleted: false, dirty: 1 })
    expect(c1.updatedAt).toBeGreaterThanOrEqual(before)
    const p1 = await change('puzzles', 'p1')
    const p2 = await change('puzzles', 'p2')
    expect(p2.updatedAt).toBeGreaterThan(p1.updatedAt)
    expect(await change('meta', 'rewards:xp')).toMatchObject({ dirty: 1 })
  })

  it('borrados dejan lápidas: remove, clear, clearGameData, removeTrainingGame y removeMetaByPrefix', async () => {
    await saveTrainingGame({ game: game('escaque:1'), moves: [] })
    expect(await change('moves', 'escaque:1')).toMatchObject({ deleted: false })
    await removeTrainingGame('escaque:1')
    expect(await change('games', 'escaque:1')).toMatchObject({ deleted: true, dirty: 1 })
    expect(await change('moves', 'escaque:1')).toMatchObject({ deleted: true })

    await put(STORES.puzzles, { id: 'p9', gameId: 'x' })
    await remove(STORES.puzzles, 'p9')
    expect(await change('puzzles', 'p9')).toMatchObject({ deleted: true })

    await putMany(STORES.games, [game('a'), game('b')])
    await put(STORES.analysis, { gameId: 'a', scores: [] })
    await clearGameData()
    expect(await change('games', 'a')).toMatchObject({ deleted: true })
    expect(await change('analysis', 'a')).toMatchObject({ deleted: true })

    await put(STORES.puzzles, { id: 'q', gameId: 'x' })
    await clear(STORES.puzzles)
    expect(await change('puzzles', 'q')).toMatchObject({ deleted: true })

    await setMeta('import:lichess:x', { total: 1 })
    await setMeta('accounts', {})
    expect(await removeMetaByPrefix('import:')).toBe(1)
    expect(await getMeta('import:lichess:x')).toBeUndefined()
    expect(await getMeta('accounts')).toEqual({})
    expect(await change('meta', 'import:lichess:x')).toMatchObject({ deleted: true })
  })

  it('no anota el estado local de la sincronización ni el del generador de puzles', async () => {
    await setMeta('sync:state', { cursor: 1 })
    await setMeta('puzzleGenerator', { status: 'running' })
    expect(await getAll(STORES.changes)).toEqual([])
  })

  it('avisa de cambios locales (para programar la subida)', async () => {
    const fn = vi.fn()
    const off = onLocalChange(fn)
    await put(STORES.games, game('g'))
    await setMeta('sync:state', {})
    off()
    await put(STORES.games, game('h'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('si la escritura falla, tampoco queda anotada', async () => {
    await expect(saveTrainingGame({ game: game('z'), moves: [() => {}] })).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(await change('games', 'z')).toBeUndefined()
  })
})
