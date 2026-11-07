// Lo que depende del idioma en <head>: <html lang>, título, descripción, Open Graph / Twitter Card y
// el manifiesto de la PWA (uno por idioma, así el diálogo de instalación sale en el idioma de la
// app). index.html trae los valores en español; esto los pone al idioma activo y los mantiene al
// cambiarlo (los buscadores que ejecutan JS ven la versión del idioma de su navegador).
import { getT } from '../i18n/core.js';

/** @type {Record<import('../i18n/core.js').Lang, string>} */
export const MANIFEST_HREF = { es: '/manifest.webmanifest', en: '/manifest.en.webmanifest' };
/** @type {Record<import('../i18n/core.js').Lang, string>} */
export const OG_LOCALE = { es: 'es_ES', en: 'en_US' };

const setAttr = (doc, selector, attr, value) => doc.querySelector(selector)?.setAttribute(attr, value);

/**
 * @param {Document} doc
 * @param {import('../i18n/core.js').Lang} lang
 */
export function applyDocumentLang(doc, lang) {
  const t = getT(lang);
  const other = lang === 'es' ? 'en' : 'es';
  doc.documentElement.lang = lang;
  doc.title = t('seo.title');
  const description = t('seo.description');
  setAttr(doc, 'meta[name="description"]', 'content', description);
  for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) setAttr(doc, sel, 'content', t('seo.title'));
  for (const sel of ['meta[property="og:description"]', 'meta[name="twitter:description"]']) setAttr(doc, sel, 'content', description);
  setAttr(doc, 'meta[property="og:locale"]', 'content', OG_LOCALE[lang]);
  setAttr(doc, 'meta[property="og:locale:alternate"]', 'content', OG_LOCALE[other]);
  setAttr(doc, 'link[rel="manifest"]', 'href', MANIFEST_HREF[lang] ?? MANIFEST_HREF.es);
}
