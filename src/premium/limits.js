// ─────────────────────────────────────────────────────────────────────────────────────────────
//  LÍMITES DEL PLAN GRATUITO — único archivo a tocar para cambiar qué es gratis y qué es Premium.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Reglas fijas (no configurables): jugar contra todos los rivales y el coach nunca se limitan; la app
// funciona sin cuenta y todo se guarda en el navegador. Los precios NO están aquí: vienen de Polar.

export const FREE_LIMITS = Object.freeze({
  /** Importar y analizar/generar puzles: solo las N partidas más recientes. */
  recentGames: 50,
  /** Períodos de Progreso disponibles ('30' | '90' | 'all'). */
  progressPeriods: Object.freeze(['30']),
  /** Período por defecto de Progreso en el plan gratuito. */
  defaultProgressPeriod: '30',
  /** Tarjetas de Progreso visibles (las demás muestran el aviso de Premium). */
  progressCards: Object.freeze(['results', 'elo', 'accuracy', 'phases', 'weaknesses']),
  /** Acciones del plan de entrenamiento. */
  planActions: 1,
  /** Temas de tablero. */
  boardThemes: Object.freeze(['madera', 'verde']),
  /** Sincronización entre dispositivos (además, el servidor la exige Premium). */
  sync: false,
});

/** Todos los temas de tablero, en el orden en que los recorre el botón «Cambiar el tablero». */
export const BOARD_THEME_ORDER = Object.freeze(['madera', 'verde', 'azul', 'arena']);

/** Beneficios que muestra la pantalla Premium (claves i18n `premium.benefit.<id>`). */
export const PREMIUM_BENEFITS = Object.freeze(['history', 'progress', 'plan', 'sync', 'themes', 'support']);

/** Cuánto se fía la app del plan Premium guardado si no puede consultar al servidor (sin red). */
export const OFFLINE_PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Margen tras el fin del período pagado (igual que el servidor: worker/config.js). */
export const PERIOD_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
