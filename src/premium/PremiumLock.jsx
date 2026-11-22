import React, { useEffect, useRef } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useI18n } from '../i18n/useI18n.js';
import { track } from '../analytics/track.js';
import { openPremium, usePremium } from './planStore.js';
import { trialNote } from '../account/productsCache.js';

/**
 * @param {{feature:string, preview:React.ReactNode, compact?:boolean, children:React.ReactNode}} props
 */
export default function PremiumLock({ feature, preview, compact = false, children }) {
  const { t } = useI18n();
  const premium = usePremium();
  const lockRef = useRef(null);
  useEffect(() => {
    const lock = lockRef.current;
    if (premium || !lock) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      track('paywall_view', { once: 'session' });
      observer.disconnect();
    }, { threshold: 0.1 });
    observer.observe(lock);
    return () => observer.disconnect();
  }, [premium]);

  if (premium) return children;
  const testId = `premium-lock-${feature}`;
  return <div ref={lockRef} data-testid={testId}
    className={`min-w-0 rounded-xl border border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/60 ${compact ? 'p-2.5' : 'p-4'}`}>
    {preview && <div className="mb-3">
      <p className="mb-1 text-xs font-medium text-ink-600 dark:text-ink-300">{t('premium.previewExample')}</p>
      <div aria-hidden="true" inert className="pointer-events-none select-none overflow-hidden rounded-lg blur-[3px]">{preview}</div>
    </div>}
    <button type="button" data-testid={`${testId}-cta`} onClick={openPremium}
      className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-left text-sm font-bold text-white hover:bg-brand-700">
      <LockKeyhole size={16} className="shrink-0" aria-hidden="true" />
      {t('premium.unlock')}
    </button>
    <p className="mt-1.5 text-xs text-ink-600 dark:text-ink-300">{trialNote(t)}</p>
  </div>;
}
