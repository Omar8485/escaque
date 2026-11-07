import { afterStartup } from '../startup.js';

// Estado de la PWA fuera de React: registro del service worker (solo en el build), aviso de versión
// nueva e instalación (`beforeinstallprompt`). Se importa en main.jsx antes de pintar, para no
// perder el evento de instalación si el navegador lo lanza pronto. Los componentes lo leen con
// usePwa() (useSyncExternalStore).

/**
 * @typedef {object} PwaState
 * @property {boolean} updateReady   hay una versión nueva instalada esperando
 * @property {boolean} canInstall    el navegador ofrece instalar (Chrome, Edge, Android…)
 * @property {boolean} installed     la app se abrió instalada (ventana propia) o se acaba de instalar
 * @property {boolean} ios           iPhone/iPad: se instala a mano desde Compartir
 */

const listeners = new Set();
/** @type {PwaState} */
let state = { updateReady: false, canInstall: false, installed: false, ios: false };
/** @type {any} evento beforeinstallprompt guardado */
let deferredPrompt = null;
/** @type {ServiceWorkerRegistration | null} */
let registration = null;
let reloading = false;

function set(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getState = () => state;

/** iPhone/iPad (también el iPad que se presenta como Mac). */
export function isIos(nav = globalThis.navigator) {
  if (!nav) return false;
  return /iphone|ipad|ipod/i.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** ¿Abierta como app instalada? */
export function isStandalone(win = globalThis.window) {
  if (!win) return false;
  return Boolean(win.navigator?.standalone) || Boolean(win.matchMedia?.('(display-mode: standalone)').matches);
}

/** Muestra el diálogo de instalación del navegador. @returns {Promise<boolean>} si se aceptó */
export async function promptInstall() {
  const ev = deferredPrompt;
  if (!ev) return false;
  deferredPrompt = null;
  set({ canInstall: false });
  ev.prompt();
  const choice = await ev.userChoice.catch(() => null);
  return choice?.outcome === 'accepted';
}

/** Activa la versión que espera y recarga cuando tome el control. */
export function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return;
  reloading = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

function watchRegistration(reg) {
  registration = reg;
  // Solo hay "versión nueva" si ya había un SW controlando la página (la primera instalación no).
  const markIfWaiting = () => {
    if (reg.waiting && navigator.serviceWorker.controller) set({ updateReady: true });
  };
  markIfWaiting();
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed') markIfWaiting();
    });
  });
  // Busca versión nueva al volver a la pestaña y cada hora.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
  setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
}

/**
 * Registra el SW cuando la página cargó y Stockfish está listo (src/startup.js): así su precarga
 * toma el motor de la caché HTTP en vez de descargarlo otra vez a la vez. Solo en el build.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading) return;
    reloading = false;
    window.location.reload();
  });
  const register = () =>
    navigator.serviceWorker
      .register('/sw.js')
      .then(watchRegistration)
      .catch((e) => console.warn('[pwa] no se pudo registrar el service worker', e));
  afterStartup(register);
}

/** Arranque: se llama una vez desde main.jsx. */
export function initPwa() {
  if (typeof window === 'undefined') return;
  set({ ios: isIos(), installed: isStandalone() });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // sin el mini-banner del navegador: el botón va en el menú
    deferredPrompt = e;
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    set({ canInstall: false, installed: true });
  });
  if (import.meta.env.PROD) registerServiceWorker();
}
