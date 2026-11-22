// Rutas de cobro con Polar: productos (con caché), checkout, portal de cliente y webhook.
import { MAX_WEBHOOK_BYTES, WEBHOOK_EVENTS_DAYS, WEBHOOK_TOLERANCE_S, founderEarlyLimit, founderLimit, planForProduct, polarProducts, polarServer } from '../config.js';
import { allow, clientIp, json, jsonError, readJsonBody, readTextBody } from '../lib/http.js';
import { allowRequest } from '../lib/ratelimit.js';
import { checkCsrf, consentRequired, getSession } from '../auth/session.js';
import { entitlementFromEvent, loadPlan, upsertEntitlementStatement } from './entitlements.js';
import { MOCK_PRODUCTS, PolarError, createCheckout, createPortalSession, listProducts } from './polar.js';
import { verifyWebhook } from './webhook.js';

/** Caché de productos por isolate (la Cache API no guarda nada en *.workers.dev). */
const PRODUCTS_TTL_MS = 10 * 60 * 1000;
let productsCache = null;
export const _clearProductsCache = () => { productsCache = null; };

function billingContext(env, url) {
  const server = polarServer(env, url);
  const ids = polarProducts(env);
  if (!server || !Object.keys(ids).length) return null;
  if (server !== 'mock' && !env.POLAR_ACCESS_TOKEN) return null;
  return { server, ids, token: env.POLAR_ACCESS_TOKEN };
}

/** Planes que el cliente puede pedir (el tramo de «Fundador» lo elige el servidor). */
const CHECKOUT_PLANS = new Set(['monthly', 'yearly', 'founder']);

/**
 * Catálogo público: un solo producto «founder», el del tramo vigente, y `nextPrice` con el precio del
 * tramo siguiente mientras dure el primero (para mostrarlo antes de comprar, sin sorpresas).
 */
export function publicCatalog(products, slots) {
  const late = products.find((p) => p.plan === 'founderLate');
  const early = products.find((p) => p.plan === 'founder');
  const out = products.filter((p) => p.plan !== 'founder' && p.plan !== 'founderLate');
  if (slots?.tier === 'late' && late) out.push({ ...late, plan: 'founder', nextPrice: null });
  else if (early) out.push({ ...early, nextPrice: late && slots?.tier === 'early' ? (late.prices?.[0] ?? null) : null });
  return out;
}

const polarFailure = (e) => jsonError(e instanceof PolarError && e.kind === 'polar_auth' ? 503 : 502, 'billing_unavailable');

/** GET /api/billing/products → precios tal como están en Polar (nunca fijados en el código). */
export async function handleProducts(request, url, env, { fetchImpl, now = Date.now() } = {}) {
  const bad = allow(request, 'GET');
  if (bad) return bad;
  const ctx = billingContext(env, url);
  if (!ctx) return json({ ok: true, configured: false, products: [] });
  if (!(await allowRequest(env, 'RL_API', `ip:${clientIp(request)}`))) return jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' });
  const cacheKey = `${ctx.server}:${Object.values(ctx.ids).join(',')}`;
  if (!productsCache || productsCache.key !== cacheKey || now - productsCache.at > PRODUCTS_TTL_MS) {
    try {
      const products = ctx.server === 'mock'
        ? MOCK_PRODUCTS.filter((p) => ctx.ids[p.plan] === p.id)
        : await listProducts({ server: ctx.server, token: ctx.token, ids: ctx.ids, fetchImpl });
      productsCache = { key: cacheKey, at: now, products };
    } catch (e) {
      if (productsCache?.key === cacheKey) {
        const slots = ctx.ids.founder ? await founderSlots(env) : null;
        return json({ ok: true, configured: true, stale: true, sandbox: ctx.server !== 'production', products: publicCatalog(productsCache.products, slots), founder: publicSlots(slots) });
      }
      return polarFailure(e);
    }
  }
  // Cupos de «Fundador» en vivo (no se cachean con los precios): solo si ese producto existe.
  const slots = ctx.ids.founder ? await founderSlots(env) : null;
  return json(
    { ok: true, configured: true, sandbox: ctx.server !== 'production', products: publicCatalog(productsCache.products, slots), founder: publicSlots(slots) },
    200,
    { 'Cache-Control': 'private, max-age=60' },
  );
}

async function requireUser(request, url, env) {
  if (!env.DB) return { error: jsonError(503, 'accounts_not_configured') };
  const session = await getSession(request, env, url);
  if (!session) return { error: jsonError(401, 'unauthenticated') };
  if (!(await allowRequest(env, 'RL_API', `user:${session.user.id}`))) return { error: jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' }) };
  return { session };
}

/** POST /api/billing/checkout { plan: 'monthly'|'yearly'|'founder' } → { url } de Polar. */
export async function handleCheckout(request, url, env, { fetchImpl } = {}) {
  const bad = allow(request, 'POST');
  if (bad) return bad;
  const ctx = billingContext(env, url);
  if (!ctx) return jsonError(503, 'billing_not_configured');
  const { session, error } = await requireUser(request, url, env);
  if (error) return error;
  if (!(await checkCsrf(request, url, env, session))) return jsonError(403, 'csrf');
  // Comprar es aceptar un contrato: antes, los términos vigentes (shared/legal.js).
  if (consentRequired(session)) return jsonError(403, 'consent_required');
  const body = await readJsonBody(request, 1024);
  if (!body.ok) return jsonError(body.status, body.kind);
  const plan = body.value?.plan;
  let productId = CHECKOUT_PLANS.has(plan) ? ctx.ids[plan] : null;
  if (!productId) return jsonError(400, 'invalid_plan');

  const current = await loadPlan(env.DB, session.user.id);
  if (current.lifetime) return jsonError(409, 'already_premium');
  if (plan !== 'founder' && current.premium) return jsonError(409, 'already_subscribed');
  if (plan === 'founder') {
    const slots = await founderSlots(env);
    if (slots?.soldOut) return jsonError(409, 'founder_sold_out');
    // Tramo vigente: el precio de lanzamiento solo mientras queden plazas del primer tramo.
    if (slots?.tier === 'late') productId = ctx.ids.founderLate;
  }

  if (ctx.server === 'mock') return json({ ok: true, url: `${url.origin}/?checkout=success&checkout_id=mock-${plan}` });
  try {
    const user = { ...session.user, emailVerified: session.user.provider === 'google' || Boolean(session.user.email) };
    const checkout = await createCheckout({ server: ctx.server, token: ctx.token, productId, user, origin: url.origin, fetchImpl });
    return json({ ok: true, url: checkout.url });
  } catch (e) {
    return polarFailure(e);
  }
}

/** GET /api/billing/portal → { url } del portal de cliente de Polar. */
export async function handlePortal(request, url, env, { fetchImpl } = {}) {
  const bad = allow(request, 'GET');
  if (bad) return bad;
  const ctx = billingContext(env, url);
  if (!ctx) return jsonError(503, 'billing_not_configured');
  const { session, error } = await requireUser(request, url, env);
  if (error) return error;
  if (ctx.server === 'mock') return json({ ok: true, url: `${url.origin}/?premium=open&portal=mock` });
  try {
    return json({ ok: true, url: (await createPortalSession({ server: ctx.server, token: ctx.token, user: session.user, origin: url.origin, fetchImpl })).url });
  } catch (e) {
    // 404 de Polar: el usuario aún no es cliente (nunca compró).
    if (e instanceof PolarError && e.status === 404) return jsonError(404, 'no_customer');
    return polarFailure(e);
  }
}

/** POST /api/webhooks/polar — firma Standard Webhooks, idempotente por webhook-id. */
export async function handlePolarWebhook(request, url, env, { now = Date.now() } = {}) {
  const bad = allow(request, 'POST');
  if (bad) return bad;
  if (!env.DB || !env.POLAR_WEBHOOK_SECRET) return jsonError(503, 'billing_not_configured');
  if (!(await allowRequest(env, 'RL_WEBHOOK', `ip:${clientIp(request)}`))) return jsonError(429, 'rate_limited', {}, { 'Retry-After': '60' });
  const body = await readTextBody(request, MAX_WEBHOOK_BYTES);
  if (body == null) return jsonError(413, 'payload_too_large');
  const verified = await verifyWebhook({ secret: env.POLAR_WEBHOOK_SECRET, headers: request.headers, body, toleranceS: WEBHOOK_TOLERANCE_S, now });
  if (!verified.ok) return jsonError(403, 'invalid_signature');
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const id = request.headers.get('webhook-id');
  const db = env.DB;
  if (await db.prepare('SELECT 1 AS x FROM webhook_events WHERE id = ?').bind(id).first()) return json({ ok: true, duplicate: true }, 202);

  const entitlement = entitlementFromEvent(event, (productId) => planForProduct(env, productId), now);
  const statements = [];
  let applied = false;
  if (entitlement && (await db.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(entitlement.userId).first())) {
    statements.push(upsertEntitlementStatement(db, entitlement, now));
    applied = true;
  }
  statements.push(
    db.prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)').bind(id, String(event?.type ?? '').slice(0, 80), now),
    db.prepare('DELETE FROM webhook_events WHERE received_at < ?').bind(now - WEBHOOK_EVENTS_DAYS * 86_400_000),
  );
  try {
    await db.batch(statements);
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e?.message))) return json({ ok: true, duplicate: true }, 202);
    throw e;
  }
  return json({ ok: true, applied }, 202);
}

/**
 * Cupos de «Fundador»: límite total (FOUNDER_LIMIT), vendidos (derechos de por vida activos en D1; los
 * reembolsados liberan su plaza) y restantes. Con el producto del segundo tramo configurado
 * (POLAR_PRODUCT_FOUNDER_LATE), las primeras FOUNDER_EARLY_LIMIT plazas son del primer tramo.
 * null si no hay base de datos.
 * @returns {Promise<null|{limit:number, sold:number, remaining:number, soldOut:boolean,
 *   tier:'early'|'late'|'single', early:number|null, earlyRemaining:number|null}>}
 */
export async function founderSlots(env) {
  if (!env.DB) return null;
  const limit = founderLimit(env);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE kind = 'lifetime' AND status = 'active'").first();
  const sold = Number(row?.n ?? 0);
  const remaining = Math.max(0, limit - sold);
  if (!env.POLAR_PRODUCT_FOUNDER_LATE) return { limit, sold, remaining, soldOut: remaining === 0, tier: 'single', early: null, earlyRemaining: null };
  const early = founderEarlyLimit(env);
  const earlyRemaining = Math.max(0, early - sold);
  return { limit, sold, remaining, soldOut: remaining === 0, tier: earlyRemaining > 0 ? 'early' : 'late', early, earlyRemaining };
}

/** Lo que ve el público: plazas totales y restantes, y el tramo (sin el número de vendidas). */
const publicSlots = (slots) => (slots
  ? { limit: slots.limit, remaining: slots.remaining, soldOut: slots.soldOut, tier: slots.tier, early: slots.early, earlyRemaining: slots.earlyRemaining }
  : null);
