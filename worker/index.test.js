import { describe, expect, it, vi } from 'vitest'
import worker from './index.js'
import pkg from '../package.json'

const VERSION = pkg.version

const BASE = 'http://localhost:8787'

function expectIsolation(res) {
  expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
  expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
}

describe('worker', () => {
  const env = { ASSETS: { fetch: vi.fn(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })) } }

  it('GET /api/health responde { ok: true, version } con COOP/COEP', async () => {
    const res = await worker.fetch(new Request(`${BASE}/api/health`), env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/)
    expect(await res.json()).toEqual({ ok: true, version: VERSION })
    expectIsolation(res)
  })

  it('POST /api/health devuelve 405 JSON', async () => {
    const res = await worker.fetch(new Request(`${BASE}/api/health`, { method: 'POST' }), env)
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, HEAD')
    expect(await res.json()).toEqual({ ok: false, error: { kind: 'method_not_allowed' } })
  })

  it('otras rutas /api/* devuelven 404 JSON con COOP/COEP (ya no existe /api/coach)', async () => {
    for (const path of ['/api', '/api/', '/api/nada', '/api/coach', '/api/coach/x']) {
      const res = await worker.fetch(new Request(`${BASE}${path}`), env)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ ok: false, error: { kind: 'not_found' } })
      expectIsolation(res)
    }
  })

  it('fuera de /api delega en ASSETS y añade COOP/COEP', async () => {
    const res = await worker.fetch(new Request(`${BASE}/apix`), env)
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce()
    expect(await res.text()).toBe('<html></html>')
    expectIsolation(res)
  })
})
