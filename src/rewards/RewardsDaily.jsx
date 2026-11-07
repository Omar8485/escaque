import React from 'react';
import { useI18n } from '../i18n/useI18n';
import { formatNumber } from '../i18n/core';
import { getDailyStatus } from './daily';

/** Racha y meta diaria; el contenedor persiste los cambios de meta en meta/rewards. */
export default function RewardsDaily({ state, status: suppliedStatus, onGoalChange }) {
  const { t, lang } = useI18n();
  const status = suppliedStatus ?? getDailyStatus(state);
  const fmt = (value) => formatNumber(lang, value);
  return (
    <section data-testid="rewards-daily" className="rounded-2xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 p-4 min-w-0 space-y-3">
      <h2 className="font-black text-ink-900 dark:text-ink-100">{t('rewards.daily.title')}</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl p-3 bg-brand-50 dark:bg-ink-800 min-w-0">
          <p className="text-ink-500 dark:text-ink-400">{t('rewards.daily.streak')}</p>
          <p data-testid="rewards-daily-streak" className="text-lg font-black text-brand-700 dark:text-brand-300">
            {t('rewards.daily.days', { n: status.currentStreak, count: fmt(status.currentStreak) })}
          </p>
        </div>
        <div className="rounded-xl p-3 bg-ink-50 dark:bg-ink-800 min-w-0">
          <p className="text-ink-500 dark:text-ink-400">{t('rewards.daily.best')}</p>
          <p data-testid="rewards-daily-best" className="text-lg font-black text-ink-800 dark:text-ink-100">
            {t('rewards.daily.days', { n: status.bestStreak, count: fmt(status.bestStreak) })}
          </p>
        </div>
      </div>
      <p data-testid="rewards-daily-wildcard" className="text-xs text-ink-500 dark:text-ink-400">
        {t(status.wildcardAvailable ? 'rewards.daily.wildcardAvailable' : 'rewards.daily.wildcardUsed')}
      </p>
      <details className="text-xs text-ink-500 dark:text-ink-400">
        <summary data-testid="rewards-daily-rules" className="cursor-pointer">{t('rewards.daily.rulesTitle')}</summary>
        <p className="mt-1">{t('rewards.daily.rules')}</p>
      </details>
      <div data-testid="rewards-daily-goal" className="space-y-3">
        <h3 className="text-sm font-bold text-ink-800 dark:text-ink-100">{t('rewards.daily.goalTitle')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {['games', 'puzzles'].map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm min-w-0 text-ink-700 dark:text-ink-200">
              <span>{t(`rewards.daily.${key}`)}</span>
              <span data-testid={`rewards-daily-progress-${key}`} className="font-bold">
                {t('rewards.daily.progress', { done: fmt(status.progress[key]), goal: fmt(status.goal[key]) })}
              </span>
              <span className="text-xs text-ink-500 dark:text-ink-400">{t('rewards.daily.goalLabel')}</span>
              <input type="number" inputMode="numeric" min="0" max="100" step="1"
                data-testid={`rewards-daily-goal-${key}`} value={status.goal[key]} disabled={!onGoalChange}
                className="w-full rounded-lg border border-ink-300 dark:border-ink-600 bg-white dark:bg-ink-900 text-ink-800 dark:text-ink-100 p-2"
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isInteger(value)) onGoalChange?.({ ...status.goal, [key]: value });
                }} />
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-500 dark:text-ink-400">{t('rewards.daily.goalHint')}</p>
        {status.goalComplete && (
          <p data-testid="rewards-daily-complete" role="status" className="rounded-xl p-2 text-sm font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40">
            {t('rewards.daily.complete')}
          </p>
        )}
      </div>
    </section>
  );
}
