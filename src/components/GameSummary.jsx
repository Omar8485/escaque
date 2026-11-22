import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from '../layout/useViewport';
import BottomSheet from '../layout/BottomSheet';
import { Clock, ListOrdered, Target, X } from 'lucide-react';
import { formatDuration } from '../coach/summary';
import { useI18n } from '../i18n/useI18n';
import { formatNumber } from '../i18n/core';
import { feedbackTemplate } from '../coach/templates';
import PremiumLock from '../premium/PremiumLock';

// Etiquetas de clasificación (texto en `moveLabel.*` del idioma) y su color.
const ROWS = [
  { label: 'Best', dot: 'bg-emerald-600' },
  { label: 'Excellent', dot: 'bg-emerald-500' },
  { label: 'Good', dot: 'bg-emerald-300' },
  { label: 'Inaccuracy', dot: 'bg-yellow-400' },
  { label: 'Mistake', dot: 'bg-orange-500' },
  { label: 'Blunder', dot: 'bg-red-600' },
];

const ColorDot = ({ color }) => (
  <span
    aria-hidden="true"
    className={`inline-block w-2.5 h-2.5 rounded-full border border-ink-400 flex-shrink-0 ${color === 'w' ? 'bg-white' : 'bg-ink-900'}`}
  />
);

const Tile = ({ icon, title, value, detail, testId }) => (
  <div className="bg-ink-50 dark:bg-ink-800/60 rounded-xl p-2.5 min-w-0">
    <p className="text-[10px] font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 flex items-center gap-1">
      {React.createElement(icon, { size: 12 })} {title}
    </p>
    <p data-testid={testId} className="text-lg font-black text-ink-800 dark:text-ink-100 font-mono leading-tight truncate">{value}</p>
    {detail && <p className="text-[11px] text-ink-500 dark:text-ink-400 truncate">{detail}</p>}
  </div>
);

function Moment({ moment, index, coachRecord }) {
  const { t, lang } = useI18n();
  const percent = (value) => formatNumber(lang, value / 100, { style: 'percent' });
  const shift = t('summary.momentShift', { before: percent(moment.winBefore), after: percent(moment.winAfter) });
  const request = coachRecord?.revealRequest ?? coachRecord?.request;
  const movedBetter = moment.winAfter > moment.winBefore;
  const fallback = moment.bestMoveSan && moment.bestMoveSan !== moment.san
    ? t('summary.momentAlternative', { san: moment.bestMoveSan })
    : t(movedBetter ? 'summary.momentImproved' : 'summary.momentWorsened');
  const explanation = request ? feedbackTemplate({
    ...request, locale: lang, policy: { ...request.policy, offerTakeback: false, revealBestMove: true },
  }, { detailed: true }).text : fallback;
  const move = formatNumber(lang, moment.moveNumber, { useGrouping: false });
  return <div data-testid={`summary-moment-${index}`} className="rounded-xl bg-ink-50 p-2.5 text-sm dark:bg-ink-800">
    <strong>{move}{moment.color === 'w' ? '.' : '…'} {moment.san}</strong>
    <p className="mt-1 text-ink-700 dark:text-ink-300">{shift}</p>
    <p data-testid="summary-moment-explanation" className="mt-1">{explanation}</p>
  </div>;
}

/**
 * Tarjeta de estadísticas de fin de partida (Entrenar).
 * @param {object} p
 * @param {ReturnType<typeof import('../coach/summary').summarizeGame>} p.summary
 * @param {string} p.playerName
 * @param {string} p.rivalName
 * @param {Record<string, object>} [p.coachRecords]
 * @param {string} [p.resultLabel]  texto del resultado ("Jaque mate · Ganas tú (1-0)")
 * @param {() => void} [p.onClose]  muestra una ✕ para cerrarla
 */
const GameSummary = ({ summary, playerName, rivalName, resultLabel, onClose, coachRecords = {} }) => {
  const { t } = useI18n();
  // Hoja inferior solo con el diseño de teléfono (< 960 px, como Jugar en móvil y la barra inferior);
  // entre 960 y 1023 la partida usa el diseño de dos columnas y el resumen va en la columna.
  const mobile = useViewport().width < 960;
  const [dismissed, setDismissed] = useState(false);
  const { playerColor, rivalColor, counts, movesByColor, accuracy, time, moments } = summary;
  const columns = [
    { color: playerColor, name: playerName },
    { color: rivalColor, name: rivalName },
  ];
  const fmtAcc = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} %`);

  const content = (
    <section
      data-testid="game-summary"
      data-complete={summary.complete ? 'true' : 'false'}
      aria-label={t('summary.title')}
      className="bg-white dark:bg-ink-900 p-4 rounded-2xl shadow-sm border border-ink-200 dark:border-ink-700 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-black uppercase tracking-wider text-brand-600 dark:text-brand-400">{t('summary.title')}</h3>
          {resultLabel && <p className="text-sm font-bold text-ink-800 dark:text-ink-100 truncate" title={resultLabel}>{resultLabel}</p>}
        </div>
        {onClose && !mobile && (
          <button
            type="button"
            data-testid="summary-close"
            onClick={onClose}
            aria-label={t('summary.close')}
            className="p-1 rounded-lg bg-transparent text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile
          icon={Clock}
          title={t('summary.totalTime')}
          value={formatDuration(time.totalMs)}
          detail={summary.durationMs !== null ? t('summary.clockAndReal', { real: formatDuration(summary.durationMs) }) : t('summary.clock')}
          testId="summary-total-time"
        />
        <Tile
          icon={ListOrdered}
          title={t('summary.moves')}
          value={String(summary.fullMoves)}
          detail={t('summary.plies', { n: summary.plies })}
          testId="summary-moves"
        />
      </div>

      <table className="w-full text-sm" data-testid="summary-table">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-ink-400">
            <th className="text-left font-black pb-1"> </th>
            {columns.map(({ color, name }) => (
              <th key={color} className="text-right font-black pb-1 max-w-[7rem]">
                <span className="inline-flex items-center gap-1 justify-end max-w-full">
                  <ColorDot color={color} />
                  <span className="truncate normal-case tracking-normal text-xs text-ink-700 dark:text-ink-200">{name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-ink-700 dark:text-ink-200">
          <tr className="border-t border-ink-100 dark:border-ink-800">
            <td className="py-1 font-bold">{t('summary.timeUsed')}</td>
            {columns.map(({ color }) => (
              <td key={color} data-testid={`summary-time-${color}`} className="py-1 text-right font-mono">{formatDuration(time[color])}</td>
            ))}
          </tr>
          <tr>
            <td className="py-1 font-bold">{t('summary.moves')}</td>
            {columns.map(({ color }) => (
              <td key={color} data-testid={`summary-moves-${color}`} className="py-1 text-right font-mono">{movesByColor[color]}</td>
            ))}
          </tr>
          <tr>
            <td className="py-1 font-bold flex items-center gap-1"><Target size={13} /> {t('summary.accuracy')}</td>
            {columns.map(({ color }) => (
              <td key={color} data-testid={`summary-accuracy-${color}`} className="py-1 text-right font-mono font-bold">{fmtAcc(accuracy[color])}</td>
            ))}
          </tr>
          {ROWS.map(({ label, dot }, i) => (
            <tr key={label} className={i === 0 ? 'border-t border-ink-100 dark:border-ink-800' : ''}>
              <td className="py-0.5">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className={`w-2 h-2 rounded-full ${dot}`} />
                  {t(`moveLabel.${label}`)}
                </span>
              </td>
              {columns.map(({ color }) => {
                const n = counts[color][label];
                return (
                  <td
                    key={color}
                    data-testid={`summary-count-${color}-${label}`}
                    className={`py-0.5 text-right font-mono ${n === 0 ? 'text-ink-300 dark:text-ink-600' : 'font-bold'}`}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {moments.length > 0 && <section data-testid="summary-key-moments">
        <h4 className="mb-2 text-sm font-bold">{t('summary.keyMoments')}</h4>
        <ol className="space-y-2">
          {moments.map((moment, index) => {
            const content = <Moment moment={moment} index={index} coachRecord={coachRecords[moment.key]} />;
            return <li key={moment.key}>{index === 0 ? content : <PremiumLock feature="gameMoments" compact preview={
              <p className="rounded-lg bg-white p-2 text-sm font-semibold dark:bg-ink-800">{t('premium.preview.gameMoments')}</p>
            }>{content}</PremiumLock>}</li>;
          })}
        </ol>
      </section>}

      {summary.pending > 0 && (
        <p data-testid="summary-pending" className="text-xs text-ink-500 dark:text-ink-400 animate-pulse">
          {t('summary.analyzing', { n: summary.pending })}
        </p>
      )}
    </section>
  );
  if (!mobile) return content;
  if (dismissed) return <button data-testid="summary-toggle" onClick={() => setDismissed(false)} className="min-h-11 rounded-xl bg-ink-100 dark:bg-ink-800 px-4 py-2 font-bold">{t('practice.lastSummary')}</button>;
  const close = () => { setDismissed(true); onClose?.(); };
  return createPortal(<BottomSheet open onClose={close} title={t('summary.title')} testId="game-summary" maxHeight="calc(100dvh - 1rem)" footer={<button type="button" data-testid="summary-close" onClick={close} className="min-h-11 w-full rounded-xl bg-brand-600 px-4 py-2 text-white font-bold">{t('summary.close')}</button>}>
    {React.cloneElement(content, { 'data-testid': undefined, className: 'flex flex-col gap-3 text-ink-800 dark:text-ink-100' })}
  </BottomSheet>, document.body);
};

export default GameSummary;
