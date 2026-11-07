// Plugin de Vite con lo que depende de la URL pública y de la configuración de publicación:
//  - SITE_URL (src/appInfo.js o VITE_SITE_URL): reemplaza %SITE_URL% en index.html, la expone a la
//    app como import.meta.env.VITE_SITE_URL y genera robots.txt y sitemap.xml.
//  - CONTACT_EMAIL (src/appInfo.js o VITE_CONTACT_EMAIL): lo pone en las páginas legales de dist/.
//  - Cloudflare Web Analytics (VITE_CF_ANALYTICS_TOKEN; por defecto desactivada): con token, añade
//    el script a index.html y deja en la política de privacidad el párrafo que lo explica.
//  - FEEDBACK_URL (VITE_FEEDBACK_URL): solo se expone a la app (enlace del menú).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_CF_ANALYTICS_TOKEN, DEFAULT_CONTACT_EMAIL, DEFAULT_CONTROLLER_NAME, DEFAULT_FEEDBACK_URL, DEFAULT_SITE_URL } from '../src/appInfo.js';

/** Normaliza la URL pública: sin barra final; error si no es http(s). */
export function normalizeSiteUrl(raw) {
  const url = String(raw || DEFAULT_SITE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/.test(url)) throw new Error(`SITE_URL no válida: "${raw}"`);
  return url;
}

export function robotsTxt(siteUrl) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

/**
 * Páginas públicas que se listan en sitemap.xml (la app es una sola página; más las legales). Sin
 * `.html`: es la URL final en Cloudflare, que redirige `/x.html` → `/x` (y Vite sirve las dos).
 */
// Las páginas legales no se indexan (meta robots noindex), así que no van en el sitemap.
export const SITEMAP_PATHS = ['/', '/licencias', '/licenses'];

export function sitemapXml(siteUrl, paths = SITEMAP_PATHS) {
  const urls = paths.map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Páginas legales (public/) que se completan al terminar el build. */
export const LEGAL_PAGES = ['privacidad.html', 'privacy.html', 'terminos.html', 'terms.html'];

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Token de Cloudflare Web Analytics válido ('' si no hay). */
export function normalizeAnalyticsToken(raw) {
  const token = String(raw || '').trim();
  if (token && !/^[A-Za-z0-9_-]{8,128}$/.test(token)) throw new Error('VITE_CF_ANALYTICS_TOKEN no válido');
  return token;
}

/**
 * Etiqueta del script de Cloudflare Web Analytics. `crossorigin`: con COEP require-corp (Stockfish),
 * un script de otro origen solo carga en modo CORS. Si el navegador lo bloquea, la app sigue igual.
 */
export function analyticsTag(token) {
  return {
    tag: 'script',
    attrs: {
      defer: true,
      crossorigin: 'anonymous',
      src: 'https://static.cloudflareinsights.com/beacon.min.js',
      'data-cf-beacon': JSON.stringify({ token }),
    },
    injectTo: 'body',
  };
}

/**
 * Completa una página legal: el correo de contacto (o un aviso "pendiente" bien visible), el nombre
 * del responsable (VITE_CONTROLLER_NAME; si falta, «el titular de Escaque») y el párrafo de analítica
 * que corresponda (bloques <!--analytics:on--> / <!--analytics:off-->).
 * @param {string} html
 * @param {{contactEmail?: string, controllerName?: string, lang?: 'es'|'en', analytics?: boolean}} opts
 */
export function renderLegalPage(html, { contactEmail = '', controllerName = '', lang = 'es', analytics = false } = {}) {
  const name = String(controllerName || '').trim();
  const controller = escapeHtml(name || (lang === 'en' ? 'the owner of Escaque' : 'el titular de Escaque'));
  const email = String(contactEmail || '').trim();
  const contact = email
    ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
    : `<mark>CONTACT_EMAIL — ${lang === 'en' ? 'pending' : 'pendiente de completar'}</mark>`;
  const block = (name) => new RegExp(`[ \\t]*<!--analytics:${name}-->[\\s\\S]*?<!--/analytics:${name}-->\\n?`, 'g');
  let out = html.replaceAll('<span class="contact">%CONTACT_EMAIL%</span>', contact)
    .replaceAll('<span class="controller">%CONTROLLER%</span>', controller);
  if (analytics) {
    out = out.replace(block('off'), '').replace(/<div data-analytics hidden>/g, '<div data-analytics>');
  } else {
    out = out.replace(block('on'), '');
  }
  return out.replace(/<!--\/?analytics:(on|off)-->\n?/g, '');
}

/**
 * @param {{siteUrl?: string, contactEmail?: string, analyticsToken?: string, feedbackUrl?: string}} options
 *   valores ya leídos del entorno (vite.config.js)
 * @returns {import('vite').Plugin}
 */
export function escaqueSite({
  siteUrl,
  contactEmail = DEFAULT_CONTACT_EMAIL,
  controllerName = DEFAULT_CONTROLLER_NAME,
  analyticsToken = DEFAULT_CF_ANALYTICS_TOKEN,
  feedbackUrl = DEFAULT_FEEDBACK_URL,
} = {}) {
  const url = normalizeSiteUrl(siteUrl);
  const token = normalizeAnalyticsToken(analyticsToken);
  const feedback = String(feedbackUrl || '').trim();
  if (feedback && !/^(https?:\/\/|mailto:)/.test(feedback)) throw new Error(`VITE_FEEDBACK_URL no válida: "${feedback}"`);
  let outDir = 'dist';
  return {
    name: 'escaque-site',
    config: () => ({
      define: {
        'import.meta.env.VITE_SITE_URL': JSON.stringify(url),
        'import.meta.env.VITE_CONTACT_EMAIL': JSON.stringify(contactEmail || ''),
        'import.meta.env.VITE_FEEDBACK_URL': JSON.stringify(feedback),
      },
    }),
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: (html) => ({
      html: html.replaceAll('%SITE_URL%', url),
      tags: token ? [analyticsTag(token)] : [],
    }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(url) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(url) });
    },
    // Las páginas legales vienen de public/ (Vite las copia tal cual): se completan ya en dist/.
    closeBundle() {
      for (const file of LEGAL_PAGES) {
        const path = join(outDir, file);
        if (!existsSync(path)) continue;
        const lang = /privacy|terms/.test(file) ? 'en' : 'es';
        writeFileSync(path, renderLegalPage(readFileSync(path, 'utf8'), { contactEmail, controllerName, lang, analytics: Boolean(token) }));
      }
    },
  };
}
