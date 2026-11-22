import React from 'react';
import { winPercent, formatScore } from '../engine/uci';
import { useI18n } from '../i18n/useI18n';

// Barra de evaluación.
// `score` es el objeto estructurado del motor, SIEMPRE en perspectiva de blancas:
//   { type: 'cp', value } | { type: 'mate', value, winner }  (o null mientras no hay datos).
// El relleno representa la probabilidad de ganar (modelo Lichess) del jugador de ABAJO
// según `orientation`; un mate llena la barra al 100 % o la vacía al 0 %.
const EvalBar = ({ score, orientation = 'white', horizontal = false }) => {
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
      className={`h-full w-full rounded-md overflow-hidden flex ${horizontal ? 'flex-row' : 'flex-col-reverse'} border border-ink-400 dark:border-ink-600 relative ${bottomIsWhite ? 'bg-ink-800' : 'bg-white'}`}
    >
      {/* El relleno es del color del jugador de abajo */}
      <div
        className={`${horizontal ? 'h-full' : 'w-full'} transition-all duration-700 ease-in-out ${bottomIsWhite ? 'bg-white' : 'bg-ink-900'}`}
        style={{ [horizontal ? 'width' : 'height']: `${fillPercent}%` }}
      ></div>
    </div>
  );
};

// Depth/PV pueden cambiar sin que cambie la evaluación visible.
export default React.memo(EvalBar, (a, b) => a.orientation === b.orientation && a.horizontal === b.horizontal &&
  a.score?.type === b.score?.type && a.score?.value === b.score?.value && a.score?.winner === b.score?.winner);
