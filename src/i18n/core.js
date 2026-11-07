// Núcleo de idiomas (sin React): detección, preferencia guardada, traductor `t` y formatos Intl.
// Ver docs/I18N.md. Lo usan tanto los componentes (vía useI18n) como las funciones puras
// (plantillas del coach, importación, generador de puzles, resumen), que reciben `lang` o `t`.

import es from './es.js';
import en from './en.js';

/** @typedef {'es'|'en'} Lang */
/** @typedef {'auto'|Lang} LangPref */
/** @typedef {(key: string, vars?: Record<string, unknown>) => string} TFunction */

/** Idiomas con diccionario. El español es el de referencia (textos originales). */
export const LANGS = /** @type {const} */ (['es', 'en']);
/** Idioma si el navegador no pide ninguno de los nuestros. */
export const FALLBACK_LANG = 'en';
/** Clave en localStorage de la elección manual ('es' | 'en'; sin valor = automático). */
export const LANG_KEY = 'escaque:lang';

export const DICTIONARIES = { es, en };

/** @param {unknown} x @returns {x is Lang} */
export const isLang = (x) => x === 'es' || x === 'en';

/**
 * Idioma según las preferencias del navegador: el primero que empiece por `es` o `en`
 * (`es-EC` → es, `en-GB` → en); si ninguno coincide, inglés.
 * @param {readonly string[] | undefined | null} languages  normalmente `navigator.languages`
 * @returns {Lang}
 */
export function detectLang(languages) {
  for (const raw of languages ?? []) {
    const base = String(raw ?? '').toLowerCase().split(/[-_]/)[0];
    if (isLang(base)) return base;
  }
  return FALLBACK_LANG;
}

/** Idiomas del navegador (o [] fuera del navegador). */
export function browserLanguages() {
  const nav = globalThis.navigator;
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages;
  return nav.language ? [nav.language] : [];
}

/**
 * @param {LangPref} pref
 * @param {readonly string[]} [languages]
 * @returns {Lang}
 */
export function resolveLang(pref, languages = browserLanguages()) {
  return isLang(pref) ? pref : detectLang(languages);
}

/** @returns {LangPref} */
export function readLangPref() {
  try {
    const v = globalThis.localStorage?.getItem(LANG_KEY);
    return isLang(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** @param {LangPref} pref */
export function writeLangPref(pref) {
  try {
    if (isLang(pref)) globalThis.localStorage?.setItem(LANG_KEY, pref);
    else globalThis.localStorage?.removeItem(LANG_KEY);
  } catch {
    // Sin almacenamiento: la elección dura la sesión.
  }
}

// --- Diccionarios ---------------------------------------------------------------------------

const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** Objeto de formas plurales: { one, other } (y opcionalmente zero/two/few/many). */
export const isPluralNode = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.other === 'string' &&
  Object.keys(v).every((k) => PLURAL_FORMS.includes(k));

/**
 * Aplana el diccionario a { 'menu.practice': valor }. Las hojas son textos, listas de textos o
 * nodos de plural ({ one, other }).
 * @param {Record<string, unknown>} dict
 * @returns {Record<string, string | string[] | Record<string, string>>}
 */
export function flatten(dict, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || Array.isArray(v) || isPluralNode(v)) out[key] = v;
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

const FLAT = { es: flatten(es), en: flatten(en) };
const pluralRules = {};
const pluralFor = (lang) => (pluralRules[lang] ??= new Intl.PluralRules(lang));

/** Sustituye `{nombre}` por vars.nombre (si no está, deja el marcador tal cual). */
export function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined || vars[name] === null ? m : String(vars[name])));
}

/**
 * Valor crudo de una clave (texto, lista o plural), con respaldo al español y luego `undefined`.
 * Útil para listas de variantes (p. ej. frases del coach).
 * @param {Lang} lang @param {string} key
 */
export function lookup(lang, key) {
  return FLAT[lang]?.[key] ?? FLAT.es[key];
}

/**
 * Traductor para un idioma. `t('summary.moves', { n: 3 })`: si el valor es un plural, elige la
 * forma con Intl.PluralRules según `vars.n` (o `vars.count`). Las listas devuelven su primer
 * elemento (usar `lookup` para tenerlas todas). Clave inexistente → la propia clave.
 * @param {Lang} lang
 * @returns {TFunction}
 */
export function createT(lang) {
  const l = isLang(lang) ? lang : FALLBACK_LANG;
  const t = (key, vars) => {
    let v = lookup(l, key);
    if (v === undefined) return key;
    if (Array.isArray(v)) v = v[0] ?? '';
    else if (typeof v === 'object') {
      const n = Number(vars?.n ?? vars?.count ?? 0);
      v = v[pluralFor(l).select(n)] ?? v.other;
    }
    return interpolate(v, vars);
  };
  t.lang = l;
  return t;
}

const translators = {};
/** Traductor en caché por idioma. @param {Lang} lang @returns {TFunction} */
export const getT = (lang) => (translators[lang] ??= createT(lang));

// --- Formatos -------------------------------------------------------------------------------

/** Número con separadores del idioma. */
export const formatNumber = (lang, n, opts) => new Intl.NumberFormat(lang, opts).format(n);

/** Fecha corta ("2 nov 2026" / "Nov 2, 2026"). */
export const formatDate = (lang, ms, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(ms).toLocaleDateString(lang, opts);

/** Fecha y hora cortas. */
export const formatDateTime = (lang, ms) =>
  new Date(ms).toLocaleString(lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Duración en unidades del idioma con Intl.NumberFormat ("1 h 3 min", "45 s" / "1 hr 3 min",
 * "45 sec"). Para relojes se sigue usando el formato neutro "4:05" (coach/summary.js).
 * @param {Lang} lang @param {number} ms
 */
export function formatDuration(lang, ms) {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (value, u) => new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value);
  const parts = [];
  if (h) parts.push(unit(h, 'hour'));
  if (m || (h && s)) parts.push(unit(m, 'minute'));
  if (s || !parts.length) parts.push(unit(s, 'second'));
  return parts.join(' ');
}
