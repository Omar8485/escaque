import React from 'react';
import { useI18n } from '../i18n/useI18n';
import { formatDate, formatNumber } from '../i18n/core';
import { getRivalLevel } from '../engine/rivalLevels';
import { generatePlan } from './plan';
import { usePremium } from '../premium/planStore';
import { planActions } from '../premium/gate';
import PremiumNotice from '../premium/PremiumNotice';

const buttonClass = 'rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold px-3 py-2 text-left whitespace-normal break-words disabled:opacity-50';

/** Acciones del plan; la vista superior decide cómo navegar sin perder una partida. */
export default function TrainingPlan({ metrics, resources, onAction }) {
  const { t, lang } = useI18n();
  const premium = usePremium();
  // Plan gratuito: plan básico de 1 acción (src/premium/limits.js).
  const { visible: actions, hidden } = planActions(generatePlan(metrics, resources), premium);
  const motifText = (motif) => motif === 'hanging'
    ? t('progress.plan.hanging') : t(`puzzles.motif.${motif}`);
  return (
    <section data-testid="training-plan" className="rounded-2xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 p-4 min-w-0">
      <h2 className="font-black text-ink-900 dark:text-ink-100">{t('progress.plan.title')}</h2>
      {!actions.length ? (
        <p data-testid="training-plan-empty" className="mt-2 text-sm text-ink-500 dark:text-ink-400">{t('progress.plan.empty')}</p>
      ) : (
        <div className="grid gap-3 mt-3">
          {actions.map((action) => {
            const vars = { ...action.vars };
            if (action.type === 'puzzles') vars.motif = motifText(action.target.motif);
            if (action.type === 'practice') {
              vars.rival = getRivalLevel(action.target.level).name;
              vars.level = formatNumber(lang, action.target.level);
              vars.color = t(action.target.color === 'w' ? 'common.white' : 'common.black');
            }
            return (
              <article key={action.id} data-testid={`training-plan-${action.type}`} className="rounded-xl bg-ink-50 dark:bg-ink-800/60 p-3 min-w-0">
                <h3 className="text-sm font-bold text-ink-800 dark:text-ink-100 break-words">{t(action.titleKey, vars)}</h3>
                {action.type === 'practice' && <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">{t('progress.plan.openingNote')}</p>}
                {action.type === 'review' ? (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {action.target.targets.map((target) => {
                      const evidence = action.evidence.find((item) => item.gameId === target.gameId && item.ply === target.ply);
                      const date = Number.isFinite(evidence?.date)
                        ? formatDate(lang, evidence.date) : t('progress.plan.unknownDate');
                      return (
                        <button key={`${target.gameId}:${target.ply}`} type="button" data-testid={`training-plan-review-${target.gameId}-${target.ply}`} className={buttonClass} disabled={!onAction}
                          onClick={() => onAction?.({ ...action, target: { ...action.target, ...target } })}>
                          {t('progress.plan.reviewTarget', { date, ply: formatNumber(lang, target.ply) })}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button type="button" data-testid={`training-plan-start-${action.type}`} className={`${buttonClass} mt-2`} disabled={!onAction} onClick={() => onAction?.(action)}>
                    {t('progress.plan.start')}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
      {hidden > 0 && <div className="mt-3"><PremiumNotice testId="training-plan-premium" text={t('premium.notice.plan', { n: hidden })} /></div>}
    </section>
  );
}
