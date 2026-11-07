import React from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

/** Relleno mientras llega una pantalla diferida (React.lazy + Suspense). */
export default function ScreenLoading({ compact = false }) {
  const { t } = useI18n();
  return (
    <div role="status" data-testid="screen-loading" className={`flex items-center justify-center gap-2 text-ink-400 dark:text-ink-500 text-sm ${compact ? 'py-3' : 'flex-1 py-16'}`}>
      <Loader2 size={18} className="animate-spin" />
      <span>{t('common.loading')}</span>
    </div>
  );
}
