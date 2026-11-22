// Caché local del catálogo de Polar (precios, prueba gratis y plazas de Fundador) que devuelve
// GET /api/billing/products. La usa la pantalla Premium y, para el texto de la prueba gratis,
// cualquier bloqueo Premium (V3) sin tener que pedir los precios otra vez.

export const PRODUCTS_CACHE_KEY = 'escaque:products';
export const PRODUCTS_CACHE_MS = 24 * 60 * 60 * 1000;

/** @returns {null|{at:number, products:any[], sandbox:boolean, founder:any}} */
export function readProductsCache(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const c = JSON.parse(storage?.getItem(PRODUCTS_CACHE_KEY) ?? 'null');
    return c && Array.isArray(c.products) && now - c.at < PRODUCTS_CACHE_MS ? c : null;
  } catch {
    return null;
  }
}

export function writeProductsCache(data, storage = globalThis.localStorage, now = Date.now()) {
  try {
    storage?.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({ at: now, products: data.products, sandbox: data.sandbox, founder: data.founder ?? null }));
  } catch {
    // sin almacenamiento
  }
}

/** Prueba gratis válida de un producto ({interval, count}) o null. */
export function trialOf(product) {
  const tr = product?.trial;
  return tr && ['day', 'week', 'month', 'year'].includes(tr.interval) && Number.isInteger(tr.count) && tr.count > 0 ? tr : null;
}

/** Texto de la duración de la prueba («7 días gratis»), o null. */
export const trialText = (trial, t) => (trial ? t(`premium.trialLength.${trial.interval}`, { n: trial.count }) : null);

/** Prueba gratis ofrecida ahora (la del plan anual o, si no, la del mensual), según la caché; o null. */
export function cachedTrial(storage = globalThis.localStorage, now = Date.now()) {
  const products = readProductsCache(storage, now)?.products ?? [];
  for (const plan of ['yearly', 'monthly']) {
    const tr = trialOf(products.find((p) => p.plan === plan));
    if (tr) return tr;
  }
  return null;
}

/** Nota bajo un botón de «Desbloquear» (V3): la prueba gratis si se conoce; si no, una genérica. */
export function trialNote(t, storage = globalThis.localStorage, now = Date.now()) {
  const tr = cachedTrial(storage, now);
  return tr ? t('premium.trialNote', { trial: trialText(tr, t) }) : t('premium.trialNoteGeneric');
}
