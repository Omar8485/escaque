import { createContext } from 'react';
import { getT } from './core.js';

/**
 * @typedef {object} I18nValue
 * @property {import('./core.js').Lang} lang       idioma activo
 * @property {import('./core.js').LangPref} pref   elección del usuario ('auto' = navegador)
 * @property {(pref: import('./core.js').LangPref) => void} setPref
 * @property {import('./core.js').TFunction} t
 */

/** Sin proveedor (p. ej. en pruebas de componentes sueltos): español, sin selector. */
export const I18nContext = createContext(/** @type {I18nValue} */ ({
  lang: 'es',
  pref: 'es',
  setPref: () => {},
  t: getT('es'),
}));
