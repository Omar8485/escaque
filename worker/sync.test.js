import { beforeEach, describe, expect, it } from 'vitest';
import { call, loginTest, makeEnv, postJson, sendWebhook, subscriptionEvent } from './test/helpers.js';
import { _resetMemoryLimits } from './lib/ratelimit.js';
import { SYNC_DEFAULTS } from './config.js';
import { validateItem } from './sync/routes.js';

beforeEach(() => _resetMemoryLimits());

async function premiumUser(env, hint = 'alice') {
  const session = await loginTest(env, hint);
  await sendWebhook(env, subscriptionEvent('subscription.active', session.me.user.id, { id: `sub_${hint}` }));
  return session;
}

const push = (env, s, items) => postJson(env, s.jar, '/api/sync/push', { items }, s.me.csrf);
const pull = async (env, s, cursor = 0, limit) => (await call(env, s.jar, `/api/sync/pull?cursor=${cursor}${limit ? `&limit=${limit}` : ''}`)).json();
const game = (id, updatedAt, extra = {}) => ({ store: 'games', key: id, updatedAt, data: { id, pgn: '1. e4 e5', ...extra } });

describe('sincronización', () => {
  it('solo Premium: 401 sin sesión y 402 sin plan', async () => {
    const env = makeEnv();
    expect((await call(env, null, '/api/sync/pull')).status).toBe(401);
    const s = await loginTest(env);
    expect((await call(env, s.jar, '/api/sync/pull')).status).toBe(402);
    expect((await push(env, s, [game('g1', 1)])).status).toBe(402);
  });

  it('subir y bajar: orden por seq, cursor y datos intactos', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    const res = await push(env, s, [game('g1', 100), game('g2', 100), { store: 'meta', key: 'rewards:xp', updatedAt: 100, data: { key: 'rewards:xp', value: 42 } }]);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, applied: 3, fromSeq: 1, toSeq: 3 });
    const page = await pull(env, s);
    expect(page).toMatchObject({ ok: true, cursor: 3, latest: 3, more: false });
    expect(page.items.map((i) => i.key)).toEqual(['g1', 'g2', 'rewards:xp']);
    expect(page.items[2]).toEqual({ store: 'meta', key: 'rewards:xp', updatedAt: 100, deleted: false, data: { key: 'rewards:xp', value: 42 } });
    expect((await pull(env, s, 3)).items).toEqual([]);
  });

  it('última escritura gana; lo más viejo vuelve como «stale»', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    await push(env, s, [game('g1', 200, { v: 'nuevo' })]);
    const res = await (await push(env, s, [game('g1', 150, { v: 'viejo' })])).json();
    expect(res).toMatchObject({ applied: 0, stale: [{ store: 'games', key: 'g1', updatedAt: 200, seq: 1 }] });
    await push(env, s, [game('g1', 300, { v: 'otro' })]);
    const page = await pull(env, s);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ updatedAt: 300, data: { v: 'otro' } });
  });

  it('borrados como lápidas: llegan a los otros dispositivos y liberan espacio', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    await push(env, s, [game('g1', 100)]);
    const before = await (await call(env, s.jar, '/api/sync/status')).json();
    expect(before.usage.items).toBe(1);
    expect(before.usage.bytes).toBeGreaterThan(10);
    await push(env, s, [{ store: 'games', key: 'g1', updatedAt: 200, deleted: true }]);
    const page = await pull(env, s);
    expect(page.items).toEqual([{ store: 'games', key: 'g1', updatedAt: 200, deleted: true, data: null }]);
    const after = await (await call(env, s.jar, '/api/sync/status')).json();
    expect(after.usage).toMatchObject({ items: 0, bytes: 0 });
  });

  it('los datos de cada usuario están aislados', async () => {
    const env = makeEnv();
    const a = await premiumUser(env, 'alice');
    const b = await premiumUser(env, 'bob');
    await push(env, a, [game('g1', 100)]);
    expect((await pull(env, b)).items).toEqual([]);
  });

  it('paginación por número y por tamaño', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    const big = 'x'.repeat(100 * 1024);
    const items = Array.from({ length: 10 }, (_, i) => game(`g${i}`, 100 + i, { blob: big }));
    expect((await push(env, s, items.slice(0, 4))).status).toBe(200);
    expect((await push(env, s, items.slice(4, 8))).status).toBe(200);
    expect((await push(env, s, items.slice(8))).status).toBe(200);
    const first = await pull(env, s);
    expect(first.more).toBe(true);
    expect(first.items.length).toBeLessThan(10);
    const second = await pull(env, s, first.cursor, 2);
    expect(second.items).toHaveLength(2);
    expect(second.items[0].key).toBe(`g${first.items.length}`);
  });

  it('límites por petición: número de registros, tamaño del cuerpo y de cada registro', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    const many = Array.from({ length: SYNC_DEFAULTS.maxItemsPerPush + 1 }, (_, i) => game(`g${i}`, 1));
    expect((await push(env, s, many)).status).toBe(413);
    const huge = (await push(env, s, [game('g1', 1, { blob: 'x'.repeat(SYNC_DEFAULTS.maxPushBytes) })]));
    expect(huge.status).toBe(413);
    const tooBig = await (await push(env, s, [game('g1', 1, { blob: 'x'.repeat(SYNC_DEFAULTS.maxItemBytes) }), game('g2', 1)])).json();
    expect(tooBig).toMatchObject({ applied: 1, rejected: [{ key: 'g1', reason: 'item_too_large' }] });
  });

  it('cupo diario de escrituras por usuario (429 hasta medianoche UTC)', async () => {
    const env = makeEnv({ SYNC_MAX_DAILY_WRITES: '3' });
    const s = await premiumUser(env);
    expect((await push(env, s, [game('a', 1), game('b', 1)])).status).toBe(200);
    const res = await push(env, s, [game('c', 1), game('d', 1)]);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await res.json()).error.kind).toBe('quota_daily');
  });

  it('cupo de almacenamiento por usuario', async () => {
    const env = makeEnv({ SYNC_MAX_USER_BYTES: '500' });
    const s = await premiumUser(env);
    expect((await push(env, s, [game('a', 1, { blob: 'x'.repeat(300) })])).status).toBe(200);
    const res = await push(env, s, [game('b', 1, { blob: 'x'.repeat(300) })]);
    expect(res.status).toBe(413);
    expect((await res.json()).error.kind).toBe('quota_storage');
    // Reemplazar por algo más pequeño sí cabe.
    expect((await push(env, s, [game('a', 2, { blob: 'y' })])).status).toBe(200);
  });

  it('validación de registros', () => {
    const lim = SYNC_DEFAULTS;
    const now = 1_000_000;
    expect(validateItem({ store: 'otro', key: 'a', updatedAt: 1, data: 1 }, lim, now).error).toBe('store');
    expect(validateItem({ store: 'games', key: '', updatedAt: 1, data: 1 }, lim, now).error).toBe('key');
    expect(validateItem({ store: 'games', key: 'a', updatedAt: now + 2 * 86_400_000, data: 1 }, lim, now).error).toBe('updatedAt');
    expect(validateItem({ store: 'games', key: 'a', updatedAt: 1.5, data: 1 }, lim, now).error).toBe('updatedAt');
    expect(validateItem({ store: 'games', key: 'a', updatedAt: 1 }, lim, now).error).toBe('data');
    expect(validateItem({ store: 'games', key: 'a', updatedAt: 1, deleted: true }, lim, now)).toMatchObject({ deleted: true, data: null, size: 0 });
  });

  it('DELETE /api/sync borra la copia del servidor (con CSRF)', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    await push(env, s, [game('g1', 1)]);
    expect((await postJson(env, s.jar, '/api/sync', undefined, 'x', 'DELETE')).status).toBe(403);
    expect((await postJson(env, s.jar, '/api/sync', undefined, s.me.csrf, 'DELETE')).status).toBe(200);
    expect((await pull(env, s)).items).toEqual([]);
  });

  it('una subida cuesta un solo batch de D1 (cuenta como una consulta del plan gratuito)', async () => {
    const env = makeEnv();
    const s = await premiumUser(env);
    const before = env.DB.batches;
    await push(env, s, Array.from({ length: 50 }, (_, i) => game(`g${i}`, 1)));
    // 1 batch de lectura (estado + existentes) + 1 batch de escritura.
    expect(env.DB.batches - before).toBe(2);
  });
});
