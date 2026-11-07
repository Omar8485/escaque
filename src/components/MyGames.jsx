import { emitRewardEvent } from '../rewards/events';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileUp, Loader2, Trash2, X, Link2, Info } from 'lucide-react';
import { importLichess, isValidLichessUsername, DEFAULT_MAX_GAMES } from '../import/lichess';
import { importChessCom, isValidChessComUsername } from '../import/chesscom';
import { readPgnFiles, importPgnGames } from '../import/pgn';
import { clearAllGames, getAccounts, getImportMark, setAccount } from '../import/store';
import { usePremium } from '../premium/planStore';
import { importMax } from '../premium/gate';
import { FREE_LIMITS } from '../premium/limits';
import PremiumNotice from '../premium/PremiumNotice';
import { SPEEDS, displayPlayerName, opponentOf, outcomeFor, userEloOf } from '../import/normalize';
import { importErrorText, isAbort } from '../import/net';
import { useI18n } from '../i18n/useI18n';
import { formatDate, formatDateTime } from '../i18n/core';

/** @typedef {import('../storage/db.js').Game} Game */

const PAGE = 50;
const card = 'bg-white dark:bg-ink-900 p-5 rounded-3xl shadow-sm border border-ink-100 dark:border-ink-800';
const input =
  'w-full bg-ink-50 dark:bg-ink-800/60 border border-ink-200 dark:border-ink-700 rounded-xl px-3 py-2 text-sm text-ink-800 dark:text-ink-100 placeholder:text-ink-400';
const btn = 'px-4 py-2 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-40';
const btnPrimary = `${btn} bg-brand-600 hover:bg-brand-700 text-white`;
const btnGhost = `${btn} bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700`;

const OUTCOME_CLS = {
  win: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300',
  loss: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300',
  draw: 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
};

/** Texto del progreso de una importación. */
function progressText(p, t) {
  if (!p) return '';
  if (p.phase === 'connecting') return t('myGames.connecting');
  if (p.phase === 'waiting') return t('myGames.waiting', { s: Math.ceil((p.waitUntil - Date.now()) / 1000) });
  const detail = p.detail ? t('myGames.month', { month: p.detail }) : '';
  return `${t(p.total ? 'myGames.readOfMax' : 'myGames.read', { received: p.received, total: p.total, added: p.added })}${detail}`;
}

function resultText(r, t) {
  if (r.aborted) return t('myGames.cancelledSaved', { n: r.added });
  let s = r.added === 0 ? t('myGames.noNew') : t('myGames.doneNew', { n: r.added });
  if (r.skipped) s += ` ${t('myGames.skipped', { n: r.skipped })}`;
  if (r.hasMore) s += ` ${t('myGames.hasMore')}`;
  return s;
}

/**
 * Los mensajes guardan qué pasó (resultado, error o clave), no el texto: así se traducen al
 * pintar y cambiar de idioma traduce también el mensaje que se ve.
 */
function messageText(m, t) {
  if (m.result) return resultText(m.result, t);
  if (m.error) return importErrorText(m.error, t);
  return t(m.key, m.vars);
}

/** Tarjeta para vincular una cuenta e importar sus partidas. */
function AccountImporter({ source, title, placeholder, validate, run, account, onAccount, footer }) {
  const { t, lang } = useI18n();
  const [username, setUsername] = useState(account ?? '');
  const [mode, setMode] = useState('latest'); // latest | since
  const [max, setMax] = useState(DEFAULT_MAX_GAMES);
  const premium = usePremium();
  // Plan gratuito: cada importación trae como mucho las últimas 50 partidas (src/premium/limits.js).
  const shownMax = premium ? max : importMax(max, false);
  const [since, setSince] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [mark, setMark] = useState(null);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);
  const ctrlRef = useRef(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (account) setUsername((u) => u || account);
  }, [account]);
  const user = username.trim();
  useEffect(() => {
    let alive = true;
    if (!validate(user)) {
      setMark(null);
      return undefined;
    }
    getImportMark(source, user).then((m) => alive && setMark(m ?? null), () => {});
    return () => {
      alive = false;
    };
  }, [source, user, validate, progress?.phase]);
  // Cuenta atrás visible mientras el servicio pide esperar.
  useEffect(() => {
    if (progress?.phase !== 'waiting') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [progress?.phase]);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  const running = Boolean(progress) && progress.phase !== 'done';
  const incremental = onlyNew && Boolean(mark);
  const start = async () => {
    if (!validate(user)) {
      setMessage({ kind: 'error', key: 'myGames.invalidUser' });
      return;
    }
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setMessage(null);
    setProgress({ phase: 'connecting', received: 0, added: 0 });
    try {
      const r = await run(user, {
        max: importMax(incremental || mode === 'latest' ? Math.max(1, Number(max) || DEFAULT_MAX_GAMES) : null, premium),
        since: !incremental && mode === 'since' && since ? Date.parse(`${since}T00:00:00Z`) : null,
        incremental: onlyNew,
        signal: ctrl.signal,
        onProgress: (p) => setProgress(p.phase === 'waiting' ? { ...p, waitUntil: Date.now() + p.waitMs } : p),
      });
      await onAccount(source, user);
      emitRewardEvent('import-completed', { count: r.added ?? r.imported ?? r.newGames ?? 0 });
      setMessage({ kind: r.aborted ? 'info' : 'ok', result: r });
    } catch (e) {
      setMessage(isAbort(e) ? { kind: 'info', key: 'myGames.cancelled' } : { kind: 'error', error: e });
    } finally {
      setProgress(null);
      ctrlRef.current = null;
    }
  };

  const pct = progress?.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;
  return (
    <section data-testid={`import-${source}`} className={card}>
      <h3 className="font-bold text-ink-800 dark:text-ink-100 flex items-center gap-2 mb-3">
        <Link2 size={18} className="text-brand-600" /> {title}
      </h3>
      <label className="block text-xs font-bold text-ink-500 dark:text-ink-400 mb-1" htmlFor={`user-${source}`}>
        {t('myGames.yourUser')}
      </label>
      <input
        id={`user-${source}`}
        data-testid={`username-${source}`}
        className={input}
        value={username}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={running}
        onChange={(e) => setUsername(e.target.value)}
      />
      {account && (
        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1 flex items-center gap-2">
          {t('myGames.linked')} <b className="text-ink-700 dark:text-ink-200">{account}</b>
          <button type="button" className="underline bg-transparent p-0 text-xs" disabled={running} onClick={() => onAccount(source, null)}>
            {t('myGames.unlink')}
          </button>
        </p>
      )}

      <div className="mt-3 space-y-2 text-sm text-ink-700 dark:text-ink-200">
        {mark && (
          <label className="flex items-center gap-2">
            <input type="checkbox" data-testid={`only-new-${source}`} checked={onlyNew} disabled={running} onChange={(e) => setOnlyNew(e.target.checked)} />
            {t('myGames.onlyNew')}
          </label>
        )}
        {!incremental && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" name={`mode-${source}`} checked={mode === 'latest'} disabled={running} onChange={() => setMode('latest')} />
              {t('myGames.latest')}
              <input
                type="number"
                min={1}
                max={premium ? 5000 : FREE_LIMITS.recentGames}
                data-testid={`max-${source}`}
                className={`${input} !w-24 !py-1`}
                value={shownMax}
                disabled={running || mode !== 'latest'}
                onChange={(e) => setMax(e.target.value)}
              />
              {t('myGames.games')}
            </label>
            <label className="flex items-center gap-2 flex-wrap">
              <input type="radio" name={`mode-${source}`} checked={mode === 'since'} disabled={running} onChange={() => setMode('since')} />
              {t('myGames.since')}
              <input type="date" className={`${input} !w-auto !py-1`} value={since} disabled={running || mode !== 'since'} onChange={(e) => setSince(e.target.value)} />
            </label>
          </div>
        )}
        {!premium && <PremiumNotice compact testId={`import-premium-${source}`} text={t('premium.notice.import', { n: FREE_LIMITS.recentGames })} />}
        {mark && (
          <p className="text-xs text-ink-500 dark:text-ink-400">
            {t('myGames.lastImport', { date: formatDateTime(lang, mark.lastImportAt), n: mark.total })}
          </p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {!running ? (
          <button type="button" data-testid={`import-btn-${source}`} className={`${btnPrimary} flex-1`} onClick={start}>
            <Download size={16} /> {t('myGames.import')}
          </button>
        ) : (
          <button type="button" data-testid={`cancel-${source}`} className={`${btnGhost} flex-1`} onClick={() => ctrlRef.current?.abort()}>
            <X size={16} /> {t('common.cancel')}
          </button>
        )}
      </div>

      {running && (
        <div className="mt-3" data-testid={`progress-${source}`} role="status" aria-live="polite">
          <div className="h-2 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
            <div
              className={`h-full bg-brand-500 transition-all ${pct == null ? 'w-1/3 animate-pulse' : ''}`}
              style={pct == null ? undefined : { width: `${Math.max(3, pct)}%` }}
            />
          </div>
          <p className="text-xs text-ink-600 dark:text-ink-300 mt-1 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> {progressText(progress, t)}
          </p>
        </div>
      )}
      {message && (
        <p
          data-testid={`message-${source}`}
          className={`mt-3 text-sm ${message.kind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-ink-700 dark:text-ink-200'}`}
        >
          {messageText(message, t)}
        </p>
      )}
      {footer}
    </section>
  );
}

/** Subida de archivos .pgn: leer → confirmar quién eres → guardar. */
function PgnUploader() {
  const { t } = useI18n();
  const [read, setRead] = useState(null);
  const [player, setPlayer] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const fileRef = useRef(null);

  const onFiles = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await readPgnFiles([...files]);
      if (!r.entries.length) {
        setMessage({ kind: 'error', key: 'myGames.pgnNone' });
        setRead(null);
      } else {
        setRead(r);
        setPlayer(r.suggested ?? r.candidates[0]?.name ?? '');
      }
    } catch (e) {
      setMessage({ kind: 'error', key: 'myGames.pgnReadError', vars: { error: e?.message ?? String(e) } });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await importPgnGames(read.entries, player || null);
      emitRewardEvent('import-completed', { count: r.added ?? r.imported ?? r.newGames ?? 0 });
      setMessage({ kind: 'ok', result: { ...r, hasMore: false, aborted: false } });
      setRead(null);
    } catch (e) {
      setMessage({ kind: 'error', error: e });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="import-pgn" className={card}>
      <h3 className="font-bold text-ink-800 dark:text-ink-100 flex items-center gap-2 mb-2">
        <FileUp size={18} className="text-brand-600" /> {t('myGames.pgnTitle')}
      </h3>
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">{t('myGames.pgnHelp')}</p>
      <input
        ref={fileRef}
        data-testid="pgn-input"
        type="file"
        accept=".pgn,application/x-chess-pgn,text/plain"
        multiple
        disabled={busy}
        onChange={(e) => onFiles(e.target.files)}
        className="block w-full text-sm text-ink-600 dark:text-ink-300 file:mr-3 file:px-3 file:py-2 file:rounded-xl file:border-0 file:bg-ink-100 dark:file:bg-ink-800 file:text-ink-700 dark:file:text-ink-200 file:font-bold"
      />
      {read && (
        <div className="mt-3 space-y-2" data-testid="pgn-confirm">
          <p className="text-sm text-ink-700 dark:text-ink-200">
            {t('myGames.pgnFound', { n: read.entries.length, files: t('myGames.files', { n: read.files }) })}
            {read.duplicates ? t('myGames.duplicates', { n: read.duplicates }) : ''}. {t('myGames.whoAreYou')}
          </p>
          <select data-testid="pgn-player" className={input} value={player} onChange={(e) => setPlayer(e.target.value)}>
            {read.candidates.slice(0, 8).map((c) => (
              <option key={c.name} value={c.name}>
                {t('myGames.candidate', { name: c.name, n: c.count })}
              </option>
            ))}
            <option value="">{t('myGames.notMine')}</option>
          </select>
          <div className="flex gap-2">
            <button type="button" data-testid="pgn-save" className={`${btnPrimary} flex-1`} disabled={busy} onClick={save}>
              {t('myGames.importN', { n: read.entries.length })}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => setRead(null)}>
              {t('myGames.discard')}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p data-testid="message-pgn" className={`mt-3 text-sm ${message.kind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-ink-700 dark:text-ink-200'}`}>
          {messageText(message, t)}
        </p>
      )}
    </section>
  );
}

/**
 * Sección "Mis partidas": vincular cuentas, importar, subir PGN y ver/filtrar/borrar las partidas.
 * @param {{games: Game[], loading: boolean, onOpenGame: (g: Game) => void}} props
 */
const MyGames = ({ games, loading, onOpenGame }) => {
  const { t, lang } = useI18n();
  const [accounts, setAccounts] = useState({});
  const [filters, setFilters] = useState({ source: 'all', speed: 'all', outcome: 'all' });
  const [shown, setShown] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    getAccounts().then(setAccounts, () => {});
  }, []);
  const sourceName = (s) => (['lichess', 'chesscom', 'pgn', 'demo', 'escaque'].includes(s) ? t(`myGames.sourceName.${s}`) : s);
  const onAccount = async (source, username) => setAccounts(await setAccount(source, username));

  const filtered = useMemo(
    () =>
      games.filter(
        (g) =>
          (filters.source === 'all' || g.source === filters.source) &&
          (filters.speed === 'all' || g.speed === filters.speed) &&
          (filters.outcome === 'all' || (outcomeFor(g) ?? 'unknown') === filters.outcome),
      ),
    [games, filters],
  );
  const sources = useMemo(() => [...new Set(games.map((g) => g.source))], [games]);
  const speeds = useMemo(() => [...SPEEDS, 'unknown'].filter((s) => games.some((g) => g.speed === s)), [games]);
  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setShown(PAGE);
  };

  return (
    <div data-testid="my-games" className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4 pb-10 flex-shrink-0">
      <div className="flex flex-col gap-4">
        <AccountImporter
          source="lichess"
          title="Lichess"
          placeholder={t('myGames.userPlaceholder', { site: 'Lichess' })}
          validate={isValidLichessUsername}
          run={importLichess}
          account={accounts.lichess}
          onAccount={onAccount}
        />
        <AccountImporter
          source="chesscom"
          title="Chess.com"
          placeholder={t('myGames.userPlaceholder', { site: 'Chess.com' })}
          validate={isValidChessComUsername}
          run={importChessCom}
          account={accounts.chesscom}
          onAccount={onAccount}
          footer={
            <p data-testid="chesscom-disclaimer" className="mt-3 text-[11px] text-ink-500 dark:text-ink-400 flex items-start gap-1">
              <Info size={12} className="mt-0.5 flex-shrink-0" /> {t('myGames.chesscomDisclaimer')} {t('myGames.chesscomApi')}
            </p>
          }
        />
        <PgnUploader />
        <p className="text-[11px] text-ink-500 dark:text-ink-400 px-2">
          {t('myGames.privacy')}
        </p>
      </div>

      <section className={`${card} min-h-[300px] flex flex-col`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-bold text-ink-800 dark:text-ink-100 text-lg">
            {t('myGames.yourGames')} <span data-testid="games-count" className="text-ink-500 dark:text-ink-400 font-bold text-sm">({games.length})</span>
          </h3>
          {games.length > 0 &&
            (confirmClear ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-ink-700 dark:text-ink-200">{t('myGames.confirmClear', { n: games.length })}</span>
                <button
                  type="button"
                  data-testid="clear-confirm"
                  className={`${btn} bg-rose-600 hover:bg-rose-700 text-white`}
                  onClick={async () => {
                    await clearAllGames();
                    setConfirmClear(false);
                  }}
                >
                  {t('myGames.yesClear')}
                </button>
                <button type="button" className={btnGhost} onClick={() => setConfirmClear(false)}>
                  {t('common.no')}
                </button>
              </div>
            ) : (
              <button type="button" data-testid="clear-games" className={btnGhost} onClick={() => setConfirmClear(true)}>
                <Trash2 size={16} /> {t('myGames.clearAll')}
              </button>
            ))}
        </div>

        {loading ? (
          <p className="text-sm text-ink-500">{t('myGames.loading')}</p>
        ) : games.length === 0 ? (
          <div data-testid="games-empty" className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-10">
            <Download size={36} className="text-brand-500" />
            <p className="font-bold text-ink-800 dark:text-ink-100">{t('games.importCta')}</p>
            <p className="text-sm text-ink-500 dark:text-ink-400 max-w-sm">
              {t('myGames.emptyBody')}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <select data-testid="filter-source" aria-label={t('myGames.source')} className={input} value={filters.source} onChange={(e) => setFilter('source', e.target.value)}>
                <option value="all">{t('myGames.allSources')}</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {sourceName(s)}
                  </option>
                ))}
              </select>
              <select data-testid="filter-speed" aria-label={t('myGames.speedLabel')} className={input} value={filters.speed} onChange={(e) => setFilter('speed', e.target.value)}>
                <option value="all">{t('myGames.allSpeeds')}</option>
                {speeds.map((s) => (
                  <option key={s} value={s}>
                    {t(`speed.${s}`)}
                  </option>
                ))}
              </select>
              <select data-testid="filter-outcome" aria-label={t('myGames.result')} className={input} value={filters.outcome} onChange={(e) => setFilter('outcome', e.target.value)}>
                <option value="all">{t('myGames.allResults')}</option>
                <option value="win">{t('myGames.wins')}</option>
                <option value="loss">{t('myGames.losses')}</option>
                <option value="draw">{t('myGames.draws')}</option>
                <option value="unknown">{t('myGames.unknownResult')}</option>
              </select>
            </div>
            <p className="text-xs text-ink-500 dark:text-ink-400 mb-2" data-testid="games-filtered">
              {t('myGames.showing', { shown: Math.min(shown, filtered.length), total: filtered.length })}
            </p>
            <ul className="space-y-2" data-testid="games-list">
              {filtered.slice(0, shown).map((g) => {
                const outcome = outcomeFor(g);
                const opp = g.playerColor ? displayPlayerName(opponentOf(g), t) : `${displayPlayerName(g.white, t)} – ${displayPlayerName(g.black, t)}`;
                const oppElo = g.playerColor ? (g.playerColor === 'w' ? g.blackElo : g.whiteElo) : null;
                const myElo = userEloOf(g);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      data-testid="game-row"
                      data-game-id={g.id}
                      onClick={() => onOpenGame(g)}
                      title={t('myGames.openInAnalysis')}
                      className="w-full text-left p-3 rounded-xl border text-sm bg-ink-50 dark:bg-ink-800/60 border-ink-100 dark:border-ink-800 hover:bg-ink-100 dark:hover:bg-ink-700"
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-bold text-ink-700 dark:text-ink-200 truncate">
                          {g.playerColor ? t('myGames.vs') : ''}
                          {opp}
                          {oppElo ? <span className="font-normal text-ink-500"> ({oppElo})</span> : null}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${OUTCOME_CLS[outcome] ?? OUTCOME_CLS.draw}`}>
                          {OUTCOME_CLS[outcome] ? t(`myGames.outcome.${outcome}`) : g.result}
                        </span>
                      </div>
                      <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
                        {g.endTime ? formatDate(lang, g.endTime) : t('common.noDate')} · {t(`speed.${g.speed ?? 'unknown'}`)}
                        {g.timeControl ? ` ${g.timeControl}` : ''} · {sourceName(g.source)}
                        {myElo ? t('myGames.yourElo', { elo: myElo }) : ''}
                        {g.opening ? ` · ${g.opening}` : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtered.length > shown && (
              <button type="button" className={`${btnGhost} mt-3`} onClick={() => setShown((n) => n + PAGE)}>
                {t('myGames.more')}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default MyGames;
