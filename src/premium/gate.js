// Reglas de acceso del plan gratuito (funciones puras; los límites están en limits.js).
import { BOARD_THEME_ORDER, FREE_LIMITS, OFFLINE_PLAN_GRACE_MS, PERIOD_GRACE_MS } from './limits.js';

/** Máximo de partidas a importar en una importación. `requested` null = sin tope (modo «desde»). */
export function importMax(requested, premium) {
  if (premium) return requested;
  const n = Number(requested);
  return Number.isFinite(n) && n > 0 ? Math.min(n, FREE_LIMITS.recentGames) : FREE_LIMITS.recentGames;
}

/** Límite del generador de puzles (0 = todas): en el plan gratuito, las últimas N. */
export function generatorLimit(limit, premium) {
  if (premium) return limit;
  return !limit || limit > FREE_LIMITS.recentGames ? FREE_LIMITS.recentGames : limit;
}

export const isGeneratorLimitAllowed = (limit, premium) => premium || generatorLimit(limit, false) === limit;

/** Período de Progreso efectivo. */
export function progressPeriod(period, premium) {
  if (premium) return period;
  return FREE_LIMITS.progressPeriods.includes(period) ? period : FREE_LIMITS.defaultProgressPeriod;
}

export const isPeriodAllowed = (period, premium) => premium || FREE_LIMITS.progressPeriods.includes(period);
export const isCardAvailable = (id, premium) => premium || FREE_LIMITS.progressCards.includes(id);

/** Acciones del plan de entrenamiento visibles y cuántas quedan ocultas. */
export function planActions(actions, premium) {
  if (premium) return { visible: actions, hidden: 0 };
  const visible = actions.slice(0, FREE_LIMITS.planActions);
  return { visible, hidden: actions.length - visible.length };
}

export const isBoardThemeAvailable = (theme, premium) =>
  BOARD_THEME_ORDER.includes(theme) && (premium || FREE_LIMITS.boardThemes.includes(theme));

/** Tema que se muestra: uno Premium guardado vuelve a madera si el plan ya no lo incluye. */
export const effectiveBoardTheme = (theme, premium) => (isBoardThemeAvailable(theme, premium) ? theme : 'madera');

/** Siguiente tema del botón «Cambiar el tablero» entre los disponibles. */
export function nextBoardTheme(current, premium) {
  const list = BOARD_THEME_ORDER.filter((t) => isBoardThemeAvailable(t, premium));
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

/**
 * ¿Vale el plan guardado en el navegador? Sirve para funcionar sin red: el Premium cacheado se
 * respeta hasta OFFLINE_PLAN_GRACE_MS desde la última consulta y nunca más allá del período pagado.
 * @param {{plan?:{premium?:boolean, lifetime?:boolean, periodEnd?:number|null}, checkedAt?:number}|null} cache
 */
export function cachedPremiumValid(cache, now = Date.now()) {
  const plan = cache?.plan;
  if (!plan?.premium || !Number.isFinite(cache.checkedAt)) return false;
  if (now - cache.checkedAt > OFFLINE_PLAN_GRACE_MS || cache.checkedAt > now + 60_000) return false;
  if (plan.lifetime) return true;
  return !Number.isFinite(plan.periodEnd) || plan.periodEnd + PERIOD_GRACE_MS > now;
}
