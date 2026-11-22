import { beforeEach, describe, expect, it } from 'vitest';
import worker from './index.js';
import { BASE, makeEnv } from './test/helpers.js';
import { _resetMemoryLimits } from './lib/ratelimit.js';
import { utcDay } from './events.js';

beforeEach(() => _resetMemoryLimits());

const post = (env, body, headers = {}) =>
  worker.fetch(new Request(`${BASE}/api/e`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env);

const rows = (env) => env.DB.prepare('SELECT day, event, lang, count FROM events_daily ORDER BY event, lang').all().then((r) => r.results);

describe('/api/e (contadores del embudo)', () => {
  it('cuenta por día, evento e idioma; 204 sin cuerpo; no guarda la IP', async () => {
    const env = makeEnv();
    expect((await post(env, { e: 'report_done', l: 'es' })).status).toBe(204);
    await post(env, { e: 'report_done', l: 'es' });
    await post(env, { e: 'report_done', l: 'fr' });
    const r = await rows(env);
    expect(r).toEqual([
      { day: utcDay(), event: 'report_done', lang: 'es', count: 2 },
      { day: utcDay(), event: 'report_done', lang: 'xx', count: 1 },
    ]);
    expect(JSON.stringify(r)).not.toContain('1.2.3.4');
  });

  it('rechaza eventos desconocidos, métodos y cuerpos inválidos', async () => {
    const env = makeEnv();
    expect((await post(env, { e: 'email', l: 'es' })).status).toBe(400);
    expect((await post(env, 'x'.repeat(400))).status).toBe(413);
    expect((await post(env, '{')).status).toBe(400);
    expect((await worker.fetch(new Request(`${BASE}/api/e`), env)).status).toBe(405);
    expect(await rows(env)).toEqual([]);
  });

  it('limita el abuso por IP (en memoria) sin devolver error al cliente', async () => {
    const env = makeEnv();
    for (let i = 0; i < 130; i++) await post(env, { e: 'game_end', l: 'en' });
    const [row] = await rows(env);
    expect(row.count).toBe(120);
  });

  it('sin D1 responde 204 y no falla', async () => {
    const env = makeEnv({ DB: undefined });
    expect((await post(env, { e: 'game_end', l: 'en' })).status).toBe(204);
  });
});
