// Cliente mínimo de la API de Polar (https://polar.sh/docs/api-reference), sin SDK.
//   POST /v1/checkouts/          (scope checkouts:write)          → { id, url, expires_at, ... }
//   POST /v1/customer-sessions/  (scope customer_sessions:write)  → { customer_portal_url, ... }
//   GET  /v1/products/?id=…      (scope products:read)            → { items: Product[] }
// Sandbox: https://sandbox-api.polar.sh (cuenta, organización y token propios; tarjeta 4242 4242 4242 4242).
import { POLAR_API_BASE } from '../config.js';

export class PolarError extends Error {
  constructor(status, kind) {
    super(`Polar ${status}`);
    this.status = status;
    this.kind = kind;
  }
}

async function call(server, token, method, path, { body, query, fetchImpl = fetch } = {}) {
  const url = new URL(path, POLAR_API_BASE[server]);
  if (query) for (const [k, v] of query) url.searchParams.append(k, v);
  const res = await fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new PolarError(res.status, res.status === 401 || res.status === 403 ? 'polar_auth' : 'polar_error');
  return res.json();
}

/**
 * Crea un checkout de un producto para el usuario de Escaque (external_customer_id = id del usuario).
 * @returns {Promise<{url:string, id:string}>}
 */
export async function createCheckout({ server, token, productId, user, origin, fetchImpl }) {
  const body = {
    products: [productId],
    external_customer_id: user.id,
    success_url: `${origin}/?checkout=success&checkout_id={CHECKOUT_ID}`,
    return_url: `${origin}/?premium=open`,
    metadata: { escaque_user_id: user.id },
    customer_metadata: { escaque_user_id: user.id },
  };
  if (user.email && user.emailVerified !== false) body.customer_email = user.email;
  const data = await call(server, token, 'POST', '/v1/checkouts/', { body, fetchImpl });
  if (typeof data?.url !== 'string') throw new PolarError(502, 'polar_invalid');
  return { url: data.url, id: data.id };
}

/** Enlace al portal de cliente de Polar (gestionar o cancelar la suscripción, facturas). */
export async function createPortalSession({ server, token, user, origin, fetchImpl }) {
  const data = await call(server, token, 'POST', '/v1/customer-sessions/', {
    body: { external_customer_id: user.id, return_url: `${origin}/?premium=open` },
    fetchImpl,
  });
  if (typeof data?.customer_portal_url !== 'string') throw new PolarError(502, 'polar_invalid');
  return { url: data.customer_portal_url };
}

/** Precio legible para la app (los importes vienen en centavos, como los devuelve Polar). */
function mapPrice(p) {
  return {
    amountType: p.amount_type ?? null,
    amount: Number.isFinite(p.price_amount) ? p.price_amount : null,
    minimum: Number.isFinite(p.minimum_amount) ? p.minimum_amount : null,
    currency: typeof p.price_currency === 'string' ? p.price_currency : null,
    interval: p.recurring_interval ?? null,
  };
}

/**
 * Productos configurados, con sus precios tal como están en Polar.
 * @param {Record<string,string>} ids plan → id de producto
 */
export async function listProducts({ server, token, ids, fetchImpl }) {
  const query = [['limit', '100'], ['is_archived', 'false'], ...Object.values(ids).map((id) => ['id', id])];
  const data = await call(server, token, 'GET', '/v1/products/', { query, fetchImpl });
  const byId = new Map((data?.items ?? []).map((p) => [p.id, p]));
  const out = [];
  for (const [plan, id] of Object.entries(ids)) {
    const p = byId.get(id);
    if (!p) continue;
    out.push({
      plan,
      id,
      name: typeof p.name === 'string' ? p.name : plan,
      description: typeof p.description === 'string' ? p.description.slice(0, 500) : null,
      recurring: Boolean(p.is_recurring),
      interval: p.recurring_interval ?? null,
      prices: (p.prices ?? []).filter((x) => !x.is_archived).map(mapPrice),
    });
  }
  return out;
}

/** Productos ficticios del modo de prueba (sin red), con los precios decididos para Polar (USD). */
export const MOCK_PRODUCTS = Object.freeze([
  { plan: 'monthly', id: 'mock-monthly', name: 'Escaque Premium (mensual)', description: null, recurring: true, interval: 'month', prices: [{ amountType: 'fixed', amount: 299, minimum: null, currency: 'usd', interval: 'month' }] },
  { plan: 'yearly', id: 'mock-yearly', name: 'Escaque Premium (anual)', description: null, recurring: true, interval: 'year', prices: [{ amountType: 'fixed', amount: 1999, minimum: null, currency: 'usd', interval: 'year' }] },
  { plan: 'founder', id: 'mock-founder', name: 'Escaque Fundador', description: null, recurring: false, interval: null, prices: [{ amountType: 'fixed', amount: 4999, minimum: null, currency: 'usd', interval: null }] },
]);
