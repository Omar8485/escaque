import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DB_NAME, DB_VERSION, STORES, _resetDbForTests, clearGameData, count, get, getAllByIndex, getMeta, listGamesNewestFirst, put, putMany, remove, saveTrainingGame, setMeta, openDb,
} from './db.js'

const game = (id, endTime) => ({
  id: `lichess:${id}`, source: 'lichess', externalId: id, url: null, white: 'a', black: 'b',
  whiteElo: null, blackElo: null, result: '1-0', endTime, timeControl: '300+3', speed: 'blitz',
  rated: true, variant: 'standard', eco: null, opening: null, termination: null, pgn: '1. e4 *',
  playerName: 'a', playerColor: 'w', importedAt: 0,
})

afterEach(async () => {
  await _resetDbForTests()
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase('escaque'); r.onsuccess = r.onerror = resolve })
})

describe('storage/db', () => {
  it('guarda y lee partidas; reimportar no duplica', async () => {
    await putMany(STORES.games, [game('x', 1), game('y', 3), game('x', 1)])
    expect(await count(STORES.games)).toBe(2)
    expect((await listGamesNewestFirst()).map((g) => g.externalId)).toEqual(['y', 'x'])
    await remove(STORES.games, 'lichess:y')
    expect(await get(STORES.games, 'lichess:y')).toBeUndefined()
  })

  it('índice de puzles por partida y meta', async () => {
    await put(STORES.puzzles, { id: 'p1', gameId: 'lichess:x' })
    await put(STORES.puzzles, { id: 'p2', gameId: 'lichess:z' })
    expect((await getAllByIndex(STORES.puzzles, 'gameId', 'lichess:x')).map((p) => p.id)).toEqual(['p1'])
    await setMeta('accounts', { lichess: 'jugador_demo' })
    expect(await getMeta('accounts')).toEqual({ lichess: 'jugador_demo' })
    expect(await getMeta('nada')).toBeUndefined()
  })
})


describe('partidas de Entrenar y migración v2', () => {
  it('abre una base v1 en v2 sin perder partidas, análisis, puzles, índices ni preferencias', async () => {
    const legacy = await new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        const games = db.createObjectStore('games', { keyPath: 'id' })
        games.createIndex('endTime', 'endTime')
        games.createIndex('source', 'source')
        db.createObjectStore('analysis', { keyPath: 'gameId' })
        const puzzles = db.createObjectStore('puzzles', { keyPath: 'id' })
        puzzles.createIndex('gameId', 'gameId')
        db.createObjectStore('meta', { keyPath: 'key' })
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const original = game('old', 17)
    const analysis = { gameId: original.id, scores: [{ type: 'cp', value: 23 }] }
    const puzzle = { id: 'old-puzzle', gameId: original.id, solution: ['e2e4'] }
    await new Promise((resolve, reject) => {
      const t = legacy.transaction(['games', 'analysis', 'puzzles', 'meta'], 'readwrite')
      t.objectStore('games').put(original)
      t.objectStore('analysis').put(analysis)
      t.objectStore('puzzles').put(puzzle)
      t.objectStore('meta').put({ key: 'accounts', value: { lichess: 'existing' } })
      t.oncomplete = resolve
      t.onerror = () => reject(t.error)
    })
    legacy.close()

    const upgraded = await openDb()
    expect(upgraded.version).toBe(DB_VERSION)
    expect(upgraded.version).toBe(3)
    expect(await get(STORES.games, original.id)).toEqual(original)
    expect(await get(STORES.analysis, original.id)).toEqual(analysis)
    expect(await getAllByIndex(STORES.puzzles, 'gameId', original.id)).toEqual([puzzle])
    expect(await getAllByIndex(STORES.games, 'source', 'lichess')).toEqual([original])
    expect(await getAllByIndex(STORES.games, 'endTime', 17)).toEqual([original])
    expect(await getMeta('accounts')).toEqual({ lichess: 'existing' })
    expect(await count(STORES.moves)).toBe(0)
    await saveTrainingGame({ game: { ...game('local', 20), source: 'escaque' }, moves: [{ ply: 1, san: 'e4' }] })
    expect(await count(STORES.games)).toBe(2)
  })

  it('guarda y actualiza partida y jugadas sin duplicarlas', async () => {
    const local = { ...game('local', 20), id: 'escaque:local', source: 'escaque' }
    const moves = [{ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', label: null }]
    expect(await saveTrainingGame({ game: local, moves })).toBe(local.id)
    expect(await get(STORES.games, local.id)).toEqual(local)
    expect(await get(STORES.moves, local.id)).toEqual({ gameId: local.id, moves })
    const classified = [{ ...moves[0], label: 'Best', loss: 0 }]
    await saveTrainingGame({ game: local, moves: classified })
    expect(await count(STORES.games)).toBe(1)
    expect(await count(STORES.moves)).toBe(1)
    expect((await get(STORES.moves, local.id)).moves).toEqual(classified)
  })

  it('aborta ambas escrituras si las jugadas no se pueden clonar', async () => {
    const local = { ...game('local', 20), source: 'escaque' }
    await expect(saveTrainingGame({ game: local, moves: [() => {}] })).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(await get(STORES.games, local.id)).toBeUndefined()
    expect(await get(STORES.moves, local.id)).toBeUndefined()
  })

  it('borra partidas, análisis y jugadas conservando puzles y preferencias', async () => {
    const local = { ...game('local', 20), source: 'escaque' }
    await saveTrainingGame({ game: local, moves: [{ ply: 1 }] })
    await put(STORES.analysis, { gameId: local.id, scores: [] })
    await put(STORES.puzzles, { id: 'kept', gameId: local.id })
    await setMeta('accounts', { lichess: 'existing' })
    await clearGameData()
    expect(await count(STORES.games)).toBe(0)
    expect(await count(STORES.analysis)).toBe(0)
    expect(await count(STORES.moves)).toBe(0)
    expect(await get(STORES.puzzles, 'kept')).toEqual({ id: 'kept', gameId: local.id })
    expect(await getMeta('accounts')).toEqual({ lichess: 'existing' })
  })
})
