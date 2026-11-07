import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

// Interruptor de tema claro/oscuro (esquina superior derecha).
const ThemeToggle = ({ theme, onToggle }) => {
  const { t } = useI18n();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme={theme}
      onClick={onToggle}
      aria-label={dark ? t('theme.toLight') : t('theme.toDark')}
      title={dark ? t('theme.light') : t('theme.dark')}
      className="w-10 h-10 p-0 rounded-full flex items-center justify-center border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-800 text-ink-600 dark:text-amber-300 hover:bg-ink-100 dark:hover:bg-ink-700 shadow-sm transition-colors"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
};

export default ThemeToggle;
