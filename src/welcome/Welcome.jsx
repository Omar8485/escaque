import React, { useEffect, useRef } from 'react';
import { X, MessageCircleWarning, Swords, Download, TrendingUp, ShieldCheck, Play } from 'lucide-react';
import Logo from '../components/Logo';
import { APP_NAME } from '../appInfo';
import { useI18n } from '../i18n/useI18n';

const POINTS = [
  { icon: MessageCircleWarning, key: 'coach' },
  { icon: Swords, key: 'rivals' },
  { icon: Download, key: 'import' },
  { icon: TrendingUp, key: 'progress' },
];

/**
 * Bienvenida: qué es Escaque, en una tarjeta. Sale en la primera visita y desde "Acerca de" en el
 * menú. Cerrar (✕, Esc o clic fuera) también cuenta como vista.
 */
export default function Welcome({ onStart, onImport, onClose }) {
  const { t } = useI18n();
  const startRef = useRef(null);
  useEffect(() => {
    startRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-ink-900/40 dark:bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        data-testid="welcome"
        className="relative w-full max-w-xl max-h-full overflow-y-auto rounded-3xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 shadow-2xl p-6 sm:p-8"
      >
        <button
          type="button"
          data-testid="welcome-close"
          aria-label={t('common.close')}
          onClick={onClose}
          className="absolute top-3 right-3 p-2 rounded-lg bg-transparent text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
        >
          <X size={18} />
        </button>
        <div className="flex items-center gap-3 mb-4">
          <Logo size={48} />
          <div>
            <h2 id="welcome-title" className="text-2xl font-black tracking-tight text-ink-900 dark:text-ink-50">
              {t('welcome.title', { app: APP_NAME })}
            </h2>
            <p className="text-sm text-ink-500 dark:text-ink-400">{t('welcome.subtitle')}</p>
          </div>
        </div>
        <ul className="space-y-3 mb-5">
          {POINTS.map((point) => (
            <li key={point.key} className="flex gap-3 text-sm text-ink-700 dark:text-ink-200 leading-snug">
              <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-300">
                <point.icon size={16} />
              </span>
              <span>
                <strong className="text-ink-900 dark:text-ink-50">{t(`welcome.points.${point.key}.title`)}</strong>{' '}
                {t(`welcome.points.${point.key}.text`)}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 text-xs text-ink-500 dark:text-ink-400 mb-6">
          <ShieldCheck size={16} className="flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{t('welcome.private')}</span>
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            ref={startRef}
            type="button"
            data-testid="welcome-start"
            onClick={onStart}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white font-bold px-4 py-3"
          >
            <Play size={18} />
            {t('welcome.start')}
          </button>
          <button
            type="button"
            data-testid="welcome-import"
            onClick={onImport}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-800 text-ink-700 dark:text-ink-100 hover:bg-ink-50 dark:hover:bg-ink-700 font-bold px-4 py-3"
          >
            <Download size={18} />
            {t('welcome.import')}
          </button>
        </div>
      </div>
    </div>
  );
}
