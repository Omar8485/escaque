import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Share, Info, MessageSquarePlus } from 'lucide-react';
import Logo from './Logo';
import { APP_NAME, FEEDBACK_URL } from '../appInfo';
import { useI18n } from '../i18n/useI18n';
import { detectLang, browserLanguages } from '../i18n/core';
import { usePwa } from '../pwa/usePwa';
import { promptInstall } from '../pwa/pwa';
import AccountSection from '../account/AccountSection';

/** Estilo de los enlaces del pie del menú. */
const LINK = 'hover:text-brand-600 underline-offset-2 hover:underline';

/** Tiempo que el ratón debe quedarse en el borde para abrir el menú (evita aperturas al pasar). */
const EDGE_DWELL_MS = 150;

// Menú lateral tipo hamburguesa: oculto por defecto para dejar todo el ancho al tablero.
// Se abre con el botón ☰ de la cabecera (modo 'click') o al acercar el ratón al borde izquierdo
// de la pantalla (modo 'hover'). Se cierra al elegir una opción, al hacer clic fuera, con Esc o,
// si se abrió con el ratón, al sacar el ratón del menú.
const SideMenu = ({ items, activeTab, onSelect, open, mode, onOpen, onClose, practiceAlert = false, onAbout, gameInProgress = false }) => {
  const { t, pref, setPref } = useI18n();
  const pwa = usePwa();
  const [iosHelp, setIosHelp] = useState(false);
  const dwellRef = useRef(null);
  const cancelDwell = () => clearTimeout(dwellRef.current);
  useEffect(() => () => clearTimeout(dwellRef.current), []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Zona sensible del borde izquierdo (solo con el menú cerrado) */}
      {!open && (
        <div
          data-testid="menu-edge"
          aria-hidden="true"
          className="fixed left-0 top-0 h-full w-2 z-40"
          onMouseEnter={() => {
            cancelDwell();
            dwellRef.current = setTimeout(() => onOpen('hover'), EDGE_DWELL_MS);
          }}
          onMouseLeave={cancelDwell}
        />
      )}

      {/* Fondo oscurecido solo si se abrió con ☰ (clic fuera = cerrar). Abierto con el ratón no
          bloquea nada: se cierra al sacar el ratón del menú. */}
      {open && mode === 'click' && (
        <div
          data-testid="menu-backdrop"
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-ink-900/30 dark:bg-black/50"
        />
      )}

      <nav
        data-testid="side-menu"
        data-open={open ? 'true' : 'false'}
        aria-label={t('menu.main')}
        aria-hidden={!open}
        inert={!open}
        onMouseLeave={() => mode === 'hover' && onClose()}
        className={`fixed left-0 top-0 h-full w-64 z-50 bg-white dark:bg-ink-900 border-r border-ink-200 dark:border-ink-700 shadow-2xl flex flex-col py-5 overflow-y-auto overflow-x-hidden transition-transform duration-200 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between px-5 mb-6">
          <div className="flex items-center gap-2 min-w-0">
            <Logo size={40} />
            <span data-testid="app-name" className="font-black text-xl tracking-tight text-ink-800 dark:text-ink-100 truncate">{APP_NAME}</span>
          </div>
          <button
            type="button"
            aria-label={t('menu.close')}
            onClick={onClose}
            className="p-2 bg-transparent rounded-lg text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 flex flex-col gap-2">
          {items.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                data-testid={`nav-${item.id}`}
                onClick={() => onSelect(item.id)}
                className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${active ? 'bg-ink-900 dark:bg-brand-600 text-white shadow-xl' : 'bg-transparent text-ink-500 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800 hover:text-brand-600'}`}
              >
                <item.icon size={22} className={active ? 'text-brand-400 dark:text-brand-200' : ''} />
                <span className="font-bold">{t(item.labelKey)}</span>
                {item.id === 'practice' && practiceAlert && (
                  <span title={t('menu.gameInProgress')} className="ml-auto w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
        {/* Instalar como app: botón si el navegador lo ofrece (beforeinstallprompt); en iPhone/iPad,
            instrucciones (Safari no tiene ese evento). Oculto si ya se abrió instalada. */}
        {!pwa.installed && (pwa.canInstall || pwa.ios) && (
          <div className="px-4 pt-3">
            <button
              type="button"
              data-testid="install-app"
              onClick={() => (pwa.canInstall ? promptInstall() : setIosHelp((v) => !v))}
              aria-expanded={pwa.canInstall ? undefined : iosHelp}
              className="w-full flex items-center gap-4 px-4 py-2.5 rounded-2xl border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/60 text-brand-700 dark:text-brand-200 hover:bg-brand-100 dark:hover:bg-brand-900/60 font-bold"
            >
              <Download size={20} />
              <span>{t('pwa.install')}</span>
            </button>
            {iosHelp && !pwa.canInstall && (
              <p data-testid="install-ios-help" className="mt-2 px-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                <Share size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                {t('pwa.iosHelp')}
              </p>
            )}
          </div>
        )}
        {/* Cuenta opcional (Premium y sincronización); sin cuenta todo sigue en este navegador. */}
        <AccountSection gameInProgress={gameInProgress} />
        {/* Idioma: automático (navegador) o elección manual; se recuerda en el navegador. */}
        <div className="px-5 pt-5">
          <label htmlFor="lang-select" className="block text-xs font-bold uppercase tracking-wider text-ink-400 dark:text-ink-500 mb-1">
            {t('lang.label')}
          </label>
          <select
            id="lang-select"
            data-testid="lang-select"
            value={pref}
            onChange={(e) => setPref(e.target.value)}
            className="w-full rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-800 text-ink-700 dark:text-ink-200 text-sm font-medium px-3 py-2"
          >
            <option value="auto">{t('lang.autoHint', { lang: t(`lang.${detectLang(browserLanguages())}`) })}</option>
            <option value="es">{t('lang.es')}</option>
            <option value="en">{t('lang.en')}</option>
          </select>
        </div>
        {/* Acerca de (vuelve a mostrar la bienvenida) y enlaces legales. */}
        <div className="px-5 pt-4 pb-2 flex flex-col items-start gap-1.5 text-xs text-ink-400 dark:text-ink-500">
          {onAbout && (
            <button
              type="button"
              data-testid="menu-about"
              onClick={onAbout}
              className="flex items-center gap-1.5 p-0 bg-transparent text-xs font-semibold text-ink-500 dark:text-ink-400 hover:text-brand-600 underline-offset-2 hover:underline"
            >
              <Info size={14} />
              {t('menu.about')}
            </button>
          )}
          {/* Comentarios: solo si hay FEEDBACK_URL (src/appInfo.js / VITE_FEEDBACK_URL). */}
          {FEEDBACK_URL && (
            <a
              data-testid="menu-feedback"
              href={FEEDBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 dark:text-ink-400 hover:text-brand-600 underline-offset-2 hover:underline"
            >
              <MessageSquarePlus size={14} />
              {t('menu.feedback')}
            </a>
          )}
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            <a data-testid="menu-privacy" href={t('menu.privacyHref')} className={LINK}>
              {t('menu.privacy')}
            </a>
            <a data-testid="menu-terms" href={t('menu.termsHref')} className={LINK}>
              {t('menu.terms')}
            </a>
          </span>
          <a href={t('menu.licensesHref')} className={LINK}>
            {t('menu.licenses')}
          </a>
        </div>
      </nav>
    </>
  );
};

export default SideMenu;
