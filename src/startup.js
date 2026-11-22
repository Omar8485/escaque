// Orden de arranque: lo que no hace falta para jugar (registrar el service worker, que precarga
// ≈7 MB, y descargar las pantallas diferidas) espera a que la página cargue y Stockfish esté listo,
// para no competir por la red con el motor en la primera visita. Tope: MAX_WAIT_MS.

const MAX_WAIT_MS = 20_000;
let markReady;
const engineReady = new Promise((resolve) => {
  markReady = resolve;
});

/** Lo llama useStockfish cuando el motor pasa a "Listo". */
export function notifyEngineReady() {
  markReady();
}

const pageLoaded = () =>
  new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  });

/**
 * Ejecuta `fn` tras la carga de la página y con el motor listo (o pasados MAX_WAIT_MS), cuando el
 * navegador esté libre.
 * @param {() => void} fn
 */
export function afterStartup(fn) {
  if (typeof window === 'undefined') return;
  const timeout = new Promise((resolve) => setTimeout(resolve, MAX_WAIT_MS));
  pageLoaded()
    .then(() => Promise.race([engineReady, timeout]))
    .then(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 3000 });
      else setTimeout(fn, 200);
    });
}
