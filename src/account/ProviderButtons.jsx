import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { ConsentCheckbox } from './Consent';
import { TERMS_VERSION } from '../../shared/legal.js';

/**
 * Botones «Iniciar sesión con …» de los proveedores configurados en el servidor, con la casilla de
 * consentimiento obligatoria (no premarcada): sin marcarla los botones están deshabilitados. Al
 * pulsar, `onLogin(proveedor, versión aceptada)`; el Worker registra esa versión al crear la cuenta.
 */
export default function ProviderButtons({ providers, onLogin, testPrefix = 'login' }) {
  const { t } = useI18n();
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <ConsentCheckbox checked={agreed} onChange={setAgreed} testId={`${testPrefix}-consent`} />
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          data-testid={`${testPrefix}-${p}`}
          disabled={!agreed}
          aria-describedby={agreed ? undefined : `${testPrefix}-consent-needed`}
          onClick={() => agreed && onLogin(p, TERMS_VERSION)}
          className="w-full flex items-center gap-2 rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-800 px-3 py-2 text-sm font-bold text-ink-700 dark:text-ink-100 hover:bg-ink-50 dark:hover:bg-ink-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-ink-800"
        >
          <LogIn size={16} className="flex-shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
          <span className="min-w-0 truncate">{t('account.signInWith', { provider: t(`account.provider.${p}`) })}</span>
        </button>
      ))}
      {!agreed && <p id={`${testPrefix}-consent-needed`} className="text-xs text-ink-500 dark:text-ink-400">{t('account.consent.needed')}</p>}
    </div>
  );
}
