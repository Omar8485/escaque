import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n.js';
import PremiumLock from '../premium/PremiumLock.jsx';
import { formatNumber } from '../i18n/core.js';
import { useProgressMetrics } from '../progress/useProgressMetrics.js';
import { get, getMeta, STORES } from '../storage/db.js';
import { isCurrentAnalysis } from '../puzzles/generator/runner.js';
import { GENERATOR_META_KEY, resumeInterruptedGeneration, useGeneratePuzzles } from '../puzzles/generator/useGeneratePuzzles.js';

const LOADING = { loading: true };
const sameScope = (left, right) => left?.username === right.username
  && left.gameIds.length === right.gameIds.length && left.gameIds.every((id, index) => id === right.gameIds[index]);

function ErrorMotif({ motif, index, t, lang }) {
  return <div data-testid={`report-error-motif-${index}`} className="rounded-xl bg-ink-50 p-3 dark:bg-ink-800">
    <strong>{t(`progress.motif.${motif.motif}`)}</strong>
    <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{t('report.errorOccurrences', { n: formatNumber(lang, motif.count) })}</p>
  </div>;
}

export default function ReportErrors({ games, username }) {
  const { t, lang } = useI18n();
  const generator = useGeneratePuzzles();
  const scope = useMemo(() => ({ username: username.toLowerCase(), gameIds: games.map((game) => game.id) }), [games, username]);
  const [savedStatus, setSavedStatus] = useState(null);
  const [snapshot, setSnapshot] = useState(LOADING);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getMeta(GENERATOR_META_KEY).then((meta) => {
      if (!active || !sameScope(meta?.scope, scope)) return;
      setSavedStatus(meta.status);
      if (meta.status === 'running') resumeInterruptedGeneration();
    }).catch(() => {});
    return () => { active = false; };
  }, [scope]);

  const ownsScope = sameScope(generator.scope, scope);
  const running = ownsScope && generator.status !== 'idle';
  const result = ownsScope && generator.result;
  const status = result?.status ?? savedStatus;
  const completed = status === 'done' && !running;

  useEffect(() => {
    if (!completed) return;
    let active = true;
    Promise.all(games.map((game) => get(STORES.analysis, game.id)))
      .then((analysis) => {
        if (active) setSnapshot({ games, analysis: analysis.filter(isCurrentAnalysis) });
      })
      .catch(() => { if (active) setSnapshot({ error: true }); });
    return () => { active = false; };
  }, [completed, games]);

  const { metrics, error, loading } = useProgressMetrics(snapshot, {});
  const motifs = metrics?.motifs.filter(({ motif, count }) => motif !== 'unknown' && count >= 2).slice(0, 3) ?? [];

  const start = async () => {
    setBusy(false);
    setSavedStatus(null);
    setSnapshot(LOADING);
    const response = await generator.start({ scope });
    if (response?.status === 'busy') setBusy(true);
  };

  return <section data-testid="report-errors" className="rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900">
    <h2 className="text-lg font-bold">{t('report.errorsTitle')}</h2>
    <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">{t('report.errorsDescription', { n: formatNumber(lang, games.length) })}</p>
    {running && <div className="mt-3 flex flex-wrap items-center gap-3">
      <p role="status" data-testid="report-errors-progress">{t('report.errorsProgress', {
        done: formatNumber(lang, generator.progress?.done ?? 0), total: formatNumber(lang, games.length),
      })}</p>
      <button type="button" data-testid="report-errors-cancel" onClick={generator.cancel} disabled={generator.status === 'cancelling'}>{t('common.cancel')}</button>
    </div>}
    {completed && loading && <p role="status" className="mt-3">{t('report.errorsReading')}</p>}
    {(error || (ownsScope && generator.error)) && <p role="alert" className="mt-3">{t('report.errorsFailed')}</p>}
    {busy && <p role="status" className="mt-3">{t('report.errorsBusy')}</p>}
    {completed && !loading && !error && (motifs.length
      ? <ol className="mt-3 grid gap-2">
        {motifs.map((motif, index) => {
          const content = <ErrorMotif motif={motif} index={index} t={t} lang={lang} />;
          return <li key={motif.motif}>{index === 0 ? content : <PremiumLock feature="repeatedErrors" compact preview={
            <p className="rounded-lg bg-white p-2 text-sm font-semibold dark:bg-ink-800">{t('premium.preview.repeatedErrors')}</p>
          }>{content}</PremiumLock>}</li>;
        })}
      </ol>
      : <p className="mt-3">{t('report.errorsEmpty')}</p>)}
    {(!completed || error) && !running && <button type="button" data-testid="report-cta-errors" onClick={start} className="mt-3 min-h-11 rounded-xl font-bold">
      {t(status === 'cancelled' || status === 'running' ? 'report.resumeErrors' : 'report.findErrors')}
    </button>}
  </section>;
}
