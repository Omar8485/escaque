import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetDbForTests, count, get, getMeta, put, setMeta, STORES } from '../storage/db.js'
import { clearAllGames, listGames, onGamesChanged, removePlayedGame, savePlayedGame } from './store.js'

const record = (id = 'local') => ({
  game: {
    id: `escaque:${id}`, source: 'escaque', externalId: id, url: null,
    white: 'Jugador', black: 'Héctor', whiteElo: null, blackElo: null,
    result: '0-1', endTime: 100, timeControl: '300+3', speed: 'blitz',
    rated: false, variant: 'standard', eco: null, opening: null,
    termination: 'abandoned', pgn: '1. e4 0-1', playerName: 'Jugador',
    playerColor: 'w', importedAt: 100,
  },
  moves: [{ ply: 1, color: 'w', san: 'e4', uci: 'e2e4', label: 'Best' }],
})

const unsubscribers = []
const subscribe = (listener) => {
  unsubscribers.push(onGamesChanged(listener))
  return listener
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(async () => {
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe())
  await _resetDbForTests()
  vi.unstubAllGlobals()
})

describe('partidas locales: avisos y cola de escrituras', () => {
  it('notifica una escritura confirmada y expone la partida y sus jugadas', async () => {
    const listener = subscribe(vi.fn())
    const saved = record()
    await savePlayedGame(saved)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(await listGames()).toEqual([saved.game])
    expect(await get(STORES.moves, saved.game.id)).toEqual({ gameId: saved.game.id, moves: saved.moves })

    unsubscribers.pop()()
    await savePlayedGame({ ...saved, moves: [{ ...saved.moves[0], loss: 0 }] })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(await count(STORES.games)).toBe(1)
  })

  it('borrar todo elimina jugadas y análisis sin perder las cuentas ni los puzles', async () => {
    const saved = record()
    await savePlayedGame(saved)
    await put(STORES.analysis, { gameId: saved.game.id, scores: [] })
    await put(STORES.puzzles, { id: 'puzzle', gameId: saved.game.id })
    await setMeta('accounts', { lichess: 'jugador' })
    await setMeta('import:lichess:jugador', { lastImportAt: 1 })
    const listener = subscribe(vi.fn())

    await clearAllGames()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(await listGames()).toEqual([])
    expect(await count(STORES.moves)).toBe(0)
    expect(await count(STORES.analysis)).toBe(0)
    expect(await getMeta('import:lichess:jugador')).toBeUndefined()
    expect(await getMeta('accounts')).toEqual({ lichess: 'jugador' })
    expect(await get(STORES.puzzles, 'puzzle')).toEqual({ id: 'puzzle', gameId: saved.game.id })
  })

  it('una escritura encolada antes de borrar no resucita la partida ni sus jugadas', async () => {
    const listener = subscribe(vi.fn())
    const first = savePlayedGame(record('first'))
    const second = savePlayedGame(record('second'))
    const clearing = clearAllGames()
    await Promise.all([first, second, clearing])
    expect(await listGames()).toEqual([])
    expect(await count(STORES.moves)).toBe(0)
    // Las escrituras invalidadas no anuncian partidas que nunca se guardaron.
    expect(listener).toHaveBeenCalledTimes(1)

    await savePlayedGame(record('after-clear'))
    expect((await listGames()).map((game) => game.id)).toEqual(['escaque:after-clear'])
    expect(await count(STORES.moves)).toBe(1)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('deshacer un final borra únicamente la partida indicada y su ledger después del guardado', async () => {
    const saved = record('undone')
    await savePlayedGame(record('kept'))
    const listener = subscribe(vi.fn())
    const pendingSave = savePlayedGame(saved)
    const pendingRemoval = removePlayedGame(saved.game.id)
    await Promise.all([pendingSave, pendingRemoval])
    expect(await get(STORES.games, saved.game.id)).toBeUndefined()
    expect(await get(STORES.moves, saved.game.id)).toBeUndefined()
    expect((await listGames()).map((game) => game.id)).toEqual(['escaque:kept'])
    expect(await get(STORES.moves, 'escaque:kept')).toBeDefined()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('una escritura fallida no notifica ni bloquea la siguiente', async () => {
    const listener = subscribe(vi.fn())
    const invalid = { ...record('invalid'), moves: [() => {}] }
    await expect(savePlayedGame(invalid)).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(listener).not.toHaveBeenCalled()
    await savePlayedGame(record('valid'))
    expect(listener).toHaveBeenCalledTimes(1)
    expect((await listGames()).map((game) => game.id)).toEqual(['escaque:valid'])
    expect(await count(STORES.moves)).toBe(1)
  })
})
