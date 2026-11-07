// Derechos Premium: estado guardado en D1 → plan efectivo, y eventos de Polar → filas de D1.
import { ENTITLEMENT_GRACE_MS } from '../config.js';

const ACCESS_STATUSES = new Set(['active', 'canceled', 'past_due']);

/**
 * Plan efectivo a partir de las filas de `entitlements` del usuario.
 * @param {Array<{kind:string, plan:string, status:string, current_period_end:number|null}>} rows
 * @returns {{premium:boolean, plan:'free'|'monthly'|'yearly'|'founder', status:string|null,
 *   lifetime:boolean, periodEnd:number|null, cancelAtPeriodEnd:boolean}}
 */
export function effectivePlan(rows = [], now = Date.now()) {
  const lifetime = rows.find((r) => r.kind === 'lifetime' && r.status === 'active');
  if (lifetime) return { premium: true, plan: 'founder', status: 'active', lifetime: true, periodEnd: null, cancelAtPeriodEnd: false };
  const sub = rows.find((r) => r.kind === 'subscription');
  if (sub && ACCESS_STATUSES.has(sub.status) && (sub.current_period_end == null || sub.current_period_end + ENTITLEMENT_GRACE_MS > now)) {
    return {
      premium: true,
      plan: sub.plan,
      status: sub.status,
      lifetime: false,
      periodEnd: sub.current_period_end ?? null,
      cancelAtPeriodEnd: sub.status === 'canceled',
    };
  }
  return { premium: false, plan: 'free', status: sub?.status ?? null, lifetime: false, periodEnd: sub?.current_period_end ?? null, cancelAtPeriodEnd: false };
}

export async function loadPlan(db, userId, now = Date.now()) {
  const { results } = await db.prepare('SELECT kind, plan, status, current_period_end FROM entitlements WHERE user_id = ?').bind(userId).all();
  return effectivePlan(results, now);
}

const toMs = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Estado interno de una suscripción de Polar.
 * Polar: SubscriptionStatus = incomplete | incomplete_expired | trialing | active | past_due | canceled | unpaid | paused.
 * `subscription.canceled` deja la suscripción activa con cancel_at_period_end = true (acceso hasta el fin
 * del período); `subscription.revoked` la termina (fin del acceso).
 */
export function subscriptionStatus(type, sub) {
  if (type === 'subscription.revoked') return 'expired';
  switch (sub?.status) {
    case 'active':
    case 'trialing':
      return sub.cancel_at_period_end ? 'canceled' : 'active';
    case 'past_due':
      return 'past_due';
    default:
      return 'expired';
  }
}

/**
 * Traduce un evento de Polar a una fila de `entitlements`, o null si no nos afecta.
 * @param {{type:string, timestamp?:string, data:any}} event
 * @param {(productId:string)=>string|null} planOf
 * @returns {null|{userId:string, kind:'subscription'|'lifetime', plan:string, status:string,
 *   periodEnd:number|null, customerId:string|null, ref:string, sourceTs:number}}
 */
export function entitlementFromEvent(event, planOf, now = Date.now()) {
  const { type, data } = event ?? {};
  if (!data || typeof type !== 'string') return null;
  const userId = data.customer?.external_id ?? data.metadata?.escaque_user_id ?? null;
  if (typeof userId !== 'string' || !userId) return null;
  const sourceTs = toMs(data.modified_at) ?? toMs(event.timestamp) ?? toMs(data.created_at) ?? now;
  const customerId = data.customer_id ?? data.customer?.id ?? null;

  if (type.startsWith('subscription.')) {
    const plan = planOf(data.product_id);
    if (!plan || plan === 'founder') return null;
    return {
      userId, kind: 'subscription', plan, status: subscriptionStatus(type, data),
      periodEnd: toMs(data.current_period_end) ?? toMs(data.ends_at), customerId, ref: String(data.id ?? ''), sourceTs,
    };
  }
  if (type === 'order.paid' || type === 'order.refunded' || type === 'order.updated') {
    const orderPlan = planOf(data.product_id);
    // Pago de una suscripción (alta o renovación): `order.paid` trae la suscripción incrustada. Se usa
    // también como señal, por si los eventos `subscription.*` no llegan o llegan tarde. Lo que vale es
    // el estado de la suscripción y su fecha de modificación (un evento posterior la reemplaza).
    if (type === 'order.paid' && (orderPlan === 'monthly' || orderPlan === 'yearly') && data.subscription && typeof data.subscription === 'object') {
      const sub = data.subscription;
      return {
        userId, kind: 'subscription', plan: orderPlan, status: subscriptionStatus('subscription.updated', sub),
        periodEnd: toMs(sub.current_period_end) ?? toMs(sub.ends_at), customerId, ref: String(sub.id ?? data.subscription_id ?? ''),
        sourceTs: toMs(sub.modified_at) ?? toMs(sub.created_at) ?? sourceTs,
      };
    }
    if (orderPlan !== 'founder') return null;
    let status;
    if (data.status === 'refunded') status = 'refunded';
    else if (data.status === 'paid' || data.status === 'partially_refunded' || (type === 'order.paid' && data.paid !== false)) status = 'active';
    else return null;
    return { userId, kind: 'lifetime', plan: 'founder', status, periodEnd: null, customerId, ref: String(data.id ?? ''), sourceTs };
  }
  return null;
}

/**
 * Sentencia de D1 que aplica la fila respetando el orden de los eventos (`source_ts`) y sin que
 * el fin de una suscripción vieja borre una nueva activa (`polar_ref` distinto).
 */
export function upsertEntitlementStatement(db, e, now = Date.now()) {
  return db.prepare(
    `INSERT INTO entitlements (user_id, kind, plan, status, current_period_end, polar_customer_id, polar_ref, source_ts, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, kind) DO UPDATE SET
       plan = excluded.plan, status = excluded.status, current_period_end = excluded.current_period_end,
       polar_customer_id = COALESCE(excluded.polar_customer_id, entitlements.polar_customer_id),
       polar_ref = excluded.polar_ref, source_ts = excluded.source_ts, updated_at = excluded.updated_at
     WHERE excluded.source_ts >= entitlements.source_ts
       AND (entitlements.polar_ref = excluded.polar_ref
            OR excluded.status IN ('active', 'canceled', 'past_due')
            OR entitlements.status NOT IN ('active', 'canceled', 'past_due'))`,
  ).bind(e.userId, e.kind, e.plan, e.status, e.periodEnd, e.customerId, e.ref, e.sourceTs, now);
}
