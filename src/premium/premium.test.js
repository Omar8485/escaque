import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_LIMITS, OFFLINE_PLAN_GRACE_MS } from './limits.js'
import {
  cachedPremiumValid, effectiveBoardTheme, generatorLimit, importMax, isCardAvailable, isPeriodAllowed, nextBoardTheme, planActions, progressPeriod,
} from './gate.js'
import { ACCOUNT_CACHE_KEY, _resetAccountStore, getAccountState, isPremium, refreshAccount, resetAccount } from './planStore.js'

const DAY = 86_400_000

describe('límites del plan gratuito', () => {
  it('importar y generar puzles: últimas 50 partidas en gratis; sin tope en Premium', () => {
    expect(FREE_LIMITS.recentGames).toBe(50)
    expect(importMax(200, false)).toBe(50)
    expect(importMax(10, false)).toBe(10)
    expect(importMax(null, false)).toBe(50)
    expect(importMax(null, true)).toBeNull()
    expect(importMax(500, true)).toBe(500)
    expect(generatorLimit(0, false)).toBe(50)
    expect(generatorLimit(100, false)).toBe(50)
    expect(generatorLimit(0, true)).toBe(0)
  })

  it('Progreso: 30 días, tarjetas básicas y 1 acción del plan en gratis', () => {
    expect(progressPeriod('all', false)).toBe('30')
    expect(progressPeriod('90', true)).toBe('90')
    expect(isPeriodAllowed('90', false)).toBe(false)
    expect(isCardAvailable('accuracy', false)).toBe(true)
    expect(isCardAvailable('openings', false)).toBe(false)
    expect(isCardAvailable('openings', true)).toBe(true)
    expect(planActions([1, 2, 3], false)).toEqual({ visible: [1], hidden: 2 })
    expect(planActions([1, 2, 3], true)).toEqual({ visible: [1, 2, 3], hidden: 0 })
  })

  it('temas de tablero: los extra solo en Premium', () => {
    expect(nextBoardTheme('madera', false)).toBe('verde')
    expect(nextBoardTheme('verde', false)).toBe('madera')
    expect(nextBoardTheme('verde', true)).toBe('azul')
    expect(nextBoardTheme('arena', true)).toBe('madera')
    expect(effectiveBoardTheme('azul', false)).toBe('madera')
    expect(effectiveBoardTheme('azul', true)).toBe('azul')
    expect(effectiveBoardTheme('raro', true)).toBe('madera')
  })

  it('plan guardado sin red: vale 7 días desde la última consulta y nunca tras el fin del período', () => {
    const now = 1_800_000_000_000
    const sub = (periodEnd, checkedAt = now - DAY) => ({ plan: { premium: true, periodEnd }, checkedAt })
    expect(cachedPremiumValid(sub(now + 10 * DAY), now)).toBe(true)
    expect(cachedPremiumValid(sub(now + 10 * DAY, now - OFFLINE_PLAN_GRACE_MS - 1), now)).toBe(false)
    expect(cachedPremiumValid(sub(now - 3 * DAY), now)).toBe(false)
    expect(cachedPremiumValid({ plan: { premium: true, lifetime: true }, checkedAt: now - 2 * DAY }, now)).toBe(true)
    expect(cachedPremiumValid({ plan: { premium: false }, checkedAt: now }, now)).toBe(false)
    expect(cachedPremiumValid(null, now)).toBe(false)
    expect(cachedPremiumValid({ plan: { premium: true, lifetime: true }, checkedAt: now + DAY }, now)).toBe(false)
  })
})

describe('estado de la cuenta', () => {
  const store = new Map()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) })
    _resetAccountStore()
  })
  afterEach(() => vi.unstubAllGlobals())

  const jsonFetch = (body, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

  it('sin servidor de cuentas (p. ej. vite preview): disponible = false y plan gratis', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))
    await refreshAccount({ fetchImpl })
    expect(getAccountState()).toMatchObject({ available: false, status: 'anonymous', user: null })
    expect(isPremium()).toBe(false)
  })

  it('con sesión Premium: guarda el plan para funcionar sin red, sin el token CSRF', async () => {
    const plan = { premium: true, plan: 'yearly', lifetime: false, periodEnd: Date.now() + 100 * DAY }
    await refreshAccount({ fetchImpl: jsonFetch({ ok: true, accounts: true, providers: ['google'], billing: true, user: { id: 'u1', email: 'a@b.c' }, plan, csrf: 'tok', checkedAt: Date.now() }) })
    expect(isPremium()).toBe(true)
    expect(getAccountState().csrf).toBe('tok')
    const cached = JSON.parse(store.get(ACCOUNT_CACHE_KEY))
    expect(cached).toMatchObject({ user: { id: 'u1' }, plan: { premium: true } })
    expect(JSON.stringify(cached)).not.toContain('tok')

    // Sin red: se mantiene el Premium guardado.
    await refreshAccount({ fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })
    expect(getAccountState()).toMatchObject({ offline: true, status: 'signedIn' })
    expect(isPremium()).toBe(true)

    // Al recargar la página (estado inicial desde la caché) también.
    _resetAccountStore()
    expect(isPremium()).toBe(true)

    resetAccount()
    expect(isPremium()).toBe(false)
    expect(store.has(ACCOUNT_CACHE_KEY)).toBe(false)
  })

  it('plan guardado caducado → gratis al cargar', () => {
    store.set(ACCOUNT_CACHE_KEY, JSON.stringify({ user: { id: 'u1' }, plan: { premium: true, periodEnd: Date.now() - 5 * DAY }, checkedAt: Date.now() - DAY }))
    _resetAccountStore()
    expect(isPremium()).toBe(false)
    expect(getAccountState().user).toEqual({ id: 'u1' })
  })
})
