import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEGAL_PAGES, analyticsTag, escaqueSite, normalizeAnalyticsToken, normalizeSiteUrl, renderLegalPage, robotsTxt, sitemapXml } from './site.js';
import { DEFAULT_CONTACT_EMAIL, DEFAULT_SITE_URL, SITE_URL } from '../src/appInfo.js';
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '../shared/legal.js';
import { lookup } from '../src/i18n/core.js';

describe('SITE_URL', () => {
  it('sin configurar usa el valor por defecto de src/appInfo.js, sin barra final', () => {
    expect(normalizeSiteUrl(undefined)).toBe(DEFAULT_SITE_URL);
    expect(normalizeSiteUrl('https://escaque.app/')).toBe('https://escaque.app');
    expect(SITE_URL.endsWith('/')).toBe(false);
  });
  it('rechaza valores que no son URL http(s)', () => {
    expect(() => normalizeSiteUrl('escaque.app')).toThrow();
  });
  it('robots.txt y sitemap.xml apuntan a la URL pública', () => {
    expect(robotsTxt('https://x.dev')).toContain('Sitemap: https://x.dev/sitemap.xml');
    const xml = sitemapXml('https://x.dev');
    expect(xml).toContain('<loc>https://x.dev/</loc>');
    expect(xml).toContain('<loc>https://x.dev/licencias</loc>');
    expect(xml).not.toContain('privacidad'); // páginas legales: noindex, fuera del sitemap
  });
});

describe('páginas legales', () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  it('versión vigente (shared/legal.js), sin marca de borrador, con el responsable y el contacto', () => {
    for (const f of LEGAL_PAGES) {
      const html = read(f);
      expect(html, f).not.toMatch(/Borrador|Draft|pendiente de revisión|pending legal review|<mark>/);
      expect(html, f).toContain(`data-legal-version="${TERMS_VERSION}"`);
      expect(html, f).toMatch(f.endsWith('privacy.html') || f === 'terms.html'
        ? new RegExp(`Version ${TERMS_VERSION.replace('.', '\\.')} · Effective from 7 November 2026`)
        : new RegExp(`Versión ${TERMS_VERSION.replace('.', '\\.')} · Vigente desde el 7 de noviembre de 2026`));
      expect(TERMS_EFFECTIVE_DATE).toBe('2026-11-07');
      expect(html, f).toContain('<span class="controller">%CONTROLLER%</span>');
      expect(html, f).toContain('<meta name="robots" content="noindex">');
      expect(html, f).toContain('Quito, Ecuador');
      expect(html, f).toContain('<span class="contact">%CONTACT_EMAIL%</span>');
      expect(html, f).toMatch(/hreflang="(es|en)"/);
    }
  });
  it('privacidad: LOPDP/RGPD, cuenta desde 16 años, transferencias, cookies, derechos y plazos', () => {
    for (const [f, must] of [
      ['privacidad.html', ['LOPDP', 'RGPD', '16 años o más', 'consentimiento explícito', 'Cloudflare, Inc.', 'Polar Software, Inc.', 'Google LLC', 'Microsoft Corporation', 'Lichess', 'Chess.com', 'Transferencias internacionales', 'arts. 33', '__Host-escaque_sid', '__Host-escaque_oidc', '15 días', 'Superintendencia de Protección de Datos Personales', 'Borrar mis datos sincronizados del servidor', 'Borrar mi cuenta', 'recompensas', '30 días', 'art. 43']],
      ['privacy.html', ['LOPDP', 'GDPR', '16 or older', 'explicit consent', 'Cloudflare, Inc.', 'Polar Software, Inc.', 'Google LLC', 'Microsoft Corporation', 'Lichess', 'Chess.com', 'International transfers', 'arts. 33', '__Host-escaque_sid', '__Host-escaque_oidc', '15 days', 'Superintendencia de Protección de Datos Personales', 'Delete my synced data from the server', 'Delete my account', 'rewards', '30 days', 'art. 43']],
    ]) {
      const html = read(f);
      for (const text of must) expect(html, `${f}: ${text}`).toContain(text);
    }
  });
  it('términos: Polar como comerciante registrado, reembolsos de 14 días, Fundador, GPLv3 y ley de Ecuador', () => {
    for (const [f, must] of [
      ['terminos.html', ['comerciante registrado', 'https://polar.sh/legal/checkout-buyer-terms', 'se renuevan automáticamente', 'id="reembolsos"', '14 días', 'id="fundador"', 'durante la vida del servicio Escaque', 'intransferible', '500', '90 días', '12 meses anteriores', 'reembolso proporcional', 'GPLv3', 'https://github.com/Omar8485/escaque', '/licencias.html', 'República del Ecuador', 'Quito', 'derechos irrenunciables', '16 años o más']],
      ['terms.html', ['merchant of record', 'https://polar.sh/legal/checkout-buyer-terms', 'renew automatically', 'id="refunds"', '14 days', 'id="founder"', 'for the life of the Escaque service', 'non-transferable', '500', '90 days', '12 months before', 'pro-rata refund', 'GPLv3', 'https://github.com/Omar8485/escaque', '/licenses.html', 'Republic of Ecuador', 'Quito', 'non-waivable rights', '16 or older']],
    ]) {
      const html = read(f);
      for (const text of must) expect(html, `${f}: ${text}`).toContain(text);
    }
  });
  it('el ancla de reembolsos que enlaza la pantalla Premium existe en cada idioma', () => {
    expect(read('terminos.html')).toContain(`id="${lookup('es', 'premium.refundAnchor')}"`);
    expect(read('terms.html')).toContain(`id="${lookup('en', 'premium.refundAnchor')}"`);
  });
  it('sin correo configurado: aviso visible; con correo: enlace mailto', () => {
    const html = read('privacidad.html');
    const pending = renderLegalPage(html, { lang: 'es' });
    expect(pending).not.toContain('%CONTACT_EMAIL%');
    expect(pending).toContain('<mark>CONTACT_EMAIL — pendiente de completar</mark>');
    const done = renderLegalPage(html, { contactEmail: 'hola@escaque.app' });
    expect(done).toContain('<a href="mailto:hola@escaque.app">hola@escaque.app</a>');
    expect(DEFAULT_CONTACT_EMAIL).toBe('escaque.ec@gmail.com');
    expect(renderLegalPage(html, { contactEmail: DEFAULT_CONTACT_EMAIL })).toContain('mailto:escaque.ec@gmail.com');
    expect(renderLegalPage(read('terms.html'), { lang: 'en' })).toContain('CONTACT_EMAIL — pending');
  });
});

describe('analítica opcional', () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  it('por defecto desactivada: index.html sin script y la política dice que no hay analítica', () => {
    const plugin = escaqueSite();
    expect(plugin.transformIndexHtml('<html>%SITE_URL%</html>').tags).toEqual([]);
    const html = renderLegalPage(read('privacidad.html'), { lang: 'es' });
    expect(html).toContain('Esta versión no usa ninguna herramienta de analítica.');
    expect(html).not.toContain('Cloudflare Web Analytics');
    expect(html).not.toContain('analytics:');
  });
  it('con token: script de Cloudflare (CORS por COEP) y párrafo visible en la política', () => {
    const plugin = escaqueSite({ analyticsToken: 'abc123def456' });
    const [tag] = plugin.transformIndexHtml('<html></html>').tags;
    expect(tag).toEqual(analyticsTag('abc123def456'));
    expect(tag.attrs.crossorigin).toBe('anonymous');
    expect(JSON.parse(tag.attrs['data-cf-beacon'])).toEqual({ token: 'abc123def456' });
    for (const [f, lang] of [['privacidad.html', 'es'], ['privacy.html', 'en']]) {
      const html = renderLegalPage(read(f), { lang, analytics: true });
      expect(html, f).toContain('Cloudflare Web Analytics');
      expect(html, f).toContain('<div data-analytics>');
      expect(html, f).not.toContain('data-no-analytics');
    }
  });
  it('rechaza tokens raros y URLs de comentarios no http(s)/mailto', () => {
    expect(normalizeAnalyticsToken('')).toBe('');
    expect(() => normalizeAnalyticsToken('"><script>')).toThrow();
    expect(() => escaqueSite({ feedbackUrl: 'javascript:alert(1)' })).toThrow();
    expect(() => escaqueSite({ feedbackUrl: 'https://github.com/x/y/issues' })).not.toThrow();
  });
});

describe('nombre del responsable fuera del repositorio', () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  it('se inserta en el build desde VITE_CONTROLLER_NAME; sin él, «el titular de Escaque»', () => {
    const es = read('privacidad.html');
    const en = read('privacy.html');
    expect(renderLegalPage(es, { contactEmail: 'a@b.c', controllerName: 'Nombre <Prueba>', lang: 'es' })).toContain('<strong>Nombre &lt;Prueba&gt;</strong>');
    expect(renderLegalPage(es, { contactEmail: 'a@b.c', lang: 'es' })).toContain('<strong>el titular de Escaque</strong>');
    expect(renderLegalPage(en, { contactEmail: 'a@b.c', lang: 'en' })).toContain('<strong>the owner of Escaque</strong>');
    expect(renderLegalPage(es, { contactEmail: 'a@b.c', lang: 'es' })).not.toContain('%CONTROLLER%');
  });
});
