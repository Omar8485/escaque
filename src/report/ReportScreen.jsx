import React, { useEffect, useRef, useState } from 'react';
import { importLichess } from '../import/lichess.js';
import { importChessCom } from '../import/chesscom.js';
import { isAbort } from '../import/net.js';
import { listGames } from '../import/store.js';
import { useI18n } from '../i18n/useI18n.js';
import { formatDate, formatNumber } from '../i18n/core.js';
import { FREE_LIMITS } from '../premium/limits.js';
import { track } from '../analytics/track.js';
import { buildReport, gamesForReport, MIN_COLOR_GAMES } from './buildReport.js';
import { nearestRivalLevel } from './rival.js';
import ReportErrors from './ReportErrors.jsx';

const PLATFORMS = { lichess: { name: 'Lichess', load: importLichess }, chesscom: { name: 'Chess.com', load: importChessCom } };
const section = 'min-w-0 rounded-2xl border border-ink-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900';
const primary = 'min-h-11 rounded-xl bg-brand-600 px-4 py-2 font-bold text-white hover:bg-brand-700 disabled:opacity-50';
const secondary = 'min-h-11 rounded-xl border border-ink-200 bg-white px-4 py-2 font-bold text-ink-700 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100 disabled:opacity-50';

function ReportView({ report, games, onPractice, onRefresh, pending }) {
  const { t, lang } = useI18n();
  const num = (n) => formatNumber(lang, n);
  const pct = (n) => formatNumber(lang, n / 100, { style: 'percent' });
  const { period, rating, highlights, bySpeed, timeLosses, form, openings } = report;
  const colors = Object.entries(report.colors).filter(([, item]) => item.n >= MIN_COLOR_GAMES);
  const outcomeText = { W: 'win', D: 'draw', L: 'loss' };
  const outcomeStyle = { W: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    D: 'bg-ink-100 dark:bg-ink-800', L: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' };

  return <article data-testid="report-view" className="space-y-4" aria-labelledby="report-user">
    <header className={section}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="report-user" className="break-words text-2xl font-black">{report.username}</h2>
          <p className="text-sm text-ink-600 dark:text-ink-300">
            {PLATFORMS[report.platform].name} · {t('report.games', { n: report.gameCount, value: num(report.gameCount) })}
          </p>
          {period.from && <p className="text-sm text-ink-600 dark:text-ink-300">
            <time dateTime={new Date(period.from).toISOString()}>{formatDate(lang, period.from)}</time>
            {period.to !== period.from && <> – <time dateTime={new Date(period.to).toISOString()}>{formatDate(lang, period.to)}</time></>}
          </p>}
        </div>
        <button type="button" data-testid="report-refresh" disabled={pending} className={secondary} onClick={onRefresh}>{t('report.refresh')}</button>
      </div>
      {rating && <p data-testid="report-rating" className="mt-3 font-semibold">
        {t('report.rating', { rating: num(rating.current), speed: t(`speed.${rating.speed}`) })}
        {rating.delta30 !== null && <> · {t('report.ratingChange', { delta: formatNumber(lang, rating.delta30, { signDisplay: 'exceptZero' }) })}</>}
      </p>}
    </header>

    {!!highlights.length && <ul className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
      {highlights.map(({ id, vars }, index) => <li key={id} data-testid={`report-highlight-${index}`} className="rounded-2xl border border-brand-200 bg-brand-50 p-4 font-bold dark:border-brand-900 dark:bg-brand-950">
        {t(`report.highlight.${id}`, { ...vars, n: num(vars.n), pct: pct(vars.pct) })}
      </li>)}
    </ul>}

    <div className="grid gap-4 md:grid-cols-2">
      {bySpeed.length > 0 && <section className={section} data-testid="report-by-speed">
        <h3 className="mb-2 text-lg font-bold">{t('report.bySpeed')}</h3>
        <table className="w-full text-sm tabular-nums">
          <thead><tr>
            <th scope="col" className="text-left">{t('progress.speedLabel')}</th>
            {['W', 'D', 'L'].map((outcome) => <th scope="col" key={outcome} title={t(`report.outcome.${outcomeText[outcome]}`)}>{t(`report.short.${outcomeText[outcome]}`)}</th>)}
          </tr></thead>
          <tbody>{bySpeed.map(({ speed, w, d, l }) => <tr className="border-t border-ink-100 dark:border-ink-800" key={speed}>
            <th scope="row" className="py-2 text-left font-medium">{t(`speed.${speed}`)}</th>
            {[w, d, l].map((value, index) => <td key={index} className="text-center">{num(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </section>}
      {colors.length > 0 && <section className={section} data-testid="report-colors">
        <h3 className="text-lg font-bold">{t('report.byColor')}</h3>
        <dl className="mt-2 space-y-2">{colors.map(([color, { n, score }]) => <div key={color} className="flex justify-between gap-3">
          <dt>{t(color === 'w' ? 'common.white' : 'common.black')}</dt>
          <dd className="text-right">{t('report.score', { pct: pct(score), n: num(n) })}</dd>
        </div>)}</dl>
      </section>}
      {['best', 'worst'].map((kind) => openings[kind].length > 0 && <section key={kind} className={section} data-testid={`report-openings-${kind}`}>
        <h3 className="text-lg font-bold">{t(`report.openings.${kind}`)}</h3>
        <ul className="mt-2 space-y-2">{openings[kind].map(({ name, eco, n, score }) => <li key={name} className="break-words">
          <span className="font-medium">{name}</span>{eco && <span className="ml-2 text-xs text-ink-600 dark:text-ink-400">{eco}</span>}
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('report.score', { pct: pct(score), n: num(n) })}</p>
        </li>)}</ul>
      </section>)}
      {timeLosses && <section className={section} data-testid="report-time-losses">
        <h3 className="text-lg font-bold">{t('report.timeLosses')}</h3>
        <p className="mt-2">{t('report.timeLossesSample', { n: num(timeLosses.n), pct: pct(timeLosses.pct) })}</p>
      </section>}
      {form.length > 0 && <section className={section} data-testid="report-form-recent">
        <h3 className="text-lg font-bold">{t('report.recentForm')}</h3>
        <p className="text-sm text-ink-600 dark:text-ink-300">{t('report.newestFirst')}</p>
        <ol className="mt-3 flex flex-wrap gap-1.5">{form.map((outcome, index) => <li key={index} className={`rounded-md px-2 py-1 text-sm font-bold ${outcomeStyle[outcome]}`} aria-label={t(`report.outcome.${outcomeText[outcome]}`)}>
          {t(`report.short.${outcomeText[outcome]}`)}
        </li>)}</ol>
      </section>}
    </div>

    <div className={section}>
      <button type="button" data-testid="report-cta-play" className={primary} onClick={() => onPractice(nearestRivalLevel(rating?.current))}>{t('report.play')}</button>
    </div>
    <ReportErrors key={JSON.stringify(games.map((game) => game.id))} games={games} username={report.username} />
  </article>;
}

export default function ReportScreen({ onPractice }) {
  const { t, lang } = useI18n();
  const [platform, setPlatform] = useState('lichess');
  const [username, setUsername] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const request = useRef(null);

  useEffect(() => () => request.current?.abort(), []);

  const load = async (refresh = false) => {
    const name = username.trim();
    if (!name || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setError(null);
    setProgress({ phase: 'connecting' });
    track('report_start');
    try {
      const options = { username: name, platform };
      let games = gamesForReport(await listGames(), options);
      signal.throwIfAborted();
      if (!games.length || refresh) {
        await PLATFORMS[platform].load(name, {
          max: FREE_LIMITS.recentGames, recentOnly: true, signal,
          onProgress: (value) => { if (!signal.aborted) setProgress(value); },
        });
        signal.throwIfAborted();
        games = await listGames();
      }
      signal.throwIfAborted();
      const data = buildReport(games, options);
      if (!data.gameCount) {
        setError({ key: 'report.noGames' });
        return;
      }
      setReport({ data, games: gamesForReport(games, options).slice(0, 10) });
      track('report_done');
    } catch (err) {
      if (!signal.aborted && !isAbort(err)) setError({ key: err?.textKey ?? 'report.unavailable', vars: err?.vars });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setProgress(null);
      }
    }
  };

  const changeInput = (setter, value) => {
    setter(value);
    setError(null);
    setReport(null);
  };
  const pending = Boolean(progress);
  const num = (n) => formatNumber(lang, n);

  return <div className="mx-auto w-full max-w-5xl space-y-4 pb-4">
    <form data-testid="report-form" className={section} onSubmit={(event) => { event.preventDefault(); load(); }}>
      <h1 className="text-2xl font-black">{t('report.title')}</h1>
      <p className="mb-4 mt-1 text-sm text-ink-600 dark:text-ink-300">{t('report.description', { n: num(FREE_LIMITS.recentGames) })}</p>
      <fieldset className="flex flex-wrap gap-2" aria-label={t('report.platform')} disabled={pending}>
        {Object.entries(PLATFORMS).map(([id, { name }]) => <button key={id} type="button" data-testid={`report-platform-${id}`} aria-pressed={platform === id}
          className={platform === id ? primary : secondary} onClick={() => { if (platform !== id) changeInput(setPlatform, id); }}>{name}</button>)}
      </fieldset>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-40 text-sm font-bold">
          {t('report.username')}
          <input data-testid="report-username" value={username} onChange={(event) => changeInput(setUsername, event.target.value)} disabled={pending}
            required maxLength={30} autoCapitalize="none" autoComplete="username" spellCheck={false}
            className="mt-1 min-h-11 w-full rounded-xl border border-ink-300 bg-white px-3 dark:border-ink-600 dark:bg-ink-950" />
        </label>
        <button type="submit" data-testid="report-submit" disabled={pending || !username.trim()} className={primary}>{t('report.submit')}</button>
      </div>
      {platform === 'chesscom' && <p className="mt-2 text-xs text-ink-600 dark:text-ink-400">{t('myGames.chesscomDisclaimer')}</p>}
      {progress && <div className="mt-3 flex flex-wrap items-center gap-2">
        <p role="status" data-testid="report-progress">{t(`report.progress.${progress.phase === 'waiting' ? 'waiting' : 'reading'}`, {
          n: num(progress.received ?? 0), seconds: num(Math.ceil((progress.waitMs ?? 0) / 1000)),
        })}</p>
        <button type="button" data-testid="report-cancel" onClick={() => request.current?.abort()} className={secondary}>{t('common.cancel')}</button>
      </div>}
      {error && <p role="alert" data-testid="report-error" className="mt-3 text-rose-700 dark:text-rose-300">{t(error.key, error.vars)}</p>}
    </form>
    {report && <ReportView report={report.data} games={report.games} onPractice={onPractice} onRefresh={() => load(true)} pending={pending} />}
  </div>;
}
