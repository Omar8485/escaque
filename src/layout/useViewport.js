import { useEffect, useSyncExternalStore } from 'react';
import { viewportInfo, sameViewport } from './viewport.js';

// Hook del contrato de la ronda M (diseño móvil interno §3). Un único almacén para toda la app: se
// recalcula al redimensionar, girar el teléfono o cambiar el zoom, y solo notifica si cambia.

/** @type {import('./viewport.js').ViewportInfo | null} */
let current = null;
const listeners = new Set();

function read() {
  const vv = globalThis.visualViewport;
  // innerWidth/innerHeight = viewport de diseño (lo que usan las media queries y `100dvh`).
  return viewportInfo({
    width: globalThis.innerWidth ?? vv?.width,
    height: globalThis.innerHeight ?? vv?.height,
  });
}

function update() {
  const next = read();
  if (sameViewport(current, next)) return;
  current = next;
  for (const l of listeners) l();
}

function subscribe(onChange) {
  listeners.add(onChange);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    }
  };
}

function getSnapshot() {
  if (!current) current = read();
  return current;
}

const SERVER = viewportInfo({ width: 1280, height: 800 });

/**
 * Tamaño y tipo de pantalla actual: `{ mobile, phone, landscape, width, height }`.
 * `mobile` (< 1024 px) es la condición de todo lo de la ronda M: el escritorio no cambia.
 * @returns {import('./viewport.js').ViewportInfo}
 */
export function useViewport() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
}

/**
 * La barra inferior (M2, BottomNav) llama a esto mientras está montada: marca `<html data-bottom-nav="on">`
 * y así `--bottom-nav-h` pasa de 0 a 56 px + área segura (src/index.css). Sin barra, nada queda
 * reservado abajo.
 * @param {boolean} [active=true]
 */
export function useBottomNavReservation(active = true) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.dataset.bottomNav = 'on';
    return () => {
      delete root.dataset.bottomNav;
    };
  }, [active]);
}

/**
 * Valor en px de una variable CSS de longitud (p. ej. '--bottom-nav-h'), ya resuelta por el
 * navegador (incluye `env(safe-area-inset-bottom)`). 0 si no existe.
 * @param {string} name
 * @returns {number}
 */
export function cssLengthPx(name) {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:var(${name}, 0px)`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}
