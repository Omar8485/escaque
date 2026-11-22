// Sincronización de punta a punta en Node: dos "dispositivos" (dos IndexedDB y dos localStorage
// independientes) contra el Worker real con D1 en memoria (node:sqlite).
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORES, _resetDbForTests, changeId, get, getMeta, put, remove, setMeta } from '../storage/db.js'
import { ApiError } from '../account/api.js'
import { SYNC_STATE_KEY, syncOnce, statusForError } from './engine.js'
import { call, loginTest, makeEnv, postJson, sendWebhook, subscriptionEvent } from '../../worker/test/helpers.js'
import { _resetMemoryLimits } from '../../worker/lib/ratelimit.js'

class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
}

function device() {
  return { idb: new IDBFactory(), storage: new MemoryStorage() }
}

async function switchTo(dev) {
  await _resetDbForTests()
  globalThis.indexedDB = dev.idb
  globalThis.localStorage = dev.storage
}

function apiFor(env, session) {
  const parse = async (res) => {
    const body = await res.json()
    if (!res.ok) throw new ApiError(res.status, body.error.kind, body.error)
    return body
  }
  return {
    pull: async (cursor) => parse(await call(env, session.jar, `/api/sync/pull?cursor=${cursor}`)),
    push: async (items, csrf) => parse(await postJson(env, session.jar, '/api/sync/push', { items }, csrf)),
  }
}

/** Añade a unas recompensas un premio y un día (como haría runtime.js). */
const mergeRewardsForTest = (r, awards, date, id) => {
  const all = { ...r.xp.awards, ...awards }
  return { ...r, xp: { xp: Object.values(all).reduce((n, a) => n + a.amount, 0), awards: all },
    daily: { ...r.daily, days: { ...r.daily.days, [date]: { games: [], puzzles: [id], activities: [`puzzle:${id}`] } } } }
}

const game = (id, extra = {}) => ({ id, source: 'lichess', externalId: id, endTime: 1, pgn: '1. e4 *', playerColor: 'w', ...extra })

let env, session, api, A, B
const sync = (dev) => switchTo(dev).then(() => syncOnce({ userId: session.me.user.id, csrf: session.me.csrf, api }))

beforeEach(async () => {
  _resetMemoryLimits()
  env = makeEnv()
  session = await loginTest(env)
  await sendWebhook(env, subscriptionEvent('subscription.active', session.me.user.id))
  api = apiFor(env, session)
  A = device()
  B = device()
})
afterEach(async () => { await _resetDbForTests() })

describe('sincronización entre dos dispositivos', () => {
  it('subida inicial con datos de antes de la cuenta y bajada en otro dispositivo', async () => {
    // A: datos antiguos escritos SIN registro de cambios (como los de la v2) + uno nuevo.
    await switchTo(A)
    const db = await (await import('../storage/db.js')).openDb()
    await new Promise((resolve) => {
      const t = db.transaction(['games', 'analysis'], 'readwrite')
      t.objectStore('games').put(game('lichess:old'))
      t.objectStore('analysis').put({ gameId: 'lichess:old', scores: [1, 2] })
      t.oncomplete = resolve
    })
    await put(STORES.games, game('lichess:new'))
    await setMeta('rewards:xp', 120)
    await setMeta('puzzleGenerator', { status: 'running' })
    A.storage.setItem('escaque:board', 'verde')
    A.storage.setItem('escaque:ia', '{"apiKey":"secreta"}')
    const first = await syncOnce({ userId: session.me.user.id, csrf: session.me.csrf, api })
    expect(first.pushed).toBe(5) // 2 partidas + análisis + rewards + tema del tablero
    expect((await get(STORES.changes, changeId('games', 'lichess:old'))).dirty).toBe(0)
    // Cursor adelantado: no se vuelve a bajar lo propio.
    expect((await getMeta(SYNC_STATE_KEY)).cursor).toBe(5)

    await sync(B)
    expect(await get(STORES.games, 'lichess:old')).toEqual(game('lichess:old'))
    expect(await get(STORES.analysis, 'lichess:old')).toEqual({ gameId: 'lichess:old', scores: [1, 2] })
    expect(await getMeta('rewards:xp')).toBe(120)
    expect(await getMeta('puzzleGenerator')).toBeUndefined()
    expect(B.storage.getItem('escaque:board')).toBe('verde')
    expect(B.storage.getItem('escaque:ia')).toBeNull()
    // Lo recibido no queda pendiente de subir.
    expect((await get(STORES.changes, changeId('games', 'lichess:new'))).dirty).toBe(0)
  })

  it('borrados y altas viajan en ambos sentidos', async () => {
    await switchTo(A)
    await put(STORES.games, game('g1'))
    await put(STORES.games, game('g2'))
    await sync(A)
    await sync(B)
    await remove(STORES.games, 'g1')
    await put(STORES.puzzles, { id: 'p1', gameId: 'g2' })
    await sync(B)
    await sync(A)
    expect(await get(STORES.games, 'g1')).toBeUndefined()
    expect(await get(STORES.puzzles, 'p1')).toEqual({ id: 'p1', gameId: 'g2' })
    expect(await get(STORES.games, 'g2')).toBeDefined()
  })

  it('conflicto: gana la escritura más reciente', async () => {
    await switchTo(A)
    await put(STORES.games, game('g', { note: 'base' }))
    await sync(A)
    await sync(B)
    await switchTo(A)
    await put(STORES.games, game('g', { note: 'A' }))
    await new Promise((r) => setTimeout(r, 5))
    await switchTo(B)
    await put(STORES.games, game('g', { note: 'B (más tarde)' }))
    await sync(B)
    await sync(A) // A sube una versión más vieja: el servidor la rechaza y A recibe la de B
    expect((await get(STORES.games, 'g')).note).toBe('B (más tarde)')
    await sync(B)
    expect((await get(STORES.games, 'g')).note).toBe('B (más tarde)')
  })

  it('preferencias: el valor que el otro dispositivo ya tenía antes de la cuenta no pisa al del servidor', async () => {
    A.storage.setItem('escaque:board', 'verde')
    await sync(A)
    B.storage.setItem('escaque:board', 'madera')
    await sync(B)
    expect(B.storage.getItem('escaque:board')).toBe('verde')
    B.storage.setItem('escaque:board', 'azul')
    await sync(B)
    await sync(A)
    expect(A.storage.getItem('escaque:board')).toBe('azul')
  })

  it('al cambiar de cuenta en el mismo navegador, los datos locales se suben a la nueva', async () => {
    await switchTo(A)
    await put(STORES.games, game('g1'))
    await sync(A)
    const other = await loginTest(env, 'bob')
    await sendWebhook(env, subscriptionEvent('subscription.active', other.me.user.id, { id: 'sub_bob' }))
    await syncOnce({ userId: other.me.user.id, csrf: other.me.csrf, api: apiFor(env, other) })
    const page = await (await call(env, other.jar, '/api/sync/pull?cursor=0')).json()
    expect(page.items.map((i) => i.key)).toEqual(['g1'])
  })

  it('sin Premium la API responde 402 y el estado pasa a «off»', async () => {
    const free = await loginTest(env, 'carol')
    await switchTo(A)
    await put(STORES.games, game('g1'))
    const err = await syncOnce({ userId: free.me.user.id, csrf: free.me.csrf, api: apiFor(env, free) }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(statusForError(err)).toEqual({ state: 'off' })
    expect(statusForError(new ApiError(429, 'quota_daily', { retryAfter: 60 }))).toMatchObject({ state: 'quota', retryAfter: 60 })
    expect(statusForError(new ApiError(0, 'network'))).toEqual({ state: 'offline' })
  })

  it('la subida va por lotes (más registros que un lote)', async () => {
    await switchTo(A)
    for (let i = 0; i < 170; i++) await put(STORES.puzzles, { id: `p${i}`, gameId: 'g' })
    const res = await syncOnce({ userId: session.me.user.id, csrf: session.me.csrf, api })
    expect(res.pushed).toBe(170)
    await sync(B)
    expect(await get(STORES.puzzles, 'p169')).toEqual({ id: 'p169', gameId: 'g' })
  })
  it('recompensas: se fusionan en vez de pisarse (un navegador nuevo no borra lo del otro)', async () => {
    const award = (amount, awardedAt) => ({ amount, kind: 'k', id: 'x', awardedAt })
    const rewards = (awards, days, unlocked, extra = {}) => ({
      xp: { xp: Object.values(awards).reduce((n, a) => n + a.amount, 0), awards },
      daily: { goal: { games: 1, puzzles: 3 }, days },
      achievements: { unlocked, counters: { puzzleStreak: 0, corrections: 0 }, seen: {}, correctedPositions: {}, hydrated: true },
      ...extra,
    })
    const day = (id) => ({ games: [], puzzles: [id], activities: [`puzzle:${id}`] })
    // A juega (y sube); después B, recién instalado, guarda su estado vacío (más reciente).
    await switchTo(A)
    await setMeta('rewards', rewards({ 'puzzle:a:solve': award(10, 1) }, { '2026-11-01': day('a') }, { firstGame: { unlockedAt: 1 } }))
    await sync(A)
    await switchTo(B)
    await setMeta('rewards', rewards({}, {}, {}))
    await sync(B)
    expect((await getMeta('rewards')).xp.xp).toBe(10)
    // B consigue algo propio; A, sin volver a bajar, también. Tras sincronizar ambos, los dos lo tienen todo.
    await setMeta('rewards', mergeRewardsForTest(await getMeta('rewards'), { 'puzzle:b:solve': award(10, 2) }, '2026-11-02', 'b'))
    await switchTo(A)
    await setMeta('rewards', mergeRewardsForTest(await getMeta('rewards'), { 'review:2026-11-03': award(20, 3) }, '2026-11-03', 'r'))
    await sync(B)
    await sync(A)
    await sync(B)
    for (const dev of [A, B]) {
      await switchTo(dev)
      const r = await getMeta('rewards')
      expect(r.xp.xp).toBe(40)
      expect(Object.keys(r.daily.days).sort()).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
      expect(r.achievements.unlocked.firstGame).toEqual({ unlockedAt: 1 })
      expect((await get(STORES.changes, changeId('meta', 'rewards'))).dirty).toBe(0)
    }
    // Estable: otra vuelta no sube ni baja nada.
    const again = await sync(A).then(() => syncOnce({ userId: session.me.user.id, csrf: session.me.csrf, api }))
    expect(again).toEqual({ pulled: 0, pushed: 0 })
  })
})
