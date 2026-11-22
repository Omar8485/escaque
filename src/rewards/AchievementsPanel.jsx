import React from 'react';
import { Award, LockKeyhole, Trophy } from 'lucide-react';
import { ACHIEVEMENTS } from './achievements.js';
import { useI18n } from '../i18n/useI18n';
import { formatDate, formatNumber } from '../i18n/core';

/** Achievements live inside Progress: a single place for evidence and personal milestones. */
export default function Achievements({ state }) {
  const { t, lang } = useI18n();
  const count = ACHIEVEMENTS.filter((item) => state?.unlocked?.[item.id]).length;
  return <section data-testid="achievements-screen" className="w-full min-w-0 rounded-2xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Award size={20} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />
      <h2 className="text-lg font-black text-ink-800 dark:text-ink-100">{t('rewards.ach.title')}</h2>
      <p data-testid="achievements-count" className="ml-auto text-sm text-ink-500 dark:text-ink-400">{t('rewards.ach.count', { unlocked: formatNumber(lang, count), total: formatNumber(lang, ACHIEVEMENTS.length) })}</p>
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ACHIEVEMENTS.map((item) => {
        const unlocked = state?.unlocked?.[item.id];
        return <article key={item.id} data-testid={`achievement-${item.id}`} data-unlocked={Boolean(unlocked)} className={`min-w-0 rounded-2xl border p-3 ${unlocked ? 'border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30' : 'border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-800/60'}`}>
          <div className="flex items-start gap-2">
            {unlocked ? <Trophy size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" /> : <LockKeyhole size={20} className="mt-0.5 shrink-0 text-ink-400 dark:text-ink-500" aria-hidden="true" />}
            <div className="min-w-0 space-y-1">
              <h3 className={`break-words text-sm font-bold ${unlocked ? 'text-ink-900 dark:text-ink-100' : 'text-ink-500 dark:text-ink-400'}`}>{t(item.nameKey, item.vars)}</h3>
              <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">{t(item.descriptionKey, item.vars)}</p>
              <p data-testid={`achievement-date-${item.id}`} className={`text-xs ${unlocked ? 'text-brand-700 dark:text-brand-300' : 'text-ink-400 dark:text-ink-500'}`}>
                {unlocked ? t('rewards.ach.unlockedOn', { date: formatDate(lang, unlocked.unlockedAt) }) : t('rewards.ach.locked')}
              </p>
            </div>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

/** Nonblocking notice: the runtime owns its lifetime and optional sound preference. */
export function AchievementNotice({ id }) {
  const { t } = useI18n();
  const achievement = ACHIEVEMENTS.find((item) => item.id === id);
  if (!achievement) return null;
  return <div data-testid="achievement-notice" data-achievement={id} role="status" className="pointer-events-none flex max-w-sm gap-3 rounded-2xl border border-brand-200 dark:border-brand-800 bg-white dark:bg-ink-900 p-4 text-ink-800 dark:text-ink-100 shadow-lg motion-safe:animate-in motion-safe:fade-in">
    <Trophy size={22} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
    <div className="min-w-0">
      <p className="text-xs font-bold text-brand-700 dark:text-brand-300">{t('rewards.ach.notice')}</p>
      <p className="break-words text-sm font-bold">{t(achievement.nameKey, achievement.vars)}</p>
    </div>
  </div>;
}
