// Medición del embudo (diseño interno §4): cuenta eventos de forma agregada en el servidor (/api/e).
// Sin identificadores ni cookies: se envía solo el nombre del evento y el idioma de la app.
// En desarrollo y en el build de e2e no se envía nada: los eventos quedan en
// `window.__escaqueEvents` para que las pruebas los comprueben.
import { isEvent } from '../../shared/events.js';

export const EVENT_ENDPOINT = '/api/e';
/** Clave local con el día de la primera visita (AAAA-MM-DD local), para el retorno a 1 y 7 días. */
export const FIRST_SEEN_KEY = 'escaque:firstSeen';
/** Prefijo de las marcas de «ya contado» (una vez por sesión, por día o para siempre). */
export const ONCE_PREFIX = 'escaque:ev:';

const DAY_MS = 86_400_000;

const safe = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};

/** Día local AAAA-MM-DD. */
export function localDay(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Días completos entre dos días locales AAAA-MM-DD (b − a). */
export function daysBetween(a, b) {
  const t = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / DAY_MS);
}

/**
 * Entorno inyectable (tests). Por defecto: navegador real.
 * @typedef {{local?: Storage|null, session?: Storage|null, send?: (body:string)=>void, sink?: string[]|null,
 *   lang?: () => string, now?: () => number}} TrackEnv
 */
function defaultEnv() {
  const g = globalThis;
  const mode = safe(() => import.meta.env?.MODE, 'production');
  const dev = safe(() => import.meta.env?.DEV, false);
  const testing = dev || mode === 'e2e' || mode === 'test';
  return {
    local: safe(() => g.localStorage),
    session: safe(() => g.sessionStorage),
    sink: testing ? (g.__escaqueEvents ??= []) : null,
    send: (body) => {
      const blob = new Blob([body], { type: 'application/json' });
      if (g.navigator?.sendBeacon?.(EVENT_ENDPOINT, blob)) return;
      g.fetch?.(EVENT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    },
    lang: () => safe(() => g.document?.documentElement?.lang, '') || '',
    now: () => Date.now(),
  };
}

let envOverride = null;
/** Solo para tests. */
export const _setTrackEnv = (env) => { envOverride = env; };
const getEnv = () => envOverride ?? defaultEnv();

/**
 * Cuenta un evento del embudo. Nunca lanza ni bloquea.
 * @param {import('../../shared/events.js').EventName} event
 * @param {{once?: 'session'|'day'|'ever'}} [opts]  evita contar dos veces lo mismo
 * @returns {boolean} true si se contó
 */
export function track(event, { once } = {}) {
  if (!isEvent(event)) return false;
  const env = getEnv();
  if (once) {
    const store = once === 'session' ? env.session : env.local;
    const key = ONCE_PREFIX + event;
    const stamp = once === 'day' ? localDay(env.now?.() ?? Date.now()) : '1';
    if (safe(() => store?.getItem(key)) === stamp) return false;
    safe(() => store?.setItem(key, stamp));
  }
  const lang = String(env.lang?.() ?? '').slice(0, 2);
  if (env.sink) {
    env.sink.push(event);
    return true;
  }
  safe(() => env.send?.(JSON.stringify({ e: event, l: lang })));
  return true;
}

/**
 * Llamar una vez al arrancar la app: cuenta la primera visita y el retorno a 1 y a 7 días.
 * @returns {'first'|'d1'|'d7'|null} lo que se contó
 */
export function markVisit() {
  const env = getEnv();
  const today = localDay(env.now?.() ?? Date.now());
  const first = safe(() => env.local?.getItem(FIRST_SEEN_KEY));
  if (!first || !/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    safe(() => env.local?.setItem(FIRST_SEEN_KEY, today));
    return track('first_visit', { once: 'ever' }) ? 'first' : null;
  }
  const days = daysBetween(first, today);
  if (days >= 7 && days <= 13) return track('return_d7', { once: 'ever' }) ? 'd7' : null;
  if (days >= 1 && days <= 6) return track('return_d1', { once: 'ever' }) ? 'd1' : null;
  return null;
}
