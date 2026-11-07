import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { BASE, WEBHOOK_SECRET, call, loginTest, makeEnv, orderEvent, postJson, sendWebhook, subscriptionEvent } from './test/helpers.js';
import { _resetMemoryLimits } from './lib/ratelimit.js';
import { _clearProductsCache } from './billing/routes.js';
import { effectivePlan, entitlementFromEvent } from './billing/entitlements.js';
import { verifyWebhook, webhookKeys } from './billing/webhook.js';

beforeEach(() => { _resetMemoryLimits(); _clearProductsCache(); });
afterEach(() => vi.unstubAllGlobals());

const me = async (env, jar) => (await call(env, jar, '/api/me')).json();
const DAY = 86_400_000;

describe('webhook de Polar', () => {
  it('acepta la firma Standard Webhooks y la de secretos antiguos (UTF-8 del whsec_ completo)', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    const res = await sendWebhook(env, subscriptionEvent('subscription.active', user.user.id));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, applied: true });
    expect((await me(env, jar)).plan).toMatchObject({ premium: true, plan: 'monthly', status: 'active' });
    const legacy = await sendWebhook(env, subscriptionEvent('subscription.updated', user.user.id, { product: 'prod-yearly' }), { legacy: true });
    expect(legacy.status).toBe(202);
    expect((await me(env, jar)).plan.plan).toBe('yearly');
  });

  it('rechaza firma inválida, secreto distinto, cabeceras ausentes y marcas de tiempo viejas', async () => {
    const env = makeEnv();
    const { me: user } = await loginTest(env);
    const ev = subscriptionEvent('subscription.active', user.user.id);
    expect((await sendWebhook(env, ev, { secret: `whsec_${btoa('otrosecretotrosecreto')}` })).status).toBe(403);
    expect((await sendWebhook(env, ev, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(403);
    const noHeaders = await worker.fetch(new Request(`${BASE}/api/webhooks/polar`, { method: 'POST', body: '{}' }), env, {});
    expect(noHeaders.status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM entitlements').first()).n).toBe(0);
  });

  it('es idempotente por webhook-id', async () => {
    const env = makeEnv();
    const { me: user } = await loginTest(env);
    const ev = subscriptionEvent('subscription.active', user.user.id);
    expect(await (await sendWebhook(env, ev, { id: 'msg_1' })).json()).toEqual({ ok: true, applied: true });
    expect(await (await sendWebhook(env, ev, { id: 'msg_1' })).json()).toEqual({ ok: true, duplicate: true });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM webhook_events').first()).n).toBe(1);
  });

  it('cancelada: Premium hasta el fin del período; revocada: sin Premium', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    const id = user.user.id;
    const t0 = Date.now();
    await sendWebhook(env, subscriptionEvent('subscription.active', id, { modifiedAt: new Date(t0 - 3000).toISOString() }));
    await sendWebhook(env, subscriptionEvent('subscription.canceled', id, { cancelAtPeriodEnd: true, modifiedAt: new Date(t0 - 2000).toISOString() }));
    expect((await me(env, jar)).plan).toMatchObject({ premium: true, status: 'canceled', cancelAtPeriodEnd: true });
    await sendWebhook(env, subscriptionEvent('subscription.revoked', id, { status: 'canceled', modifiedAt: new Date(t0 - 1000).toISOString() }));
    expect((await me(env, jar)).plan).toMatchObject({ premium: false, plan: 'free', status: 'expired' });
  });

  it('ignora eventos más viejos que el último aplicado (llegan desordenados)', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    const id = user.user.id;
    await sendWebhook(env, subscriptionEvent('subscription.revoked', id, { status: 'canceled', modifiedAt: new Date(Date.now() - 1000).toISOString() }));
    await sendWebhook(env, subscriptionEvent('subscription.active', id, { modifiedAt: new Date(Date.now() - 5000).toISOString() }));
    expect((await me(env, jar)).plan.premium).toBe(false);
  });

  it('el fin de una suscripción vieja no quita una nueva activa', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    await sendWebhook(env, subscriptionEvent('subscription.active', user.user.id, { id: 'sub_new', modifiedAt: new Date(Date.now() - 2000).toISOString() }));
    await sendWebhook(env, subscriptionEvent('subscription.revoked', user.user.id, { id: 'sub_old', status: 'canceled' }));
    expect((await me(env, jar)).plan.premium).toBe(true);
  });

  it('Fundador (pago único) da Premium de por vida; un reembolso lo quita', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    await sendWebhook(env, orderEvent('order.paid', user.user.id, { modifiedAt: new Date(Date.now() - 2000).toISOString() }));
    expect((await me(env, jar)).plan).toMatchObject({ premium: true, plan: 'founder', lifetime: true, periodEnd: null });
    await sendWebhook(env, orderEvent('order.refunded', user.user.id, { status: 'refunded' }));
    expect((await me(env, jar)).plan.premium).toBe(false);
  });

  it('ignora productos ajenos, usuarios inexistentes y eventos sin interés (pero los registra)', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    expect(await (await sendWebhook(env, subscriptionEvent('subscription.active', user.user.id, { product: 'otro' }))).json()).toEqual({ ok: true, applied: false });
    expect(await (await sendWebhook(env, subscriptionEvent('subscription.active', 'no-existe'))).json()).toEqual({ ok: true, applied: false });
    expect(await (await sendWebhook(env, { type: 'checkout.created', data: { id: 'x' } })).json()).toEqual({ ok: true, applied: false });
    expect((await me(env, jar)).plan.premium).toBe(false);
  });

  it('sin secreto configurado responde 503; cuerpo enorme 413', async () => {
    expect((await sendWebhook(makeEnv({ POLAR_WEBHOOK_SECRET: undefined }), {})).status).toBe(503);
    const big = await worker.fetch(new Request(`${BASE}/api/webhooks/polar`, { method: 'POST', body: 'x'.repeat(300 * 1024) }), makeEnv(), {});
    expect(big.status).toBe(413);
  });
});

describe('plan efectivo', () => {
  const now = Date.now();
  it('suscripción vencida tras el margen deja de ser Premium', () => {
    expect(effectivePlan([{ kind: 'subscription', plan: 'monthly', status: 'active', current_period_end: now - 3 * DAY }], now).premium).toBe(false);
    expect(effectivePlan([{ kind: 'subscription', plan: 'monthly', status: 'active', current_period_end: now - DAY }], now).premium).toBe(true);
    expect(effectivePlan([{ kind: 'subscription', plan: 'monthly', status: 'past_due', current_period_end: now + DAY }], now).premium).toBe(true);
    expect(effectivePlan([{ kind: 'subscription', plan: 'monthly', status: 'expired', current_period_end: now + DAY }], now).premium).toBe(false);
    expect(effectivePlan([], now)).toMatchObject({ premium: false, plan: 'free' });
  });

  it('usa metadata.escaque_user_id si falta external_id', () => {
    const ev = subscriptionEvent('subscription.active', null);
    ev.data.customer.external_id = null;
    ev.data.metadata = { escaque_user_id: 'u1' };
    expect(entitlementFromEvent(ev, () => 'monthly')).toMatchObject({ userId: 'u1', status: 'active' });
  });

  it('webhookKeys: clave base64 de Standard Webhooks y UTF-8 del secreto completo', () => {
    const keys = webhookKeys(WEBHOOK_SECRET);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toHaveLength(24);
    expect(new TextDecoder().decode(keys[1])).toBe(WEBHOOK_SECRET);
  });

  it('verifyWebhook acepta varias firmas separadas por espacios (rotación)', async () => {
    const headers = new Headers({ 'webhook-id': 'a', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)) });
    const { signWebhook } = await import('./billing/webhook.js');
    const good = await signWebhook(webhookKeys(WEBHOOK_SECRET)[0], 'a', headers.get('webhook-timestamp'), '{}');
    headers.set('webhook-signature', `v1,AAAA ${good}`);
    expect(await verifyWebhook({ secret: WEBHOOK_SECRET, headers, body: '{}', toleranceS: 300 })).toEqual({ ok: true });
  });
});

describe('checkout, portal y productos', () => {
  function stubPolar(handler) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    }));
    return calls;
  }

  it('checkout: exige sesión y CSRF; crea el checkout en Polar con external_customer_id', async () => {
    const env = makeEnv();
    expect((await postJson(env, null, '/api/billing/checkout', { plan: 'monthly' }, 'x')).status).toBe(401);
    const { jar, me: user } = await loginTest(env);
    const calls = stubPolar(() => Response.json({ id: 'chk_1', url: 'https://sandbox.polar.sh/checkout/abc' }, { status: 201 }));
    expect((await postJson(env, jar, '/api/billing/checkout', { plan: 'monthly' }, 'malo')).status).toBe(403);
    expect((await postJson(env, jar, '/api/billing/checkout', { plan: 'vitalicio' }, user.csrf)).status).toBe(400);
    const res = await postJson(env, jar, '/api/billing/checkout', { plan: 'monthly' }, user.csrf);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: 'https://sandbox.polar.sh/checkout/abc' });
    const sent = calls.at(-1);
    expect(sent.url).toBe('https://sandbox-api.polar.sh/v1/checkouts/');
    expect(sent.init.headers.Authorization).toBe('Bearer polar_oat_test');
    const body = JSON.parse(sent.init.body);
    expect(body).toMatchObject({
      products: ['prod-monthly'], external_customer_id: user.user.id, customer_email: 'alice@example.test',
      success_url: `${BASE}/?checkout=success&checkout_id={CHECKOUT_ID}`, metadata: { escaque_user_id: user.user.id },
    });
  });

  it('checkout: producción usa api.polar.sh; con Premium activo responde 409', async () => {
    const env = makeEnv({ POLAR_SERVER: 'production' });
    const { jar, me: user } = await loginTest(env);
    const calls = stubPolar(() => Response.json({ id: 'c', url: 'https://polar.sh/checkout/x' }, { status: 201 }));
    await postJson(env, jar, '/api/billing/checkout', { plan: 'founder' }, user.csrf);
    expect(calls.at(-1).url).toBe('https://api.polar.sh/v1/checkouts/');
    await sendWebhook(env, subscriptionEvent('subscription.active', user.user.id));
    expect((await postJson(env, jar, '/api/billing/checkout', { plan: 'yearly' }, user.csrf)).status).toBe(409);
    await sendWebhook(env, orderEvent('order.paid', user.user.id));
    expect((await postJson(env, jar, '/api/billing/checkout', { plan: 'founder' }, user.csrf)).status).toBe(409);
  });

  it('checkout sin Polar configurado → 503; error de Polar → 502 sin detalles', async () => {
    const off = makeEnv({ POLAR_ACCESS_TOKEN: undefined });
    const a = await loginTest(off);
    expect((await postJson(off, a.jar, '/api/billing/checkout', { plan: 'monthly' }, a.me.csrf)).status).toBe(503);
    const env = makeEnv();
    const b = await loginTest(env);
    stubPolar(() => new Response('boom', { status: 500 }));
    const res = await postJson(env, b.jar, '/api/billing/checkout', { plan: 'monthly' }, b.me.csrf);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: { kind: 'billing_unavailable' } });
  });

  it('portal: crea una sesión de cliente por external_customer_id', async () => {
    const env = makeEnv();
    const { jar, me: user } = await loginTest(env);
    const calls = stubPolar(() => Response.json({ customer_portal_url: 'https://sandbox.polar.sh/portal/xyz' }, { status: 201 }));
    const res = await call(env, jar, '/api/billing/portal');
    expect(await res.json()).toEqual({ ok: true, url: 'https://sandbox.polar.sh/portal/xyz' });
    expect(calls.at(-1).url).toBe('https://sandbox-api.polar.sh/v1/customer-sessions/');
    expect(JSON.parse(calls.at(-1).init.body)).toMatchObject({ external_customer_id: user.user.id });
    stubPolar(() => new Response('{}', { status: 404 }));
    expect((await call(env, jar, '/api/billing/portal')).status).toBe(404);
  });

  it('productos: precios de Polar con caché; sin configurar devuelve lista vacía', async () => {
    const env = makeEnv();
    const calls = stubPolar(() => Response.json({
      items: [
        { id: 'prod-monthly', name: 'Mensual', is_recurring: true, recurring_interval: 'month', prices: [{ amount_type: 'fixed', price_amount: 499, price_currency: 'usd', recurring_interval: 'month' }] },
        { id: 'prod-founder', name: 'Fundador', is_recurring: false, recurring_interval: null, prices: [{ amount_type: 'fixed', price_amount: 6000, price_currency: 'usd' }] },
      ],
      pagination: {},
    }));
    const body = await (await call(env, null, '/api/billing/products')).json();
    expect(body.products.map((p) => [p.plan, p.prices[0].amount])).toEqual([['monthly', 499], ['founder', 6000]]);
    expect(body.sandbox).toBe(true);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/v1/products/');
    expect(u.searchParams.getAll('id')).toEqual(['prod-monthly', 'prod-yearly', 'prod-founder']);
    await call(env, null, '/api/billing/products');
    expect(calls).toHaveLength(1);
    const none = await (await call(makeEnv({ POLAR_PRODUCT_MONTHLY: '', POLAR_PRODUCT_YEARLY: '', POLAR_PRODUCT_FOUNDER: '' }), null, '/api/billing/products')).json();
    expect(none).toEqual({ ok: true, configured: false, products: [] });
  });

  it('Polar simulado solo en modo de prueba local', async () => {
    const env = makeEnv({ POLAR_SERVER: 'mock', POLAR_PRODUCT_MONTHLY: 'mock-monthly', POLAR_PRODUCT_YEARLY: 'mock-yearly', POLAR_PRODUCT_FOUNDER: 'mock-founder' });
    const body = await (await call(env, null, '/api/billing/products')).json();
    expect(body.products).toHaveLength(3);
    const prod = await worker.fetch(new Request('https://x.workers.dev/api/billing/products'), env, {});
    expect(await prod.json()).toMatchObject({ configured: false });
  });
});
