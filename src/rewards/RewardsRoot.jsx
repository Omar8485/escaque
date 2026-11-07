import './rewards.css';
import React, { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/useI18n';
import { formatNumber } from '../i18n/core';
import { levelProgress } from './xp';
import RewardsDaily from './RewardsDaily';
import RewardsProgress from './RewardsProgress';
import Achievements, { AchievementNotice } from './Achievements';
import { useGeneratorField } from '../puzzles/generator/useGeneratePuzzles';
import { playAchievementSound } from './sound';
import { getRewardsSnapshot, subscribeRewards, startRewardsRuntime, updateRewardsGoal, observeGeneratedPuzzles } from './runtime';

/** Single mount beside the avatar; reward UI stays independent from App layout/navigation. */
export default function RewardsRoot({ activeTab, soundOn }) {
  const { t, lang } = useI18n();
  const version = useGeneratorField('version');
  useEffect(() => { observeGeneratedPuzzles(version); }, [version]);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const achievement = achievementQueue[0] ?? null;
  const lastNotice = useRef(null);
  const soundPreference = useRef(soundOn);
  useEffect(() => { soundPreference.current = soundOn; }, [soundOn]);
  const state = useSyncExternalStore(subscribeRewards, getRewardsSnapshot);
  const [, setCalendar] = useState(0);
  useEffect(() => { const timer = setInterval(() => setCalendar((n) => n + 1), 60000); return () => clearInterval(timer); }, []);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  useEffect(() => { startRewardsRuntime(); }, []);
  useEffect(() => {
    if (!state.gain) return;
    queueMicrotask(() => setToast(state.gain));
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [state.gain]);
  useEffect(() => {
    if (!open) return;
    const escape = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  useEffect(() => {
    const notice = state.achievementNotice;
    if (!notice || lastNotice.current === notice) return;
    lastNotice.current = notice;
    queueMicrotask(() => setAchievementQueue((previous) => [...new Set([...previous, ...notice.ids])]));
  }, [state.achievementNotice]);
  useEffect(() => {
    if (!achievement) return;
    playAchievementSound(soundPreference.current);
    const timer = setTimeout(() => setAchievementQueue((previous) => previous.slice(1)), 3500);
    return () => clearTimeout(timer);
  }, [achievement]);
  const level = levelProgress(state.model.xp.xp);
  const n = (value) => formatNumber(lang, value);
  return <>
    <button data-testid="rewards-header" onClick={() => setOpen(true)} className="w-12 sm:w-24 flex-shrink-0 text-left bg-transparent p-0 text-ink-700 dark:text-ink-200" aria-label={t('rewards.open')}>
      <span data-testid="rewards-level" className="block text-[10px] sm:text-xs font-bold truncate">{t('rewards.level', { n: n(level.level) })}</span>
      <span data-testid="rewards-xp" className="hidden sm:block text-[10px]">{t('rewards.xp', { n: n(level.totalXp) })}</span>
      <span role="progressbar" aria-label={t('rewards.progress')} aria-valuemin={0} aria-valuemax={level.requiredXp} aria-valuenow={level.currentXp} className="mt-1 block h-1.5 rounded-full bg-ink-200 dark:bg-ink-700 overflow-hidden"><span className="block h-full rounded-full bg-brand-500 motion-safe:transition-[width]" style={{ width: `${level.progress * 100}%` }} /></span>
    </button>
    {state.ready && <RewardsProgress activeTab={activeTab}><div className="space-y-4"><RewardsDaily state={state.model.daily} onGoalChange={updateRewardsGoal} /><Achievements state={state.model.achievements} /></div></RewardsProgress>}
    {achievement && createPortal(<div className="fixed right-3 bottom-20 z-[80] max-w-[calc(100vw-1.5rem)]"><AchievementNotice id={achievement} /></div>, document.body)}
    {toast && createPortal(<div data-testid="rewards-toast" role="status" className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] rounded-2xl bg-ink-900 dark:bg-brand-900 text-white px-4 py-3 shadow-xl max-w-[90vw] motion-safe:animate-pulse">
      {toast.goalCompleted ? t('rewards.daily.complete') : toast.levelUp ? t('rewards.levelUp', { n: n(level.level) }) : t('rewards.gained', { n: n(toast.amount) })}
    </div>, document.body)}
    {open && createPortal(<div className="fixed inset-0 z-[70] bg-black/40 p-3 flex items-center justify-center" onClick={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label={t('rewards.title')} data-testid="rewards-panel" className="w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-2xl bg-white dark:bg-ink-900 p-5 shadow-xl text-ink-800 dark:text-ink-100" onClick={(e) => e.stopPropagation()}>
        <button data-testid="rewards-close" className="float-right rounded-xl p-2 bg-ink-100 dark:bg-ink-800" onClick={() => setOpen(false)}>{t('rewards.close')}</button>
        <h2 className="font-black text-xl">{t('rewards.title')}</h2>
        <p className="mt-4 font-bold">{t('rewards.level', { n: n(level.level) })} · {t('rewards.xp', { n: n(level.totalXp) })}</p>
        <p className="text-sm mt-2">{t('rewards.remaining', { n: n(level.nextLevelXp - level.totalXp) })}</p>
        {state.ready && <div className="mt-4"><RewardsDaily state={state.model.daily} onGoalChange={updateRewardsGoal} /></div>}
        {state.ready && <div className="mt-4"><Achievements state={state.model.achievements} /></div>}
        {state.error && <p role="alert" className="text-sm mt-3 text-rose-600 dark:text-rose-300">{t('rewards.error')}</p>}
      </section>
    </div>, document.body)}
  </>;
}
