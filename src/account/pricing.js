// Cálculos de la pantalla Premium a partir de los precios REALES que devuelve Polar (nunca fijos en
// el código). Sin prácticas engañosas: nada de precios tachados ni urgencias inventadas; el ahorro del
// plan anual se redondea hacia abajo para no exagerarlo y solo se muestra si de verdad existe.

/** Precio fijo de un producto (centavos y moneda), o null si no es un precio fijo. */
export function fixedPrice(product) {
  const p = product?.prices?.[0];
  if (!p || p.amountType !== 'fixed' || !Number.isFinite(p.amount) || p.amount <= 0) return null;
  return { cents: p.amount, currency: String(p.currency || 'usd').toLowerCase() };
}

/**
 * Equivalente mensual del plan anual y ahorro frente a pagar 12 meses del mensual.
 * @returns {null|{perMonthCents:number, currency:string, savingsPct:number}} null si falta algún
 *   precio, no son fijos, las monedas difieren o el anual no ahorra nada.
 */
export function yearlyDeal(monthlyProduct, yearlyProduct) {
  const m = fixedPrice(monthlyProduct);
  const y = fixedPrice(yearlyProduct);
  if (!m || !y || m.currency !== y.currency) return null;
  const twelve = m.cents * 12;
  const savingsPct = Math.floor(((twelve - y.cents) / twelve) * 100);
  if (savingsPct <= 0) return null;
  return { perMonthCents: y.cents / 12, currency: y.currency, savingsPct };
}
