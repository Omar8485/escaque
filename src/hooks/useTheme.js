import { useCallback, useEffect, useState } from 'react';

/** Clave en localStorage. index.html la lee antes de cargar React para evitar el parpadeo. */
export const THEME_KEY = 'coach-chess:theme';

/** Color de la barra del navegador / de la ventana instalada (ink-50 y ink-950 de la paleta). */
export const THEME_COLORS = { light: '#faf6f0', dark: '#14110e' };

function readTheme() {
  try {
    return globalThis.localStorage?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Tema claro/oscuro de la app (Tailwind `darkMode: 'class'`): pone o quita la clase `dark` en
 * <html> y recuerda la elección. Por defecto, claro.
 * @returns {{theme: 'light'|'dark', toggleTheme: () => void}}
 */
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
    try {
      globalThis.localStorage?.setItem(THEME_KEY, theme);
    } catch {
      // Sin almacenamiento: el tema dura la sesión.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggleTheme };
}
