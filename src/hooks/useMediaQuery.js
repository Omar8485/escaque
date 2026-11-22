import { useCallback, useSyncExternalStore } from 'react';

/**
 * true mientras la media query se cumpla (se actualiza al redimensionar o al hacer zoom).
 * @param {string} query  p. ej. '(min-width: 1280px)'
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const mql = globalThis.matchMedia?.(query);
      mql?.addEventListener('change', onChange);
      return () => mql?.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => Boolean(globalThis.matchMedia?.(query).matches), () => false);
}
