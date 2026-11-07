// Configuración del servidor de cuentas: límites (pensados para el plan gratuito de Cloudflare) y
// lectura de variables de entorno. Los secretos se cargan con `npx wrangler secret put` y nunca
// se registran ni se devuelven al cliente.
//
// Plan gratuito de D1 (developers.cloudflare.com/d1/platform/limits y /pricing, consultado 2026-11-02):
//   5 millones de filas leídas/día y 100.000 filas escritas/día (se reinicia a las 00:00 UTC),
//   500 MB por base, 5 GB por cuenta, 50 consultas por invocación (un batch() cuenta como una),
//   100 parámetros por consulta, 2 MB por fila, 100 KB por sentencia SQL.
// Plan gratuito de Workers: 100.000 peticiones/día, 10 ms de CPU por petición, 50 subpeticiones.

/** Duración de la sesión (días). */
export const SESSION_DAYS = 30;
/** Sesiones abiertas por usuario (las más antiguas se cierran). */
export const MAX_SESSIONS_PER_USER = 10;
/** Vida de la cookie del inicio de sesión (state, nonce, PKCE). */
export const LOGIN_COOKIE_SECONDS = 600;
/** Margen tras el fin del período pagado antes de quitar Premium (renovaciones que llegan tarde). */
export const ENTITLEMENT_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
/** Tolerancia de la marca de tiempo de los webhooks (Standard Webhooks). */
export const WEBHOOK_TOLERANCE_S = 300;
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * Límites de sincronización. Cada registro sincronizado escribe ~2 filas en D1 (la fila y su índice),
 * así que 3.000 registros/día por usuario ≈ 6.000 filas: unos 15 usuarios haciendo su subida inicial
 * completa el mismo día caben en las 100.000 filas escritas/día del plan gratuito. Se pueden cambiar
 * con variables de entorno sin tocar el código (ver docs/DEPLOY-ACCOUNTS.md).
 */
export const SYNC_DEFAULTS = Object.freeze({
  maxItemsPerPush: 100,
  maxPushBytes: 512 * 1024,
  maxItemBytes: 128 * 1024,
  maxPullItems: 100,
  maxPullBytes: 768 * 1024,
  maxUserBytes: 25 * 1024 * 1024,
  maxUserItems: 20_000,
  maxDailyWrites: 3000,
});

/** Almacenes que se pueden sincronizar (los de IndexedDB + preferencias del navegador). */
export const SYNC_STORES = Object.freeze(['games', 'analysis', 'puzzles', 'moves', 'meta', 'prefs']);

const intVar = (v, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function syncLimits(env = {}) {
  return {
    ...SYNC_DEFAULTS,
    maxUserBytes: intVar(env.SYNC_MAX_USER_BYTES, SYNC_DEFAULTS.maxUserBytes),
    maxUserItems: intVar(env.SYNC_MAX_USER_ITEMS, SYNC_DEFAULTS.maxUserItems),
    maxDailyWrites: intVar(env.SYNC_MAX_DAILY_WRITES, SYNC_DEFAULTS.maxDailyWrites),
  };
}

/**
 * Modo de prueba (proveedor OIDC simulado y Polar simulado): solo con AUTH_TEST_MODE=1 Y
 * petición a localhost/127.0.0.1. En producción (workers.dev o dominio propio) nunca se activa,
 * aunque alguien cargue la variable por error.
 */
export function isTestMode(env, url) {
  return env?.AUTH_TEST_MODE === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/** Productos de Polar configurados: plan → id. */
export function polarProducts(env = {}) {
  const out = {};
  if (env.POLAR_PRODUCT_MONTHLY) out.monthly = env.POLAR_PRODUCT_MONTHLY;
  if (env.POLAR_PRODUCT_YEARLY) out.yearly = env.POLAR_PRODUCT_YEARLY;
  if (env.POLAR_PRODUCT_FOUNDER) out.founder = env.POLAR_PRODUCT_FOUNDER;
  return out;
}

/** Cupos del plan «Fundador» si no se configura FOUNDER_LIMIT (decisión del dueño: los primeros 500). */
export const DEFAULT_FOUNDER_LIMIT = 500;

/** Cupos de «Fundador» (entero ≥ 0; 0 = agotado). Variable FOUNDER_LIMIT en wrangler.jsonc. */
export function founderLimit(env = {}) {
  const raw = env.FOUNDER_LIMIT;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_FOUNDER_LIMIT;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_FOUNDER_LIMIT;
}

/** Días que se guardan los avisos de Polar ya procesados (idempotencia). */
export const WEBHOOK_EVENTS_DAYS = 30;

/** plan a partir del id de producto de Polar, o null si no es uno nuestro. */
export function planForProduct(env, productId) {
  for (const [plan, id] of Object.entries(polarProducts(env))) if (id === productId) return plan;
  return null;
}

/** 'sandbox' | 'production' | 'mock' (este último solo en modo de prueba). */
export function polarServer(env, url) {
  const s = env?.POLAR_SERVER;
  if (s === 'mock') return isTestMode(env, url) ? 'mock' : null;
  return s === 'production' ? 'production' : 'sandbox';
}

export const POLAR_API_BASE = Object.freeze({
  sandbox: 'https://sandbox-api.polar.sh',
  production: 'https://api.polar.sh',
});
