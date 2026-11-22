import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronRight as Chevron, Undo2, Pause, Play, Flag, MoreHorizontal, RotateCcw, Palette, Lightbulb, Loader2, Settings2, Activity, Cpu } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import CoachPanel, { CoachActions, CoachPicker, CoachText } from '../components/CoachPanel';
import { CoachAvatar } from '../components/CoachAvatars';
import { RivalAvatar } from '../components/Avatars';
import MoveBadge from '../components/MoveBadge';
import BottomSheet from '../layout/BottomSheet';
import { useViewport } from '../layout/useViewport';
import { RIVAL_LEVELS, getRivalLevel } from '../engine/rivalLevels';
import { rivalEloText, rivalEpithet } from '../rivals/labels';
import { getCoach } from '../../shared/coach-contract/index.js';
import { coachVoice, moodForTone } from '../coach/templates';
import { usePremium } from '../premium/planStore';
import { nextBoardTheme } from '../premium/gate';
import { PLAYER_BAR_HEIGHT } from '../utils/boardLayout';
import { useI18n } from '../i18n/useI18n';
import { mobilePlayLayout, coachLine, coachAwaitsDecision } from './playLayout.js';

// Jugar en móvil (ronda M, M1; diseño móvil interno). Solo se usa por debajo de 960 px (App.jsx):
//  - Sin partida: tablero atenuado y encima la tarjeta de preparación (rival, coach, color,
//    ritmo y Jugar), sin desplazarse (A1). Rival y coach se eligen en hojas inferiores.
//  - En partida: barras de jugador, tablero a todo el ancho, línea del coach y controles (A2).
//    Si el coach te detiene, sube su hoja con Retroceder / ¿Por qué? / Seguir fijos al pie (A3).
//  - Horizontal: tablero a la izquierda ocupando el alto y el resto en una columna (A6).

const COLOR_OPTIONS = [
  { id: 'w', labelKey: 'common.white' },
  { id: 'b', labelKey: 'common.black' },
  { id: 'random', labelKey: 'setup.random' },
];
const TIME_CONTROLS = [60, 180, 300, 600];
const THEME_LABEL = { madera: 'board.wood', verde: 'board.green', azul: 'board.blue', arena: 'board.sand' };

const chip = (active, small = false) =>
  `min-h-[44px] px-0.5 rounded-lg ${small ? 'text-xs' : 'text-sm'} font-bold transition-all truncate ${
    active ? 'bg-white dark:bg-ink-700 text-ink-900 dark:text-ink-50 shadow' : 'bg-transparent text-ink-500 dark:text-ink-400'
  }`;
const ICON_BTN =
  'h-11 min-w-[44px] flex-1 p-0 rounded-xl flex items-center justify-center bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700 disabled:opacity-40';

/** Tarjeta de preparación (sobre el tablero en vertical; en la columna en horizontal). */
function SetupCard({ setup, compact, onPickRival, onPickCoach }) {
  const { t } = useI18n();
  const rival = getRivalLevel(setup.level);
  const coach = getCoach(setup.coachId);
  const pickBtn =
    'min-h-[52px] w-full flex items-center gap-2 p-2 rounded-xl bg-ink-50 dark:bg-ink-800 border border-ink-200 dark:border-ink-700 text-left hover:border-brand-400';
  const colorGroup = (
    <div role="radiogroup" aria-label={t('setup.color')} className="grid grid-cols-3 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl">
      {COLOR_OPTIONS.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={c.id === setup.colorChoice} data-testid={`color-${c.id}`} onClick={() => setup.onColorChange(c.id)} className={chip(c.id === setup.colorChoice, compact)}>
          {t(c.labelKey)}
        </button>
      ))}
    </div>
  );
  const timeGroup = (
    <div role="radiogroup" aria-label={t('setup.timeControl')} className="grid grid-cols-4 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl">
      {TIME_CONTROLS.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={s === setup.timeControl} data-testid={`time-${s / 60}`} onClick={() => setup.onTimeControlChange(s)} className={chip(s === setup.timeControl, compact)}>
          {s / 60}′
        </button>
      ))}
    </div>
  );
  return (
    <section
      data-testid="play-setup"
      aria-label={t('mplay.setup')}
      className="w-full max-w-[420px] bg-white/95 dark:bg-ink-900/95 backdrop-blur rounded-2xl shadow-2xl border border-ink-200 dark:border-ink-700 p-3 flex flex-col gap-2 text-ink-800 dark:text-ink-100"
    >
      <div className="grid grid-cols-2 gap-2">
        <button type="button" data-testid="play-setup-rival" aria-label={t('mplay.changeRival', { name: rival.name })} onClick={onPickRival} className={pickBtn}>
          <RivalAvatar level={rival.level} size={36} label={rival.name} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[10px] font-black uppercase tracking-wider text-ink-400">{t('mplay.rival')}</span>
            <span className="block font-black truncate">{rival.name}</span>
            <span className="block text-xs text-ink-500 dark:text-ink-400 truncate">{rivalEloText(rival, t)}</span>
          </span>
          <Chevron size={16} className="text-ink-400 flex-shrink-0" />
        </button>
        <button type="button" data-testid="play-setup-coach" aria-label={t('mplay.changeCoach', { name: coach.name })} onClick={onPickCoach} className={pickBtn}>
          <CoachAvatar coach={coach.id} mood="feliz" size={36} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[10px] font-black uppercase tracking-wider text-ink-400">{t('mplay.coach')}</span>
            <span className="block font-black truncate">{coach.name}</span>
          </span>
          <Chevron size={16} className="text-ink-400 flex-shrink-0" />
        </button>
      </div>
      {compact ? (
        <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-2">
          {colorGroup}
          {timeGroup}
        </div>
      ) : (
        <>
          {colorGroup}
          {timeGroup}
        </>
      )}
      {setup.goal && (
        <p data-testid="play-setup-goal" className="text-xs font-bold text-brand-800 dark:text-brand-200 bg-brand-50 dark:bg-brand-950 rounded-lg px-2 py-1.5 leading-snug">
          {setup.goal}
        </p>
      )}
      <button
        type="button"
        data-testid="play-start"
        onClick={setup.onStart}
        className="min-h-[48px] w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-black text-base flex items-center justify-center gap-2 shadow-lg"
      >
        <Play size={18} /> {t('setup.play', { name: rival.name })}
      </button>
    </section>
  );
}

/** Lista de rivales (hoja inferior) y "El rival habla". */
function RivalList({ setup, onPicked }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={t('setup.rival')} className="flex flex-col gap-1.5">
        {RIVAL_LEVELS.map((l) => {
          const active = l.level === setup.level;
          return (
            <button
              key={l.level}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t('setup.levelAria', { level: l.level, name: l.name, elo: rivalEloText(l, t) })}
              data-testid={`level-${l.level}`}
              onClick={() => {
                setup.onLevelChange(l.level);
                onPicked();
              }}
              className={`min-h-[52px] w-full flex items-center gap-3 px-2 py-1.5 rounded-xl text-left border ${
                active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-ink-50 dark:bg-ink-800 border-ink-100 dark:border-ink-700 text-ink-700 dark:text-ink-200'
              }`}
            >
              <RivalAvatar level={l.level} size={40} label={l.name} />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block font-black">{l.name}</span>
                <span className={`block text-xs truncate ${active ? 'text-white/80' : 'text-ink-500 dark:text-ink-400'}`}>{rivalEpithet(l, t)}</span>
              </span>
              <span className={`text-xs font-bold whitespace-nowrap ${active ? 'text-white' : 'text-ink-500 dark:text-ink-400'}`}>{rivalEloText(l, t)}</span>
            </button>
          );
        })}
      </div>
      {setup.onRivalVoiceChange && (
        <div data-testid="rival-voice" data-value={setup.rivalVoiceOn ? 'on' : 'off'} className="flex items-center justify-between gap-2 pt-1">
          <span id="m-rival-voice-label" className="text-sm font-bold text-ink-600 dark:text-ink-300">{t('setup.rivalTalks')}</span>
          <div role="radiogroup" aria-labelledby="m-rival-voice-label" className="grid grid-cols-2 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl w-32">
            {[true, false].map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={on === setup.rivalVoiceOn} data-testid={`rival-voice-${on ? 'on' : 'off'}`} onClick={() => setup.onRivalVoiceChange(on)} className={chip(on === setup.rivalVoiceOn)}>
                {on ? t('common.yes') : t('common.no')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Línea del coach bajo el tablero: avatar, resumen de lo último que dijo y botón de pista. */
function CoachStrip({ coach, isPlayerTurn, onOpen }) {
  const { t, lang } = useI18n();
  const coachDef = getCoach(coach.prefs.coach);
  const voice = coachVoice(coachDef.id, lang);
  const line = coachLine({ coach, isPlayerTurn });
  const mood =
    line.kind === 'decide' || line.kind === 'error' ? 'preocupado'
    : line.kind === 'analyzing' || line.kind === 'thinking' ? 'pensando'
    : line.kind === 'hint' ? 'pensativo'
    : line.kind === 'feedback' ? (line.greatMove ? 'feliz' : moodForTone(line.tone))
    : 'neutral';
  let body;
  switch (line.kind) {
    case 'decide':
      body = <span className="font-bold text-rose-700 dark:text-rose-300">{t('mplay.decide', { coach: coachDef.name })}</span>;
      break;
    case 'hint':
      body = line.text ? <CoachText text={line.text} /> : t('coach.thinking', { coach: coachDef.name });
      break;
    case 'feedback':
      body = <CoachText text={line.text} />;
      break;
    case 'analyzing':
      body = <>{voice.analyzing} <CoachText text={`[[${line.san}]]`} />…</>;
      break;
    case 'thinking':
      body = t('coach.thinking', { coach: coachDef.name });
      break;
    case 'error':
      body = line.text;
      break;
    case 'off':
      body = t('coach.silent');
      break;
    default:
      body = voice.idle;
  }
  const canHint = coach.active && isPlayerTurn;
  const hint = coach.hint;
  return (
    <div className="flex items-stretch gap-2 h-14 flex-shrink-0">
      <button
        type="button"
        data-testid="coach-line"
        data-kind={line.kind}
        data-hint={line.kind === 'hint' ? (line.text ? 'ready' : 'thinking') : undefined}
        aria-label={line.kind === 'decide' ? t('mplay.decide', { coach: coachDef.name }) : t('mplay.openCoach', { coach: coachDef.name })}
        onClick={onOpen}
        className={`flex-1 min-w-0 flex items-center gap-2 px-2 rounded-2xl border text-left ${
          line.kind === 'decide'
            ? 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40'
            : 'border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900'
        }`}
      >
        <CoachAvatar coach={coachDef.id} mood={mood} size={40} />
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-800 dark:text-ink-100 line-clamp-2">{body}</span>
        {(line.kind === 'feedback' || line.kind === 'decide') && line.label && <MoveBadge label={line.label} greatMove={line.greatMove} />}
      </button>
      {canHint && (
        <button
          type="button"
          data-testid="coach-line-hint"
          onClick={coach.requestHint}
          disabled={!coach.canHint}
          aria-label={!hint ? t('coach.hint') : hint.level < 3 ? t('coach.anotherHint') : t('coach.noMoreHints')}
          title={!hint ? t('coach.hint') : hint.level < 3 ? t('coach.anotherHint') : t('coach.noMoreHints')}
          className="w-12 p-0 rounded-2xl flex items-center justify-center bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 disabled:opacity-50"
        >
          {hint?.loading || hint?.thinking ? <Loader2 size={18} className="animate-spin" /> : <Lightbulb size={18} />}
        </button>
      )}
    </div>
  );
}

/** Fila de controles de la partida (botones de 44 px). */
function Controls({ match, nav, onMore }) {
  const { t } = useI18n();
  return (
    <div role="toolbar" aria-label={t('mplay.controls')} data-testid="play-controls" className="flex items-center gap-1.5 h-11 flex-shrink-0">
      <button type="button" data-testid="play-prev" aria-label={t('board.prev')} title={t('board.prev')} onClick={() => nav.onNavigate('prev')} disabled={!nav.canGoBack} className={ICON_BTN}>
        <ChevronLeft size={20} />
      </button>
      <button type="button" data-testid="play-next" aria-label={t('board.next')} title={t('board.next')} onClick={() => nav.onNavigate('next')} disabled={!nav.canGoForward} className={ICON_BTN}>
        <ChevronRight size={20} />
      </button>
      {/* Deshacer también tras el final (p. ej. retirar un mate recién dado, como en escritorio). */}
      <button type="button" data-testid="undo" aria-label={match.undoLabel} title={match.undoTitle} onClick={match.onUndo} disabled={!match.canUndo} className={ICON_BTN}>
        <Undo2 size={18} />
      </button>
      {match.status === 'playing' ? (
        <>
          <button type="button" data-testid="pause" aria-label={match.paused ? t('match.resume') : t('match.pause')} title={match.paused ? t('match.resume') : t('match.pause')} onClick={match.onPause} className={ICON_BTN}>
            {match.paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button type="button" data-testid="abandon" aria-label={t('match.resign')} title={t('match.resign')} onClick={match.onResign} className={ICON_BTN}>
            <Flag size={18} />
          </button>
        </>
      ) : (
        <button type="button" data-testid="new-game" onClick={match.onNewGame} className="h-11 flex-[3] px-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm">
          {t('match.newGame')}
        </button>
      )}
      <button type="button" data-testid="play-more" aria-label={t('mplay.more')} title={t('mplay.more')} onClick={onMore} className={ICON_BTN}>
        <MoreHorizontal size={20} />
      </button>
    </div>
  );
}

/** Opciones secundarias (menú «⋯»): girar, tema del tablero, evaluación y ajustes del coach. */
function MoreOptions({ onRotate, boardTheme, onBoardThemeChange, evaluation, coachName, onCoachSettings, onDiagnostics, onDone }) {
  const { t } = useI18n();
  const premium = usePremium();
  const next = nextBoardTheme(boardTheme, premium);
  const row = 'min-h-[48px] w-full flex items-center gap-3 px-3 rounded-xl bg-ink-50 dark:bg-ink-800 text-ink-700 dark:text-ink-200 font-bold text-sm text-left';
  return (
    <div className="flex flex-col gap-2">
      <button type="button" data-testid="play-rotate" onClick={() => { onRotate(); onDone(); }} className={row}>
        <RotateCcw size={18} /> {t('board.rotate')}
      </button>
      {onBoardThemeChange && (
        <button type="button" data-testid="board-theme" data-theme={boardTheme} onClick={() => onBoardThemeChange(next)} className={row}>
          <Palette size={18} /> {t('board.change')}: {t(THEME_LABEL[next] ?? 'board.wood')}
        </button>
      )}
      <p data-testid="play-eval" className={`${row} cursor-default`}>
        <Activity size={18} /> {t('mplay.evaluation', { eval: evaluation || '…' })}
      </p>
      <button type="button" data-testid="play-coach-settings" onClick={onCoachSettings} className={row}>
        <Settings2 size={18} /> {t('mplay.coachSettings', { coach: coachName })}
      </button>
      {onDiagnostics && (
        <button type="button" data-testid="play-engine-diag" onClick={() => { onDone(); onDiagnostics(); }} className={row}>
          <Cpu size={18} /> {t('diag.title')}
        </button>
      )}
    </div>
  );
}

/**
 * Pantalla Jugar en móvil.
 * @param {object} p
 * @param {object} p.boardProps    props de ChessBoard comunes con el escritorio (tablero, jugadas, flechas, coronación…)
 * @param {React.ReactElement} p.topBar     <PlayerBar/> de arriba (rival)
 * @param {React.ReactElement} p.bottomBar  <PlayerBar/> de abajo (tú)
 * @param {object|null} p.setup    sin partida: { goal (texto del plan de entrenamiento), level, onLevelChange, colorChoice, onColorChange, timeControl, onTimeControlChange, coachId, onCoachChange, onStart, rivalVoiceOn, onRivalVoiceChange }
 * @param {object} p.match         { status, paused, stateText, onPause, onResign, onNewGame, resultText, canUndo, onUndo, undoLabel, undoTitle }
 * @param {object} p.coach         estado de useCoach
 * @param {boolean} p.isPlayerTurn
 * @param {string} p.decisionKey   identifica la jugada que el coach está deteniendo (cerrar su hoja vale para esa jugada)
 * @param {object} p.nav           { onNavigate, canGoBack, canGoForward }
 */
export default function MobilePlay({ boardProps, topBar, bottomBar, setup, match, coach, isPlayerTurn, decisionKey, nav, onRotate, boardTheme, onBoardThemeChange, evaluation, onDiagnostics = null }) {
  const { t } = useI18n();
  const vp = useViewport();
  const rootRef = useRef(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [sheet, setSheet] = useState(null); // null | 'coach' | 'rival' | 'coachPicker' | 'more'
  const [dismissedDecision, setDismissedDecision] = useState(null);

  // Espacio libre: ancho del contenedor y alto desde su borde superior hasta el final de <main>
  // (descontando su relleno inferior, que incluye la barra inferior --bottom-nav-h).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const main = el.closest('main');
    const measure = () => {
      const r = el.getBoundingClientRect();
      let height = window.innerHeight - r.top;
      if (main) {
        const m = main.getBoundingClientRect();
        const top = r.top - m.top + main.scrollTop;
        height = main.clientHeight - parseFloat(getComputedStyle(main).paddingBottom || '0') - top;
      }
      const next = { width: Math.floor(r.width), height: Math.floor(height) };
      setSpace((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (main) {
      ro.observe(main);
      if (main.firstElementChild) ro.observe(main.firstElementChild); // el encabezado
    }
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [vp.width, vp.height]);

  const layout = mobilePlayLayout({ width: space.width, height: space.height, landscape: vp.landscape });
  const awaiting = coachAwaitsDecision(coach);
  const coachOpen = sheet === 'coach' || (awaiting && dismissedDecision !== decisionKey);
  const closeCoach = () => {
    setSheet((s) => (s === 'coach' ? null : s));
    if (awaiting) setDismissedDecision(decisionKey);
  };
  const openCoach = () => {
    if (awaiting) setDismissedDecision(null);
    else setSheet('coach');
  };
  const coachName = getCoach(coach.prefs.coach).name;
  const ready = space.width > 0;

  const board = (withBars) => (
    <div className={setup ? 'opacity-40 pointer-events-none select-none' : ''} aria-hidden={setup ? 'true' : undefined}>
      <ChessBoard {...boardProps} size={layout.side} compact showControls={false} fitHeight={false} topBar={withBars ? topBar : null} bottomBar={withBars ? bottomBar : null} />
    </div>
  );
  const setupCard = setup && (
    <SetupCard setup={setup} compact={layout.mode === 'landscape'} onPickRival={() => setSheet('rival')} onPickCoach={() => setSheet('coachPicker')} />
  );
  const strip =
    match.status === 'over' ? (
      <p data-testid="game-result" className="h-14 flex items-center px-3 rounded-2xl text-sm font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 flex-shrink-0">
        {match.resultText}
      </p>
    ) : (
      <CoachStrip coach={coach} isPlayerTurn={isPlayerTurn} onOpen={openCoach} />
    );
  const controls = <Controls match={match} nav={nav} onMore={() => setSheet('more')} />;
  const bar = (el) => <div style={{ height: PLAYER_BAR_HEIGHT }}>{el}</div>;

  return (
    <div
      ref={rootRef}
      data-testid="mobile-play"
      data-mode={layout.mode}
      className={`-mx-2 flex-shrink-0 ${layout.mode === 'landscape' ? 'flex flex-row items-start gap-2' : 'flex flex-col gap-2'}`}
      style={ready ? undefined : { visibility: 'hidden' }}
    >
      {/* Estado de la partida para lectores de pantalla (y las pruebas): Tu turno, El rival piensa… */}
      {!setup && (
        <span data-testid="match-state" role="status" aria-live="polite" className="sr-only">
          {match.stateText}
        </span>
      )}
      {layout.mode === 'portrait' ? (
        <>
          <div className="relative">
            {board(true)}
            {setupCard && <div className="absolute inset-0 flex items-center justify-center px-3">{setupCard}</div>}
          </div>
          {!setup && strip}
          {!setup && controls}
        </>
      ) : (
        <>
          <div className="flex-shrink-0">{board(false)}</div>
          <div className="flex flex-col gap-2 min-w-0" style={{ width: layout.columnWidth }}>
            {setup ? (
              setupCard
            ) : (
              <>
                {bar(topBar)}
                {strip}
                {controls}
                {bar(bottomBar)}
              </>
            )}
          </div>
        </>
      )}

      <BottomSheet open={sheet === 'rival'} onClose={() => setSheet(null)} title={t('mplay.chooseRival')} testId="rival-sheet" align={layout.mode === 'landscape' ? 'end' : 'center'} maxHeight={layout.mode === 'landscape' ? '94dvh' : '75dvh'}>
        {setup && <RivalList setup={setup} onPicked={() => setSheet(null)} />}
      </BottomSheet>
      <BottomSheet open={sheet === 'coachPicker'} onClose={() => setSheet(null)} title={t('mplay.chooseCoach')} testId="coach-picker-sheet" align={layout.mode === 'landscape' ? 'end' : 'center'} maxHeight={layout.mode === 'landscape' ? '94dvh' : '75dvh'}>
        {setup && (
          <CoachPicker
            value={setup.coachId}
            size={56}
            onChange={(id) => {
              setup.onCoachChange(id);
              setSheet(null);
            }}
          />
        )}
      </BottomSheet>
      <BottomSheet open={sheet === 'more'} onClose={() => setSheet(null)} title={t('mplay.options')} testId="play-more-sheet" align={layout.mode === 'landscape' ? 'end' : 'center'} maxHeight={layout.mode === 'landscape' ? '94dvh' : '75dvh'}>
        <MoreOptions
          onRotate={onRotate}
          boardTheme={boardTheme}
          onBoardThemeChange={onBoardThemeChange}
          evaluation={evaluation}
          coachName={coachName}
          onCoachSettings={() => setSheet('coach')}
          onDiagnostics={onDiagnostics}
          onDone={() => setSheet(null)}
        />
      </BottomSheet>
      <BottomSheet
        open={!setup && coachOpen}
        onClose={closeCoach}
        testId="coach-sheet"
        backdrop={!awaiting}
        align={layout.mode === 'landscape' ? 'end' : 'center'}
        maxHeight={layout.mode === 'landscape' ? '94dvh' : awaiting ? '58dvh' : '75dvh'}
        footer={awaiting ? <CoachActions coach={coach} large /> : null}
      >
        <CoachPanel coach={coach} isPlayerTurn={isPlayerTurn} compact hideActions />
      </BottomSheet>
    </div>
  );
}
