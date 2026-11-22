import React from 'react';
import { Sparkles } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { openPremium } from './planStore';

/**
 * Aviso amable de un límite del plan gratuito, con «Hazte Premium». Nunca interrumpe lo que se
 * está haciendo: es un recuadro dentro de la pantalla, no un diálogo.
 * @param {{text: string, testId?: string, compact?: boolean}} props
 */
export default function PremiumNotice({ text, testId = 'premium-notice', compact = false }) {
  const { t } = useI18n();
  return (
    <div
      data-testid={testId}
      className={`flex ${compact ? 'flex-col items-start' : 'flex-wrap items-center'} gap-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-900 dark:text-amber-100 min-w-0`}
    >
      <span className="flex items-start gap-2 min-w-0 flex-1">
        <Sparkles size={16} className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <span className="min-w-0 break-words">{text}</span>
      </span>
      <button
        type="button"
        data-testid={`${testId}-cta`}
        onClick={openPremium}
        className="flex-shrink-0 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5"
      >
        {t('premium.cta')}
      </button>
    </div>
  );
}
