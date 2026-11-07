import React, { useEffect, useId, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { TERMS_VERSION } from '../../shared/legal.js';

/**
 * Texto de la casilla de consentimiento con enlaces a los Términos y a la Política de privacidad
 * (se abren en otra pestaña para no perder una partida en curso).
 */
export function ConsentText() {
  const { t } = useI18n();
  const links = {
    '{terms}': <a key="terms" href={t('menu.termsHref')} target="_blank" rel="noopener" className="underline text-brand-700 dark:text-brand-300 hover:text-brand-600">{t('account.consent.terms')}</a>,
    '{privacy}': <a key="privacy" href={t('menu.privacyHref')} target="_blank" rel="noopener" className="underline text-brand-700 dark:text-brand-300 hover:text-brand-600">{t('account.consent.privacy')}</a>,
  };
  // Sin variables, t() deja los marcadores {terms} y {privacy} para cambiarlos por enlaces.
  return t('account.consent.label').split(/(\{terms\}|\{privacy\})/).map((part, i) => links[part] ?? <React.Fragment key={i}>{part}</React.Fragment>);
}

/**
 * Casilla obligatoria (nunca premarcada) antes de iniciar sesión: «Tengo 16 años o más y acepto…».
 * Controlada por el padre (checked / onChange).
 */
export function ConsentCheckbox({ checked, onChange, testId = 'consent-checkbox' }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-xs leading-snug text-ink-600 dark:text-ink-300">
      <input
        id={id}
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-brand-600"
      />
      <label htmlFor={id} className="min-w-0"><ConsentText /></label>
    </div>
  );
}

/**
 * Aviso a quien tiene cuenta pero no aceptó la versión vigente (cuenta anterior al consentimiento o
 * términos actualizados): aceptar, cerrar sesión o dejarlo para luego (la sincronización queda en pausa).
 */
export function ConsentDialog({ onAccept, onSignOut, onLater }) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const titleId = useId();
  const boxRef = useRef(null);

  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onLater();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLater]);

  const accept = async () => {
    setBusy(true);
    setError(false);
    const ok = await onAccept();
    if (!ok) {
      setBusy(false);
      setError(true);
    }
  };

  const ghost = 'rounded-xl bg-ink-100 dark:bg-ink-800 px-3 py-2 text-sm font-bold text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700 disabled:opacity-50';
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-ink-900/50 dark:bg-black/60 p-4">
      <div ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="consent-dialog"
        className="w-full max-w-md rounded-3xl bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100 shadow-2xl p-5 space-y-4 outline-none">
        <h2 id={titleId} className="flex items-center gap-2 text-lg font-black">
          <ShieldCheck size={20} className="text-brand-600 flex-shrink-0" aria-hidden="true" /> {t('account.consent.title')}
        </h2>
        <p className="text-sm text-ink-600 dark:text-ink-300">{t('account.consent.body', { version: TERMS_VERSION })}</p>
        <ConsentCheckbox checked={checked} onChange={setChecked} testId="consent-dialog-checkbox" />
        {error && <p role="alert" className="text-sm font-bold text-rose-700 dark:text-rose-300">{t('account.consent.error')}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" data-testid="consent-later" onClick={onLater} disabled={busy} className={ghost}>{t('account.consent.later')}</button>
          <button type="button" data-testid="consent-signout" onClick={onSignOut} disabled={busy} className={ghost}>{t('account.signOut')}</button>
          <button type="button" data-testid="consent-accept" onClick={accept} disabled={!checked || busy}
            className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold px-3 py-2 disabled:opacity-50">{t('account.consent.accept')}</button>
        </div>
      </div>
    </div>
  );
}
