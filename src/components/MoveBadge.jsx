import React from 'react';
import { useI18n } from '../i18n/useI18n';

const STYLES = {
  Best: 'bg-emerald-600 text-white',
  Excellent: 'bg-emerald-500 text-white',
  Good: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200',
  Inaccuracy: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200',
  Mistake: 'bg-orange-500 text-white',
  Blunder: 'bg-red-600 text-white',
  great: 'bg-sky-600 text-white',
};

// Insignia de clasificación de una jugada (etiqueta en el idioma activo; valores internos en inglés).
const MoveBadge = ({ label, greatMove = false }) => {
  const { t } = useI18n();
  if (!label) return null;
  const style = greatMove ? STYLES.great : STYLES[label];
  return (
    <span data-testid="move-badge" data-label={label} className={`text-xs font-black px-2 py-0.5 rounded-full whitespace-nowrap ${style}`}>
      {greatMove ? t('coach.greatMove') : t(`moveLabel.${label}`)}
    </span>
  );
};

export default MoveBadge;
