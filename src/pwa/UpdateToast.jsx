import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { usePwa } from './usePwa';
import { applyUpdate } from './pwa';

/**
 * Aviso no bloqueante de versión nueva (abajo a la derecha). "Actualizar" activa el SW que espera y
 * recarga; cerrar lo oculta hasta la próxima visita (la versión nueva se aplica al cerrar todas las
 * pestañas de Escaque).
 */
export default function UpdateToast() {
  const { t } = useI18n();
  const { updateReady } = usePwa();
  const [dismissed, setDismissed] = useState(false);
  if (!updateReady || dismissed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="update-toast"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-[70] flex items-center gap-3 rounded-2xl bg-ink-900 dark:bg-ink-800 text-white text-sm font-semibold pl-4 pr-2 py-2 shadow-2xl border border-ink-700"
    >
      <span className="flex-1 min-w-0">{t('pwa.updateAvailable')}</span>
      <button
        type="button"
        data-testid="update-apply"
        onClick={applyUpdate}
        className="flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 font-bold"
      >
        <RefreshCw size={14} />
        {t('pwa.update')}
      </button>
      <button
        type="button"
        aria-label={t('common.closeNotice')}
        onClick={() => setDismissed(true)}
        className="p-1.5 rounded-lg bg-transparent text-ink-400 hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
