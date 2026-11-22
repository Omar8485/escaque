import React from 'react';
import { Play, Puzzle, BarChart2, Library, Menu } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { useBottomNavReservation } from '../layout/useViewport';

const DESTINATIONS = [
  ['play', 'practice', Play], ['puzzles', 'puzzles', Puzzle],
  ['progress', 'progress', BarChart2], ['games', 'games', Library], ['more', null, Menu],
];

export default function BottomNav({ activeTab, onSelect, onMore, menuOpen }) {
  const { t } = useI18n();
  useBottomNavReservation();
  const current = activeTab === 'analysis' ? 'games' : activeTab;
  return <nav data-testid="bottom-nav" aria-label={t('menu.main')} className="fixed inset-x-0 bottom-0 z-30 h-[var(--bottom-nav-h)] pb-[env(safe-area-inset-bottom,0px)] border-t border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 grid grid-cols-5">
    {DESTINATIONS.map(([id, tab, Icon]) => <button key={id} type="button" data-testid={`bottom-nav-${id}`} aria-current={tab === current ? 'page' : undefined} aria-expanded={id === 'more' ? menuOpen : undefined} onClick={() => tab ? onSelect(tab) : onMore()} className={`min-w-0 h-14 p-0 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${tab === current ? 'text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-950' : 'text-ink-500 dark:text-ink-300'}`}>
      {React.createElement(Icon, { size: 20, 'aria-hidden': true })}<span>{t(`mobileNav.${id}`)}</span>
    </button>)}
  </nav>;
}
