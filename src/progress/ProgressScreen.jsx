import React, { useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useI18n } from '../i18n/useI18n';
import { formatDate, formatNumber } from '../i18n/core';
import { computeStats } from '../utils/stats';
import { SPEEDS } from '../import/normalize';
import { useProgressMetrics } from './useProgressMetrics';
import { usePremium } from '../premium/planStore';
import { isCardAvailable, isPeriodAllowed, progressPeriod } from '../premium/gate';
import { FREE_LIMITS } from '../premium/limits';
import PremiumNotice from '../premium/PremiumNotice';

const card = 'min-w-0 rounded-2xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-4 sm:p-5 shadow-sm';
const button = 'rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-40';
const secondary = 'rounded-xl bg-ink-100 dark:bg-ink-800 px-3 py-2 text-sm font-bold text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700';
const select = 'w-full min-w-0 rounded-xl border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-800 px-3 py-2 text-sm text-ink-800 dark:text-ink-100';
const PHASES = { apertura: 'opening', 'medio juego': 'middlegame', final: 'endgame' };
const LABELS = ['Blunder', 'Mistake', 'Inaccuracy'];
const MOTIFS = ['mate', 'jaque_y_ataque', 'ataque_doble', 'captura', 'pieza_colgada', 'mate_permitido', 'hanging'];
const EMPTY_DATA = { games: [], analysis: [], moves: [] };

function Card({ id, title, children, className = '' }) {
  return <section data-testid={`progress-${id}`} className={`${card} ${className}`}>
    <h2 className="mb-3 text-base font-bold text-ink-800 dark:text-ink-100">{title}</h2>
    {children}
  </section>;
}

/** Tarjeta que en el plan gratuito muestra el aviso de Premium en lugar de su contenido. */
function GatedCard({ premium, id, title, children }) {
  const { t } = useI18n();
  return <Card id={id} title={title}>
    {isCardAvailable(id, premium) ? children : <PremiumNotice compact testId={`progress-${id}-locked`} text={t('premium.notice.card')} />}
  </Card>;
}

function ChartTooltip({ active, payload, label, dateLabel, formatValue }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-3 text-xs text-ink-700 dark:text-ink-200 shadow-lg">
    <p className="mb-1 font-bold">{dateLabel(label)}</p>
    {payload.map((entry) => <p key={entry.dataKey}>{entry.name}: {formatValue(entry.value)}</p>)}
  </div>;
}

function Empty({ children }) {
  return <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">{children}</p>;
}

/** Progress is calculated in a worker; this view only filters small game metadata for W/D/L and Elo. */
export default function ProgressScreen({ data = EMPTY_DATA, onPractice, onImport, onAnalyze, onPuzzles, plan }) {
  const { t, lang } = useI18n();
  const [filters, setFilters] = useState({ source: 'all', speed: 'all', period: 'all' });
  const premium = usePremium();
  // Plan gratuito: solo los últimos 30 días (src/premium/limits.js).
  const effective = useMemo(() => ({ ...filters, period: progressPeriod(filters.period, premium) }), [filters, premium]);
  const { metrics, loading, error } = useProgressMetrics(data, effective);
  const [now] = useState(() => Date.now());
  const filteredGames = useMemo(() => {
    const since = effective.period === 'all' ? -Infinity : now - Number(effective.period) * 86400000;
    return (data.games ?? []).filter((g) =>
      (effective.source === 'all' || (effective.source === 'escaque' ? g.source === 'escaque' : g.source !== 'escaque')) &&
      (effective.speed === 'all' || g.speed === effective.speed) && g.endTime >= since);
  }, [data.games, effective, now]);
  const stats = useMemo(() => computeStats(filteredGames), [filteredGames]);
  const num = (n, digits = 1) => Number.isFinite(n) ? formatNumber(lang, n, { maximumFractionDigits: digits }) : t('progress.noValue');
  const percent = (n) => Number.isFinite(n) ? t('progress.percent', { value: num(n) }) : t('progress.noValue');
  const phaseName = (phase) => t(`progress.phase.${PHASES[phase] ?? 'unknown'}`);
  const motifName = (motif) => t(`progress.motif.${MOTIFS.includes(motif) ? motif : 'unknown'}`);
  const weaknessName = (weakness) => weakness.kind === 'phase' ? phaseName(weakness.key) : weakness.kind === 'motif' ? motifName(weakness.key) : (metrics?.openings?.find((opening) => opening.key === weakness.key)?.name || t('progress.unknownOpening'));
  const openingRank = (opening) => {
    const peers = (metrics?.openings ?? []).filter((item) => item.color === opening.color && Number.isFinite(item.pointsPercent));
    if (peers.length < 2 || !Number.isFinite(opening.pointsPercent)) return null;
    const high = Math.max(...peers.map((item) => item.pointsPercent));
    const low = Math.min(...peers.map((item) => item.pointsPercent));
    if (high === low) return 'tied';
    return opening.pointsPercent === high ? 'best' : opening.pointsPercent === low ? 'worst' : null;
  };
  const dateLabel = (date) => date ? formatDate(lang, typeof date === 'number' ? date : Date.parse(date)) : t('common.noDate');
  const coverage = metrics?.coverage;
  const changeFilter = (field) => (event) => setFilters((current) => ({ ...current, [field]: event.target.value }));

  return <div data-testid="progress-screen" className="min-w-0 w-full space-y-4 pb-16">
    <div className={card}>
      <h1 className="text-xl font-black text-ink-900 dark:text-ink-100">{t('progress.title')}</h1>
      <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t('progress.subtitle')}</p>
      <div data-testid="progress-filters" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="min-w-0 text-xs font-bold text-ink-600 dark:text-ink-300">{t('progress.sourceLabel')}
          <select data-testid="progress-filter-source" value={filters.source} onChange={changeFilter('source')} className={`${select} mt-1`}>
            {['all', 'escaque', 'imported'].map((source) => <option key={source} value={source}>{t(`progress.source.${source}`)}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-bold text-ink-600 dark:text-ink-300">{t('progress.speedLabel')}
          <select data-testid="progress-filter-speed" value={filters.speed} onChange={changeFilter('speed')} className={`${select} mt-1`}>
            <option value="all">{t('progress.allSpeeds')}</option>
            {[...SPEEDS, 'unknown'].map((speed) => <option key={speed} value={speed}>{t(`speed.${speed}`)}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-bold text-ink-600 dark:text-ink-300">{t('progress.periodLabel')}
          <select data-testid="progress-filter-period" value={effective.period} onChange={changeFilter('period')} className={`${select} mt-1`}>
            {['30', '90', 'all'].map((period) => <option key={period} value={period} disabled={!isPeriodAllowed(period, premium)}>
              {isPeriodAllowed(period, premium) ? t(`progress.period.${period}`) : t('premium.lockedOption', { label: t(`progress.period.${period}`) })}
            </option>)}
          </select>
        </label>
      </div>
      {!premium && <div className="mt-3"><PremiumNotice testId="progress-premium-notice" text={t('premium.notice.progress', { days: FREE_LIMITS.defaultProgressPeriod })} /></div>}
    </div>

    {(loading || data.loading) && <p data-testid="progress-loading" role="status" className="text-sm text-ink-600 dark:text-ink-300">{t('progress.loading')}</p>}
    {(error || data.error) && <p data-testid="progress-error" role="alert" className={`${card} text-sm text-rose-700 dark:text-rose-300`}>{t('progress.error')}</p>}

    {!data.loading && !data.games?.length && <div data-testid="progress-empty" className={`${card} space-y-3`}>
      <Empty>{t('progress.empty')}</Empty>
      <div className="flex flex-wrap gap-2">
        <button data-testid="progress-play" onClick={onPractice} className={button}>{t('progress.play')}</button>
        <button data-testid="progress-import" onClick={onImport} className={secondary}>{t('progress.import')}</button>
      </div>
    </div>}

    {!!data.games?.length && <>
      {!filteredGames.length && <div data-testid="progress-filter-empty" className={card}><Empty>{t('progress.noMatches')}</Empty></div>}
      {coverage && <div data-testid="progress-coverage" className={`${card} space-y-3`}>
        <p className="text-sm text-ink-600 dark:text-ink-300">{t('progress.coverage', { analyzed: num(coverage.analyzedGames, 0), total: num(coverage.games, 0), moves: num(coverage.classifiedMoves, 0), playerMoves: num(coverage.playerMoves, 0) })}</p>
        {coverage.unanalysedImportedGames > 0 && <div data-testid="progress-needs-analysis" className="space-y-2">
          <Empty>{t('progress.unanalyzed', { n: coverage.unanalysedImportedGames })}</Empty>
          <button data-testid="progress-analyze" onClick={onAnalyze} className={button}>{t('progress.analyze')}</button>
        </div>}
      </div>}
      {typeof plan === 'function' ? plan(metrics) : plan}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Card id="results" title={t('progress.resultsTitle')}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['wins', stats.wins], ['losses', stats.losses], ['draws', stats.draws]].map(([key, value]) => <div key={key} className="rounded-xl bg-ink-50 dark:bg-ink-800 p-2">
              <p data-testid={`progress-${key}`} className="text-2xl font-black text-brand-700 dark:text-brand-300">{num(value, 0)}</p>
              <p className="text-xs text-ink-600 dark:text-ink-300">{t(`progress.${key}`)}</p>
            </div>)}
          </div>
          <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">{t('progress.totalGames', { n: stats.total })}</p>
          <button data-testid="progress-to-puzzles" onClick={onPuzzles} className={`${secondary} mt-3`}>{t('progress.toPuzzles')}</button>
        </Card>

        <Card id="elo" title={t('progress.eloTitle')}>
          {stats.eloHistory.length ? <div className="h-48 min-w-0 w-full" data-testid="progress-elo-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={stats.eloHistory} margin={{ top: 8, right: 12, bottom: 8, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="date" hide />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip dateLabel={dateLabel} formatValue={(value) => num(Number(value), 0)} />} />
                <Line name={t('progress.elo')} dataKey="rating" stroke="#b85b39" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div> : <Empty>{t('progress.noElo')}</Empty>}
        </Card>

        <Card id="accuracy" title={t('progress.accuracyTitle')}>
          <p data-testid="progress-accuracy-value" className="text-3xl font-black text-brand-700 dark:text-brand-300">{percent(metrics?.accuracy?.mean)}</p>
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t('progress.accuracyHint')}</p>
          {metrics?.accuracy?.trend?.length ? <div data-testid="progress-accuracy-chart" className="mt-3 h-48 min-w-0 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={metrics.accuracy.trend} margin={{ top: 8, right: 12, bottom: 8, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip dateLabel={dateLabel} formatValue={(value) => percent(Number(value))} />} />
                <Line name={t('progress.accuracy')} dataKey="accuracy" stroke="#a8a29e" strokeWidth={1} dot={false} connectNulls={false} />
                <Line name={t('progress.movingAverage')} dataKey="mean" stroke="#b85b39" strokeWidth={3} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div> : <Empty>{t('progress.noAnalysis')}</Empty>}
        </Card>

        <Card id="phases" title={t('progress.phasesTitle')}>
          <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">{t('progress.phasesHint')}</p>
          <div className="space-y-3">
            {(metrics?.phases ?? []).map((phase) => <div key={phase.phase} data-testid={`progress-phase-${PHASES[phase.phase] ?? 'unknown'}`} className="rounded-xl bg-ink-50 dark:bg-ink-800 p-3">
              <p className="font-bold text-sm text-ink-800 dark:text-ink-100">{phaseName(phase.phase)}</p>
              <p className="mb-2 text-xs text-ink-500 dark:text-ink-400">{t('progress.classifiedMoves', { n: phase.moves })}</p>
              <div className="grid grid-cols-3 gap-1 text-xs text-ink-600 dark:text-ink-300">{LABELS.map((label) => <div key={label}><p>{t(`progress.label.${label}`)}</p><p className="font-black text-base">{num(phase.rates[label])}</p></div>)}</div>
            </div>)}
            {!metrics?.phases?.some((phase) => phase.moves > 0) && <Empty>{t('progress.noAnalysis')}</Empty>}
          </div>
        </Card>

        <Card id="weaknesses" title={t('progress.weaknessesTitle')}>
          {metrics?.weaknesses?.length ? <ol className="space-y-3">
            {metrics.weaknesses.slice(0, 3).map((weakness, i) => <li key={`${weakness.kind}-${weakness.key}`} data-testid={`progress-weakness-${i}`} className="rounded-xl bg-ink-50 dark:bg-ink-800 p-3 space-y-2">
              <p className="font-bold text-sm text-ink-800 dark:text-ink-100 break-words">{weaknessName(weakness)}</p>
              <p className="text-sm text-ink-600 dark:text-ink-300">{t('progress.weaknessEvidence', { n: weakness.count, games: weakness.games, blunders: weakness.blunders, mistakes: weakness.mistakes, inaccuracies: weakness.inaccuracies })}</p>
              <p className="text-xs text-ink-500 dark:text-ink-400">{t('progress.weaknessScore', { score: num(weakness.score, 3), frequency: num(weakness.frequency, 3), severity: num(weakness.severity, 3), recency: num(weakness.recency, 3) })}</p>
            </li>)}
          </ol> : <Empty>{t('progress.noWeaknesses')}</Empty>}
        </Card>

        <GatedCard premium={premium} id="openings" title={t('progress.openingsTitle')}>
          {metrics?.openings?.length ? <div className="space-y-3">
            {['w', 'b'].map((color) => <div key={color}>
              <h3 className="mb-2 font-bold text-sm text-ink-700 dark:text-ink-200">{t(`progress.color.${color}`)}</h3>
              {metrics.openings.filter((opening) => opening.color === color).sort((a, b) => (b.pointsPercent ?? 0) - (a.pointsPercent ?? 0)).map((opening) => <div key={opening.key} data-testid="progress-opening" className="mb-2 rounded-xl bg-ink-50 dark:bg-ink-800 p-3">
                <p className="font-bold text-sm text-ink-800 dark:text-ink-100 break-words">{opening.name || t('progress.unknownOpening')}</p>
                {openingRank(opening) && <p data-testid={`progress-opening-${openingRank(opening)}`} className="mt-1 text-xs font-bold text-brand-700 dark:text-brand-300">{t(`progress.openingRank.${openingRank(opening)}`)}</p>}
                <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-300">{t('progress.openingStats', { n: opening.games, points: percent(opening.pointsPercent), accuracy: percent(opening.accuracy) })}</p>
                {opening.mostFrequentError && <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{t('progress.openingError', { error: motifName(opening.mostFrequentError.key), n: opening.mostFrequentError.count })}</p>}
              </div>)}
              {!metrics.openings.some((opening) => opening.color === color) && <Empty>{t('progress.noOpenings')}</Empty>}
            </div>)}
          </div> : <Empty>{t('progress.noOpenings')}</Empty>}
        </GatedCard>

        <GatedCard premium={premium} id="conversion" title={t('progress.conversionTitle')}>
          <p data-testid="progress-conversion-value" className="text-3xl font-black text-brand-700 dark:text-brand-300">{percent(metrics?.conversion?.rate)}</p>
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t('progress.conversionStats', { n: metrics?.conversion?.missed ?? 0, total: metrics?.conversion?.eligible ?? 0 })}</p>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t('progress.conversionHint')}</p>
        </GatedCard>

        <GatedCard premium={premium} id="time-trouble" title={t('progress.timeTitle')}>
          <p data-testid="progress-time-value" className="text-3xl font-black text-brand-700 dark:text-brand-300">{percent(metrics?.timeTrouble?.rate)}</p>
          <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">{t('progress.timeStats', { n: metrics?.timeTrouble?.errors ?? 0, total: metrics?.timeTrouble?.moves ?? 0 })}</p>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">{t('progress.timeHint')}</p>
          {!metrics?.timeTrouble?.clockMoves && <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">{t('progress.noClocks')}</p>}
        </GatedCard>
      </div>
    </>}
  </div>;
}
