import React, { useEffect, useMemo, useState } from 'react';
import { I18nContext } from './context.js';
import { browserLanguages, getT, readLangPref, resolveLang, writeLangPref } from './core.js';
import { applyDocumentLang } from '../seo/documentMeta.js';

/**
 * Proveedor del idioma: lee la elección guardada (o el navegador), la expone con `t` y mantiene
 * `<html lang>` (y el manifiesto, título y descripción: src/seo/documentMeta.js) al día. Cambiar el idioma re-renderiza toda la app al instante.
 */
export default function I18nProvider({ children, initialPref }) {
  const [pref, setPrefState] = useState(() => initialPref ?? readLangPref());
  // El navegador puede cambiar sus idiomas con la app abierta (evento `languagechange`).
  const [browserLangs, setBrowserLangs] = useState(browserLanguages);
  useEffect(() => {
    const onChange = () => setBrowserLangs(browserLanguages());
    window.addEventListener('languagechange', onChange);
    return () => window.removeEventListener('languagechange', onChange);
  }, []);

  const lang = resolveLang(pref, browserLangs);
  useEffect(() => {
    applyDocumentLang(document, lang);
  }, [lang]);

  const value = useMemo(
    () => ({
      lang,
      pref,
      t: getT(lang),
      setPref: (next) => {
        writeLangPref(next);
        setPrefState(next);
      },
    }),
    [lang, pref],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
