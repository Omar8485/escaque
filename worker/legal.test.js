// Consentimiento explícito al crear la cuenta (términos 1.0), migración 0002, cupos de «Fundador»
// (FOUNDER_LIMIT), borrado de la cuenta y plazos de conservación que promete la política de privacidad.
import { beforeEach, describe, expect, it } from 'vitest';
import { Jar, call, loginTest, makeEnv, orderEvent, postJson, sendWebhook, subscriptionEvent } from './test/helpers.js';
import { _resetMemoryLimits } from './lib/ratelimit.js';
import { _clearProductsCache } from './billing/routes.js';
import { DEFAULT_FOUNDER_LIMIT, founderLimit } from './config.js';
import { TERMS_VERSION } from '../shared/legal.js';

beforeEach(() => { _resetMemoryLimits(); _clearProductsCache(); });

const DAY = 86_400_000;
const count = async (env, table, where = '1 = 1', ...params) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...params).first()).n;
const me = async (env, jar) => (await call(env, jar, '/api/me')).json();
const mockEnv = (extra = {}) => makeEnv({
  POLAR_SERVER: 'mock', POLAR_PRODUCT_MONTHLY: 'mock-monthly', POLAR_PRODUCT_YEARLY: 'mock-yearly', POLAR_PRODUCT_FOUNDER: 'mock-founder', ...extra,
});

/** Recorre el login simulado hasta el callback y devuelve la URL a la que vuelve la app. */
async function loginLocation(env, hint, query = '') {
  const jar = new Jar();
  const start = await call(env, jar, `/api/auth/login/test?hint=${hint}${query}`);
  const authorize = new URL(start.headers.get('Location'));
  const granted = await call(env, jar, `${authorize.pathname}${authorize.search}`);
  const cb = new URL(granted.headers.get('Location'));
  const done = await call(env, jar, `${cb.pathname}${cb.search}`);
  return { jar, location: done.headers.get('Location') };
}

describe('migración 0002', () => {
  it('añade terms_version y consent_at a users y los índices de cupos y limpieza', async () => {
    const env = makeEnv();
    const cols = (await env.DB.prepare("SELECT name FROM pragma_table_info('users')").all()).results.map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['terms_version', 'consent_at']));
    const idx = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()).results.map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(['entitlements_kind_status', 'sessions_expires']));
  });
});

describe('consentimiento obligatorio', () => {
  it('sin consentimiento NO se crea el usuario ni la sesión', async () => {
    const env = makeEnv();
    const { jar, location } = await loginLocation(env, 'nadie');
    expect(location).toContain('account=error%3Aconsent_required');
    expect(await count(env, 'users')).toBe(0);
    expect(await count(env, 'sessions')).toBe(0);
    expect((await me(env, jar)).user).toBeNull();
  });

  it('una versión antigua o inventada cuenta como sin consentimiento', async () => {
    const env = makeEnv();
    for (const v of ['0.9', '9.9', '', 'true']) {
      const { location } = await loginLocation(env, 'nadie', `&consent=${encodeURIComponent(v)}`);
      expect(location, v).toContain('consent_required');
    }
    expect(await count(env, 'users')).toBe(0);
  });

  it('con la versión vigente crea el usuario y registra versión y fecha', async () => {
    const env = makeEnv();
    const before = Date.now();
    const { me: body } = await loginTest(env, 'ana');
    const row = await env.DB.prepare('SELECT terms_version, consent_at FROM users').first();
    expect(row.terms_version).toBe(TERMS_VERSION);
    expect(row.consent_at).toBeGreaterThanOrEqual(before);
    expect(body.consent).toEqual({ version: TERMS_VERSION, accepted: TERMS_VERSION, acceptedAt: row.consent_at, required: false });
  });

  it('la versión no se puede añadir a mitad del flujo: solo cuenta la de la cookie firmada', async () => {
    const env = makeEnv();
    const jar = new Jar();
    const start = await call(env, jar, '/api/auth/login/test?hint=eva');
    const authorize = new URL(start.headers.get('Location'));
    const granted = await call(env, jar, `${authorize.pathname}${authorize.search}`);
    const cb = new URL(granted.headers.get('Location'));
    cb.searchParams.set('consent', TERMS_VERSION);
    const done = await call(env, jar, `${cb.pathname}${cb.search}`);
    expect(done.headers.get('Location')).toContain('consent_required');
    expect(await count(env, 'users')).toBe(0);
  });

  it('usuario existente con versión vieja: entra, pero se le pide aceptar; sin aceptar no sincroniza ni compra', async () => {
    const env = mockEnv();
    const s = await loginTest(env, 'bea');
    await sendWebhook(env, subscriptionEvent('subscription.active', s.me.user.id, { product: 'mock-monthly' }));
    await env.DB.prepare("UPDATE users SET terms_version = '0.9'").run();

    // Vuelve a entrar SIN marcar la casilla (p. ej. una versión vieja de la app): entra igual.
    const again = await loginTest(env, 'bea', { consent: null });
    expect(again.me.user.id).toBe(s.me.user.id);
    expect(again.me.consent).toMatchObject({ version: TERMS_VERSION, accepted: '0.9', required: true });
    const csrf = again.me.csrf;
    expect((await call(env, again.jar, '/api/sync/pull')).status).toBe(403);
    const push = await postJson(env, again.jar, '/api/sync/push', { items: [] }, csrf);
    expect(push.status).toBe(403);
    expect((await push.json()).error.kind).toBe('consent_required');
    const buy = await postJson(env, again.jar, '/api/billing/checkout', { plan: 'founder' }, csrf);
    expect((await buy.json()).error.kind).toBe('consent_required');
    // Lo que no exige aceptar: gestionar (cancelar) la suscripción y borrar los datos del servidor.
    expect((await call(env, again.jar, '/api/billing/portal')).status).toBe(200);
    expect((await postJson(env, again.jar, '/api/sync', undefined, csrf, 'DELETE')).status).toBe(200);

    // Aceptar: versión equivocada → 400; vigente → registrada y la sincronización vuelve.
    const wrong = await postJson(env, again.jar, '/api/me/consent', { version: '0.9' }, csrf);
    expect(wrong.status).toBe(400);
    expect(await postJson(env, again.jar, '/api/me/consent', { version: TERMS_VERSION }, '')).toHaveProperty('status', 403);
    const ok = await postJson(env, again.jar, '/api/me/consent', { version: TERMS_VERSION }, csrf);
    expect(ok.status).toBe(200);
    expect((await me(env, again.jar)).consent.required).toBe(false);
    expect((await call(env, again.jar, '/api/sync/pull')).status).toBe(200);
  });

  it('usuario existente sin consentimiento (cuenta anterior a 0002) que entra marcando la casilla: queda registrado', async () => {
    const env = makeEnv();
    await loginTest(env, 'carla');
    await env.DB.prepare('UPDATE users SET terms_version = NULL, consent_at = NULL').run();
    const { me: body } = await loginTest(env, 'carla');
    expect(body.consent.required).toBe(false);
    expect((await env.DB.prepare('SELECT terms_version FROM users').first()).terms_version).toBe(TERMS_VERSION);
  });

  it('POST /api/me/consent exige sesión', async () => {
    const env = makeEnv();
    expect((await postJson(env, new Jar(), '/api/me/consent', { version: TERMS_VERSION }, 'x')).status).toBe(401);
  });
});

describe('cupos de Fundador (FOUNDER_LIMIT)', () => {
  it('por defecto 500; acepta 0 y enteros; valores raros vuelven al defecto', () => {
    expect(DEFAULT_FOUNDER_LIMIT).toBe(500);
    expect(founderLimit({})).toBe(500);
    expect(founderLimit({ FOUNDER_LIMIT: '3' })).toBe(3);
    expect(founderLimit({ FOUNDER_LIMIT: '0' })).toBe(0);
    for (const v of ['-1', '2.5', 'muchos']) expect(founderLimit({ FOUNDER_LIMIT: v }), v).toBe(500);
  });

  it('GET /api/billing/products devuelve las plazas restantes reales y bloquea la compra al agotarse', async () => {
    const env = mockEnv({ FOUNDER_LIMIT: '2' });
    const products = async () => (await call(env, null, '/api/billing/products')).json();
    expect((await products()).founder).toEqual({ limit: 2, remaining: 2, soldOut: false });

    const a = await loginTest(env, 'a');
    const b = await loginTest(env, 'b');
    const c = await loginTest(env, 'c');
    const buy = (s) => postJson(env, s.jar, '/api/billing/checkout', { plan: 'founder' }, s.me.csrf);
    expect((await buy(a)).status).toBe(200);
    await sendWebhook(env, orderEvent('order.paid', a.me.user.id, { product: 'mock-founder', id: 'ord_a' }));
    expect((await products()).founder).toEqual({ limit: 2, remaining: 1, soldOut: false });
    // Las suscripciones no ocupan plazas de Fundador.
    await sendWebhook(env, subscriptionEvent('subscription.active', c.me.user.id, { product: 'mock-monthly', id: 'sub_c' }));
    expect((await products()).founder.remaining).toBe(1);

    await sendWebhook(env, orderEvent('order.paid', b.me.user.id, { product: 'mock-founder', id: 'ord_b' }));
    expect((await products()).founder).toEqual({ limit: 2, remaining: 0, soldOut: true });
    const blocked = await buy(c);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.kind).toBe('founder_sold_out');
    // Las suscripciones siguen a la venta.
    expect((await postJson(env, c.jar, '/api/billing/checkout', { plan: 'monthly' }, c.me.csrf)).status).toBe(409); // ya suscrito
    const d = await loginTest(env, 'd');
    expect((await postJson(env, d.jar, '/api/billing/checkout', { plan: 'yearly' }, d.me.csrf)).status).toBe(200);

    // Un reembolso libera la plaza.
    await sendWebhook(env, orderEvent('order.refunded', b.me.user.id, { product: 'mock-founder', id: 'ord_b', status: 'refunded', modifiedAt: new Date(Date.now() + 1000).toISOString() }));
    expect((await products()).founder).toEqual({ limit: 2, remaining: 1, soldOut: false });
    expect((await buy(c)).status).toBe(200);
  });

  it('FOUNDER_LIMIT=0: agotado desde el principio; sin producto Fundador no hay cupos', async () => {
    const env = mockEnv({ FOUNDER_LIMIT: '0' });
    expect((await (await call(env, null, '/api/billing/products')).json()).founder).toEqual({ limit: 0, remaining: 0, soldOut: true });
    const s = await loginTest(env);
    expect((await postJson(env, s.jar, '/api/billing/checkout', { plan: 'founder' }, s.me.csrf)).status).toBe(409);
    _clearProductsCache();
    const noFounder = mockEnv({ POLAR_PRODUCT_FOUNDER: '' });
    expect((await (await call(noFounder, null, '/api/billing/products')).json()).founder).toBeNull();
  });
});

describe('borrado de la cuenta y conservación', () => {
  it('DELETE /api/me borra en cascada usuario, sesiones, plan y datos sincronizados (aunque falte aceptar)', async () => {
    const env = mockEnv();
    const s = await loginTest(env, 'zoe');
    const other = await loginTest(env, 'otro');
    for (const u of [s, other]) {
      await sendWebhook(env, subscriptionEvent('subscription.active', u.me.user.id, { product: 'mock-monthly', id: `sub_${u.me.user.id}` }));
      const res = await postJson(env, u.jar, '/api/sync/push', { items: [{ store: 'games', key: 'g1', updatedAt: 10, data: { id: 'g1' } }] }, u.me.csrf);
      expect(res.status).toBe(200);
    }
    await loginTest(env, 'zoe'); // segunda sesión del mismo usuario
    await env.DB.prepare("UPDATE users SET terms_version = '0.9' WHERE id = ?").bind(s.me.user.id).run();
    const id = s.me.user.id;
    for (const t of ['sessions', 'entitlements', 'sync_items', 'sync_state']) expect(await count(env, t, 'user_id = ?', id), t).toBeGreaterThan(0);

    expect((await postJson(env, s.jar, '/api/me', undefined, '', 'DELETE')).status).toBe(403); // CSRF
    const res = await postJson(env, s.jar, '/api/me', undefined, s.me.csrf, 'DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(await count(env, 'users', 'id = ?', id)).toBe(0);
    for (const t of ['sessions', 'entitlements', 'sync_items', 'sync_state']) expect(await count(env, t, 'user_id = ?', id), t).toBe(0);
    // Los demás usuarios no se tocan.
    expect(await count(env, 'sync_items', 'user_id = ?', other.me.user.id)).toBe(1);
    expect((await me(env, s.jar)).user).toBeNull();
    // Volver a entrar con la misma identidad es una cuenta nueva (sin plan) y exige consentimiento otra vez.
    expect((await loginLocation(env, 'zoe')).location).toContain('consent_required');
  });

  it('al iniciar sesión se borran las sesiones caducadas (de todos) y los avisos de Polar de más de 30 días', async () => {
    const env = makeEnv();
    const old = await loginTest(env, 'vieja');
    await env.DB.prepare('UPDATE sessions SET expires_at = ?').bind(Date.now() - 1000).run();
    await env.DB.prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?), (?, ?, ?)')
      .bind('w_old', 'order.paid', Date.now() - 31 * DAY, 'w_new', 'order.paid', Date.now() - 29 * DAY).run();
    expect(await count(env, 'sessions')).toBe(1);
    await loginTest(env, 'nueva');
    expect(await count(env, 'sessions', 'user_id = ?', old.me.user.id)).toBe(0);
    expect(await count(env, 'sessions')).toBe(1);
    const ids = (await env.DB.prepare('SELECT id FROM webhook_events').all()).results.map((r) => r.id);
    expect(ids).toEqual(['w_new']);
  });
});
