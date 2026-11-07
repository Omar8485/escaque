import { describe, expect, it } from 'vitest';
import { applyDocumentLang } from './documentMeta.js';
import { getT } from '../i18n/core.js';

/** Documento mínimo: lo justo de <head> que toca applyDocumentLang. */
function fakeDoc() {
  const nodes = {};
  const el = () => {
    const attrs = {};
    return { setAttribute: (k, v) => (attrs[k] = v), getAttribute: (k) => attrs[k] };
  };
  for (const sel of [
    'meta[name="description"]', 'meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[property="og:description"]',
    'meta[name="twitter:description"]', 'meta[property="og:locale"]', 'meta[property="og:locale:alternate"]', 'link[rel="manifest"]',
  ]) nodes[sel] = el();
  return { documentElement: {}, title: '', querySelector: (s) => nodes[s] ?? null, nodes };
}

describe('applyDocumentLang', () => {
  it('pone lang, título, descripción, Open Graph y manifiesto del idioma', () => {
    for (const lang of ['es', 'en']) {
      const doc = fakeDoc();
      applyDocumentLang(doc, lang);
      const t = getT(lang);
      expect(doc.documentElement.lang).toBe(lang);
      expect(doc.title).toBe(t('seo.title'));
      expect(doc.nodes['meta[name="description"]'].getAttribute('content')).toBe(t('seo.description'));
      expect(doc.nodes['meta[name="twitter:description"]'].getAttribute('content')).toBe(t('seo.description'));
      expect(doc.nodes['meta[property="og:locale"]'].getAttribute('content')).toBe(lang === 'es' ? 'es_ES' : 'en_US');
      expect(doc.nodes['link[rel="manifest"]'].getAttribute('href')).toBe(lang === 'es' ? '/manifest.webmanifest' : '/manifest.en.webmanifest');
    }
  });
});
