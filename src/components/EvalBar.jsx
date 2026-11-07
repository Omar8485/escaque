import React from 'react';
import { winPercent, formatScore } from '../engine/uci';
import { useI18n } from '../i18n/useI18n';

// Barra de evaluación.
// `score` es el objeto estructurado del motor, SIEMPRE en perspectiva de blancas:
//   { type: 'cp', value } | { type: 'mate', value, winner }  (o null mientras no hay datos).
// El relleno representa la probabilidad de ganar (modelo Lichess) del jugador de ABAJO
// según `orientation`; un mate llena la barra al 100 % o la vacía al 0 %.
const EvalBar = ({ score, orientation = 'white' }) => {
  const whitePercent = winPercent(score); // 50 si no hay evaluación
  const bottomIsWhite = orientation === 'white';
  const fillPercent = bottomIsWhite ? whitePercent : 100 - whitePercent;
  const { t } = useI18n();
  const label = formatScore(score);

  return (
    <div
      role="meter"
      aria-label={t('board.whiteAdvantage')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(whitePercent * 10) / 10}
      aria-valuetext={label || t('board.noEval')}
      data-white-percent={whitePercent.toFixed(1)}
      className={`h-full w-full rounded-md overflow-hidden flex flex-col-reverse border border-ink-400 dark:border-ink-600 relative ${bottomIsWhite ? 'bg-ink-800' : 'bg-white'}`}
    >
      {/* El relleno es del color del jugador de abajo */}
      <div
        className={`w-full transition-all duration-700 ease-in-out ${bottomIsWhite ? 'bg-white' : 'bg-ink-900'}`}
        style={{ height: `${fillPercent}%` }}
      ></div>
    </div>
  );
};

export default EvalBar;
