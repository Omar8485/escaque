import { useSyncExternalStore } from 'react';
import { getState, subscribe } from './pwa.js';

/** Estado de la PWA (versión nueva, instalación). Ver src/pwa/pwa.js. @returns {import('./pwa.js').PwaState} */
export function usePwa() {
  return useSyncExternalStore(subscribe, getState, getState);
}
