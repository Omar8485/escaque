// Perfil del motor según el dispositivo. Lógica pura (las pruebas inyectan el entorno).
//
// Teléfonos y tabletas (sobre todo de gama de entrada, p. ej. Samsung A13 con 3–4 GB de RAM y
// Chrome de 32 bits) no pueden reservar 2 × 2 GB de memoria compartida: cada Stockfish multihilo
// reserva el MÁXIMO de su WebAssembly.Memory al arrancar. En ellos se usa:
//   - stockfish-movil.js: el mismo motor con el máximo en 512 MB (de sobra para Hash 32 MB);
//   - un reintento si el worker falla al arrancar (la página anterior aún no soltó su memoria);
//   - el rival arranca cuando el analista ya está listo y solo en Jugar o con partida en curso.
// La calidad del análisis NO cambia (misma profundidad, MultiPV, hilos y tabla hash).
// El escritorio no cambia en nada.

export const DESKTOP_ENGINE_URL = '/stockfish/stockfish.js';
export const PHONE_ENGINE_URL = '/stockfish/stockfish-movil.js';
// stockfish.js deduce el .wasm de su propio nombre (stockfish-movil.wasm, que no existe) salvo que
// se le indique tras «#»: el mismo stockfish.wasm de siempre (también para sus hilos).
export const PHONE_ENGINE_WORKER_URL = `${PHONE_ENGINE_URL}#${encodeURIComponent('/stockfish/stockfish.wasm')}`;
/** Máximo de memoria compartida del motor en teléfonos (MB). Debe coincidir con stockfish-movil.js. */
export const PHONE_ENGINE_MAX_MB = 512;

/**
 * @typedef {object} EngineEnv
 * @property {string} [userAgent]
 * @property {boolean} [uaDataMobile]   navigator.userAgentData?.mobile (Chrome)
 * @property {number} [maxTouchPoints]
 * @property {boolean} [coarsePointer]  matchMedia('(pointer: coarse)')
 * @property {boolean} [finePointer]    matchMedia('(any-pointer: fine)')
 */

/**
 * true en teléfonos y tabletas; false en escritorio (también en portátiles con pantalla táctil,
 * que tienen ratón o touchpad).
 * @param {EngineEnv} env
 */
export function isPhoneLike({ userAgent = '', uaDataMobile, maxTouchPoints = 0, coarsePointer = false, finePointer = false } = {}) {
  if (uaDataMobile === true) return true;
  if (/Android|iPhone|iPod|Mobile/i.test(userAgent)) return true;
  // iPadOS se presenta como Mac de escritorio: se distingue por la pantalla táctil.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return true;
  return coarsePointer && !finePointer && maxTouchPoints > 0;
}

/**
 * Opciones del motor para el dispositivo.
 * @param {EngineEnv} env
 * @returns {{phone: boolean, analyst: {url: string, retries: number}, rival: {url: string, retries: number}, lazyRival: boolean}}
 */
export function engineProfile(env) {
  const phone = isPhoneLike(env);
  const url = phone ? PHONE_ENGINE_WORKER_URL : DESKTOP_ENGINE_URL;
  const retries = phone ? 1 : 0;
  return { phone, analyst: { url, retries }, rival: { url, retries }, lazyRival: phone };
}

/** Entorno real del navegador (fuera de las pruebas). */
export function readEngineEnv() {
  const nav = globalThis.navigator ?? {};
  const mq = (q) => Boolean(globalThis.matchMedia?.(q).matches);
  return {
    userAgent: nav.userAgent ?? '',
    uaDataMobile: nav.userAgentData?.mobile,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    coarsePointer: mq('(pointer: coarse)'),
    finePointer: mq('(any-pointer: fine)'),
  };
}
