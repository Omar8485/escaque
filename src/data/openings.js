// Mapa de aperturas (secuencia SAN → nombre, ≈320 kB) bajo demanda: va en su propio chunk y se pide
// al arrancar (main.jsx) sin bloquear la primera pantalla. Antes de llegar, getOpeningsMap() da un
// mapa vacío: no se reconoce apertura, nada más (el coach necesita al motor, que tarda más).
// La pantalla Progreso (metrics.js, en su Worker) lo importa directamente.

/** @type {Record<string, string>} */
const EMPTY = Object.freeze({});
/** @type {Record<string, string> | null} */
let map = null;
/** @type {Promise<Record<string, string>> | null} */
let pending = null;

/** Descarga el mapa (una sola vez). */
export function loadOpeningsMap() {
  pending ??= import('./openings_map.json').then((m) => (map = m.default));
  return pending;
}

/** El mapa si ya llegó; si no, uno vacío. */
export function getOpeningsMap() {
  return map ?? EMPTY;
}
