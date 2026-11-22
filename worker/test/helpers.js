// Utilidades de los tests del Worker: entorno con D1 en memoria, cookies y login simulado.
import worker from '../index.js';
import { TestD1 } from './d1.js';
import { signWebhook, webhookKeys } from '../billing/webhook.js';
import { base64Encode } from '../lib/crypto.js';
import { TERMS_VERSION } from '../../shared/legal.js';

export const BASE = 'http://localhost:8787';
export const SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
// Secreto con el formato de Standard Webhooks: whsec_ + base64 de 24 bytes.
export const WEBHOOK_SECRET = `whsec_${base64Encode(new Uint8Array(24).map((_, i) => i + 1))}`;

export function makeEnv(extra = {}) {
  return {
    DB: new TestD1(),
    SESSION_SECRET,
    AUTH_TEST_MODE: '1',
    POLAR_SERVER: 'sandbox',
    POLAR_ACCESS_TOKEN: 'polar_oat_test',
    POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    POLAR_PRODUCT_MONTHLY: 'prod-monthly',
    POLAR_PRODUCT_YEARLY: 'prod-yearly',
    POLAR_PRODUCT_FOUNDER: 'prod-founder',
    ASSETS: { fetch: async () => new Response('<html></html>') },
    ...extra,
  };
}

/** Cookies `nombre=valor` de las cabeceras Set-Cookie de una respuesta. */
export function setCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie')].filter(Boolean);
  return list;
}

export class Jar {
  constructor() {
    this.cookies = new Map();
  }

  take(res) {
    for (const c of setCookies(res)) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0/i.test(a)) || !value) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/** Petición al Worker con las cookies del tarro (y las guarda de la respuesta). */
export async function call(env, jar, path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (jar?.cookies.size) headers.set('Cookie', jar.header());
  const res = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env, { waitUntil: () => {} });
  return jar ? jar.take(res) : res;
}

/**
 * Login completo con el proveedor simulado. Devuelve { jar, me }. Por defecto acepta la versión
 * vigente de los términos (como la casilla de la app); `consent: null` empieza el login sin ella.
 */
export async function loginTest(env, hint = 'alice', { consent = TERMS_VERSION } = {}) {
  const jar = new Jar();
  const start = await call(env, jar, `/api/auth/login/test?hint=${hint}${consent ? `&consent=${encodeURIComponent(consent)}` : ''}`);
  const authorize = new URL(start.headers.get('Location'));
  const granted = await call(env, jar, `${authorize.pathname}${authorize.search}`);
  const cb = new URL(granted.headers.get('Location'));
  const done = await call(env, jar, `${cb.pathname}${cb.search}`);
  if (done.status !== 302 || !done.headers.get('Location').includes('account=ok')) throw new Error(`login falló: ${done.headers.get('Location')}`);
  const me = await (await call(env, jar, '/api/me')).json();
  return { jar, me };
}

/** POST JSON con el token CSRF y Origin de la app. */
export function postJson(env, jar, path, body, csrf, method = 'POST') {
  return call(env, jar, path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'X-CSRF-Token': csrf ?? '' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Envía un webhook de Polar firmado (clave Standard Webhooks por defecto). */
export async function sendWebhook(env, event, { id = crypto.randomUUID(), legacy = false, timestamp = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify(event);
  const keys = webhookKeys(secret);
  const key = legacy ? keys.at(-1) : keys[0];
  const signature = await signWebhook(key, id, String(timestamp), body);
  return worker.fetch(new Request(`${BASE}/api/webhooks/polar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature },
    body,
  }), env, {});
}

export function subscriptionEvent(type, userId, { status = 'active', product = 'prod-monthly', id = 'sub_1', periodEnd = Date.now() + 30 * 86_400_000, cancelAtPeriodEnd = false, modifiedAt = new Date().toISOString() } = {}) {
  return {
    type,
    timestamp: modifiedAt,
    data: {
      id, status, product_id: product, customer_id: 'cus_1', cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: new Date(periodEnd).toISOString(), modified_at: modifiedAt,
      customer: { id: 'cus_1', external_id: userId }, metadata: {},
    },
  };
}

export function orderEvent(type, userId, { status = 'paid', product = 'prod-founder', id = 'ord_1', modifiedAt = new Date().toISOString() } = {}) {
  return {
    type,
    timestamp: modifiedAt,
    data: { id, status, paid: status !== 'pending', product_id: product, billing_reason: 'purchase', customer_id: 'cus_1', modified_at: modifiedAt, customer: { id: 'cus_1', external_id: userId }, metadata: {} },
  };
}
