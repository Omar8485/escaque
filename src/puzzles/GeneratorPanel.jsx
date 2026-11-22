import React from 'react';
import { Cpu, Square, Sparkles } from 'lucide-react';
import { useGeneratePuzzles } from './generator/useGeneratePuzzles';
import { LIMIT_OPTIONS } from './generator/runner';
import { useI18n } from '../i18n/useI18n';
import { formatDuration } from '../i18n/core';
import { usePremium } from '../premium/planStore';
import { isGeneratorLimitAllowed } from '../premium/gate';
import { FREE_LIMITS } from '../premium/limits';
import PremiumNotice from '../premium/PremiumNotice';

const LIMIT_KEY = { 50: 'puzzles.gen.limit50', 100: 'puzzles.gen.limit100', 0: 'puzzles.gen.limitAll' };

const seg = (active) =>
  `py-1.5 px-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${active ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-100 shadow' : 'bg-transparent text-ink-500 dark:text-ink-400 hover:text-brand-600'}`;

/** Duración aproximada: segundos si es < 1 min; si no, redondeada al minuto (Intl, según idioma). */
function duration(ms, t, lang) {
  if (ms == null) return t('puzzles.gen.calculating');
  const s = Math.round(ms / 1000);
  if (s < 60) return formatDuration(lang, Math.max(1, s) * 1000);
  return formatDuration(lang, Math.round(s / 60) * 60_000);
}

// Panel para generar puzles con Stockfish en el navegador a partir de tus partidas importadas.
const GeneratorPanel = ({ summary }) => {
  const { t, lang } = useI18n();
  const gen = useGeneratePuzzles();
  const premium = usePremium();
  const running = gen.status !== 'idle';
  const p = gen.progress;
  const noGames = summary && summary.games === 0;
  const pending = summary?.pending ?? 0;
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;

  return (
    <div data-testid="puzzle-generator" data-status={gen.status} className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={t('puzzles.gen.groupLabel')} className="grid grid-cols-3 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl">
        {LIMIT_OPTIONS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={gen.limit === n} data-testid={`puzzle-gen-limit-${n}`} disabled={running} onClick={() => gen.setLimit(n)} className={seg(gen.limit === n)}>
            {isGeneratorLimitAllowed(n, premium) ? t(LIMIT_KEY[n]) : t('premium.lockedOption', { label: t(LIMIT_KEY[n]) })}
          </button>
        ))}
      </div>
      {/* Plan gratuito: se analizan como mucho las últimas 50 partidas aunque se elija más. */}
      {!isGeneratorLimitAllowed(gen.limit, premium) && (
        <PremiumNotice compact testId="puzzle-gen-premium" text={t('premium.notice.history', { n: FREE_LIMITS.recentGames })} />
      )}

      {summary && !running && (
        <p data-testid="puzzle-gen-summary" className="text-xs text-ink-600 dark:text-ink-300">
          {noGames
            ? t('puzzles.gen.noGames')
            : `${t('puzzles.gen.analyzed', { analyzed: summary.analyzedTotal, n: summary.games })} ${
                pending
                  ? summary.inScope < summary.games
                    ? t('puzzles.gen.pendingOfLast', { pending, scope: summary.inScope })
                    : t('puzzles.gen.pending', { pending })
                  : t('puzzles.gen.upToDate')
              }`}
        </p>
      )}

      {running ? (
        <button data-testid="puzzle-gen-cancel" onClick={gen.cancel} disabled={gen.status === 'cancelling'} className="py-2 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700 disabled:opacity-50">
          <Square size={14} /> {gen.status === 'cancelling' ? t('puzzles.gen.cancelling') : t('puzzles.gen.cancel')}
        </button>
      ) : (
        <button
          data-testid="puzzle-gen-start"
          onClick={() => gen.start({ limit: gen.limit })}
          disabled={!summary || noGames || pending === 0}
          className="py-2 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 disabled:hover:bg-brand-600"
        >
          <Cpu size={15} /> {pending === 0 && summary && !noGames ? t('puzzles.gen.allDone') : t('puzzles.gen.start')}
        </button>
      )}

      {running && (
        <div data-testid="puzzle-gen-progress" data-done={p?.done ?? 0} data-total={p?.total ?? 0} data-found={p?.puzzlesFound ?? 0} className="flex flex-col gap-1">
          <div className="h-2 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={p?.total ?? 0} aria-valuenow={p?.done ?? 0}>
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-ink-700 dark:text-ink-200 font-bold">
            {p
              ? t('puzzles.gen.progress', { done: p.done, games: t('puzzles.gen.games', { n: p.total }), puzzles: t('puzzles.gen.newPuzzles', { n: p.puzzlesFound }) })
              : t('puzzles.gen.preparing')}
          </p>
          {p?.current && (
            <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
              {p.current.white} – {p.current.black} ({p.current.date}){p.current.positionsTotal ? t('puzzles.gen.position', { n: p.current.positions, total: p.current.positionsTotal }) : ''}
            </p>
          )}
          {p && <p className="text-xs text-ink-500 dark:text-ink-400">{t('puzzles.gen.eta', { time: duration(p.etaMs, t, lang) })}</p>}
        </div>
      )}

      {!running && gen.result && (
        <p data-testid="puzzle-gen-result" data-status={gen.result.status} className="text-xs text-ink-600 dark:text-ink-300 flex items-start gap-1">
          <Sparkles size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <span>
            {gen.result.status === 'cancelled' ? t('puzzles.gen.cancelled') : t('puzzles.gen.done')}{' '}
            {t('puzzles.gen.resultLine', {
              games: t('puzzles.gen.gamesAnalyzed', { n: gen.result.analyzed }),
              puzzles: t('puzzles.gen.newPuzzles', { n: gen.result.puzzlesFound }),
              time: duration(gen.result.elapsedMs, t, lang),
            })}
            {gen.result.status === 'cancelled' ? ` ${t('puzzles.gen.keptNote')}` : ''}
          </span>
        </p>
      )}
      {gen.busy && <p className="text-xs text-amber-700 dark:text-amber-300">{t('puzzles.gen.busy')}</p>}
      {gen.error && <p className="text-xs text-rose-700 dark:text-rose-300">{t('puzzles.gen.error', { error: gen.error })}</p>}
    </div>
  );
};

export default GeneratorPanel;
