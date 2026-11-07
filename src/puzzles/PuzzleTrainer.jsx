import { emitRewardEvent } from '../rewards/events';
import React, { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Lightbulb, Eye, SkipForward, ExternalLink, Flame, Trophy, RotateCcw } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import PlayerBar from '../components/PlayerBar';
import { UserAvatar } from '../components/Avatars';
import { CoachAvatar } from '../components/CoachAvatars';
import { CoachText } from '../components/CoachPanel';
import { getCoach } from '../../shared/coach-contract/index.js';
import { coachVoice, pieceName, praiseText, refutationSentence } from '../coach/templates';
import { useI18n } from '../i18n/useI18n';
import { refutationFacts } from '../coach/tactics';
import { isAbortError } from '../engine/engine';
import { materialSummary } from '../utils/material';
import { playMoveSound } from '../utils/sound';
import GeneratorPanel from './GeneratorPanel';
import { resumeInterruptedGeneration, useGeneratorField, usePuzzleLibrary } from './generator/useGeneratePuzzles';
import {
  checkMove,
  filterPuzzles,
  pickNext,
  progressSummary,
  readProgress,
  recordResult,
  writeProgress,
} from './puzzleLogic';

import { duePuzzles, recordReview } from './review';

const REPLY_DELAY_MS = 450;
const WRONG_SHOW_MS = 700;
const HINT_ARROW = '#16a34a';

const TONES = {
  neutral: 'border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-800/60',
  elogio: 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40',
  alerta: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40',
  pista: 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40',
};

const card = 'bg-white dark:bg-ink-900 p-4 rounded-2xl shadow-sm border border-ink-200 dark:border-ink-700';
const btn =
  'py-2 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700';
const seg = (active) =>
  `py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${active ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-100 shadow' : 'bg-transparent text-ink-500 dark:text-ink-400 hover:text-brand-600'}`;

// Fase guardada en el puzle (español, de generator/core.js) → clave de texto.
const PHASE_KEY = { apertura: 'opening', 'medio juego': 'middlegame', final: 'endgame' };
const SOURCE_NAME = { lichess: 'Lichess', chesscom: 'Chess.com' };
const MOTIFS = ['mate', 'jaque_y_ataque', 'ataque_doble', 'captura'];

/** Tema del puzle en el idioma actual (null = jugada tranquila; desconocido = "táctica"). */
const motifText = (m, t) => t(`puzzles.motif.${m == null || m === 'null' ? 'null' : MOTIFS.includes(m) ? m : 'other'}`);
/** El generador guarda "Rival" si la partida no tenía nombre: se muestra traducido. */
const opponentName = (p, t) => (!p?.opponent || p.opponent === 'Rival' ? t('header.rival') : p.opponent);

function introText(p, t) {
  const vars = { opponent: opponentName(p, t), date: p.date, played: p.played, side: t(`puzzles.side.${p.color}`) };
  return t(p.type === 'oportunidad' ? 'puzzles.introChance' : 'puzzles.introError', vars);
}

/**
 * Texto de un mensaje del coach. Los mensajes guardan qué pasó (tipo + datos), no el texto, y se
 * traducen al pintar: cambiar de idioma traduce también el mensaje que se ve.
 */
function messageText(msg, { puzzle, coachId, lang, t, voice }) {
  if (!msg || !puzzle) return '';
  switch (msg.kind) {
    case 'intro':
      return introText(puzzle, t);
    case 'wrong': {
      const why = msg.ref ? refutationSentence(msg.ref, lang) : null;
      if (!why) return t('puzzles.wrongMove', { voice: voice.wrong, san: msg.san });
      return t('puzzles.wrongWhy', { voice: voice.wrong, san: msg.san, why: `${why.charAt(0).toLowerCase()}${why.slice(1)}` });
    }
    case 'solved':
      return t('puzzles.solved', { praise: praiseText(msg.san, puzzle.moveNumber, coachId, lang) });
    case 'keepGoing':
      return voice.keepGoing;
    case 'reply':
      return t('puzzles.reply', { san: msg.san, voice: voice.idle });
    case 'hint': {
      let text;
      if (msg.level === 1) text = msg.mateIn ? t('puzzles.hintMate', { n: msg.mateIn }) : t('puzzles.hintMotif', { motif: motifText(msg.motif, t) });
      else if (msg.level === 2) text = t('puzzles.hintPiece', { piece: msg.piece ? pieceName(msg.piece, lang) : t('puzzles.piece'), square: msg.square });
      else text = t('puzzles.hintMove');
      return t('puzzles.hintPrefix', { level: msg.level, text });
    }
    case 'reveal':
      return t('puzzles.lookSolution');
    default:
      return '';
  }
}

// Puzles de tus partidas: el coach elegido te acompaña (pistas en 3 niveles, explicación del
// fallo con Stockfish, solución animada) y tu Elo de puzles mide el progreso.

// Los puzles salen de IndexedDB (generados en el navegador a partir de tus partidas importadas).
const PuzzleTrainer = (props) => {
  const { t } = useI18n();
  const version = useGeneratorField('version');
  const limit = useGeneratorField('limit');
  const lib = usePuzzleLibrary({ limit, version });

  // Si se cerró la pestaña a mitad de una generación, sigue donde quedó.
  useEffect(() => {
    resumeInterruptedGeneration();
  }, []);

  if (lib.loading) {
    return <div className={`${card} max-w-xl text-sm text-ink-600 dark:text-ink-300`}>{t('puzzles.loading')}</div>;
  }
  const selectedPuzzles = props.initialTarget ? lib.puzzles.filter((p) => props.initialTarget.puzzleIds.includes(p.id) && p.motif === props.initialTarget.motif) : lib.puzzles;
  if (!selectedPuzzles.length) {
    return (
      <div data-testid="puzzle-empty" className={`${card} max-w-xl flex flex-col gap-3`}>
        <div>
          <p className="font-bold text-ink-800 dark:text-ink-100">{t('puzzles.emptyTitle')}</p>
          <p className="text-sm text-ink-600 dark:text-ink-300 mt-1">
            {t('puzzles.emptyBody').split('{games}').map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <b>{t('menu.games')}</b>}
                {part}
              </React.Fragment>
            ))}
          </p>
        </div>
        {lib.error && <p className="text-xs text-rose-700 dark:text-rose-300">{lib.error}</p>}
        <GeneratorPanel summary={lib.summary} />
      </div>
    );
  }
  return <PuzzleSession key={props.initialTarget?.id ?? "all"} {...props} puzzles={selectedPuzzles} summary={lib.summary} />;
};

const PuzzleSession = ({ initialTarget, puzzles, summary: genSummary, engine, coachId, profile, userRating, soundOn, boardTheme, onBoardThemeChange, isWide }) => {
  const [progress, setProgress] = useState(readProgress);
  const [reviewQueue, setReviewQueue] = useState(null);
  const [reviewComplete, setReviewComplete] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const due = duePuzzles(puzzles, progress, now);
  const [filters, setFilters] = useState({ type: 'todos', motif: initialTarget?.motif ?? 'todos' });
  const pool = filterPuzzles(puzzles, filters);
  const [puzzleId, setPuzzleId] = useState(() => pickNext(puzzles, readProgress())?.id ?? null);
  const puzzle = puzzles.find((p) => p.id === puzzleId) ?? null;

  const [play, setPlay] = useState(null); // { id, fen, step, status, lastMove, animate, failed, hint, message, delta }
  const [selected, setSelected] = useState(null);
  const [pendingPromotion, setPendingPromotion] = useState(null);
  const [targets, setTargets] = useState([]);
  const [orientation, setOrientation] = useState('white');
  const timers = useRef([]);
  const { t, lang } = useI18n();
  const coach = getCoach(coachId);
  const voice = coachVoice(coachId, lang);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  const saveProgress = (next) => {
    setProgress(next);
    writeProgress(next);
  };

  const start = (p) => {
    clearTimers();
    setPendingPromotion(null);
    setSelected(null);
    setTargets([]);
    if (!p) {
      setPlay(null);
      return;
    }
    setOrientation(p.color === 'w' ? 'white' : 'black');
    setPlay({ id: p.id, fen: p.fen, step: 0, status: 'playing', lastMove: null, animate: null, failed: false, hint: 0, message: { kind: 'intro', tone: 'neutral', mood: 'neutral' }, delta: null });
  };

  // El puzle elegido desapareció (borraste su partida): se elige otro.
  useEffect(() => {
    if (!puzzle && puzzles.length) queueMicrotask(() => setPuzzleId(pickNext(puzzles, readProgress())?.id ?? null));
  }, [puzzle, puzzles]);

  // Primer puzle (y cada vez que cambia el elegido).
  const current = play && puzzle && play.id === puzzle.id ? play : null;
  const promotionPrompt = pendingPromotion && current?.status === 'playing' &&
    pendingPromotion.id === current.id && pendingPromotion.fen === current.fen &&
    pendingPromotion.step === current.step ? pendingPromotion : null;
  useEffect(() => {
    if (puzzle && (!play || play.id !== puzzle.id)) queueMicrotask(() => start(puzzle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle?.id]);

  const sound = (captured) => soundOn && playMoveSound(captured ? 'capture' : 'move');

  const markFailed = (state) => {
    if (state.failed) return state;
    const before = progress.rating;
    const date = new Date();
    const next = recordReview(recordResult(progress, puzzle, false, date), puzzle.id, false, date);
    saveProgress(next);
    emitRewardEvent('puzzle-result', { id: puzzle.id, puzzleId: puzzle.id, solved: false, firstTry: false });
    return { ...state, failed: true, delta: next.rating - before };
  };

  const explainWrong = (fenAfter, uci, san) => {
    if (!engine) return;
    engine
      .analyze(fenAfter, { depth: 12 })
      .then((after) => {
        const ref = refutationFacts({ fenAfter, after });
        if (!ref || !refutationSentence(ref)) return;
        setPlay((s) => (s && s.status === 'playing' && s.message?.wrongUci === uci && s.message.san === san ? { ...s, message: { ...s.message, ref } } : s));
      })
      .catch((err) => {
        if (!isAbortError(err)) console.error(t('puzzles.explainError'), err);
      });
  };

  const tryMove = (from, to, promotion) => {
    if (!current || current.status !== 'playing' || (promotionPrompt && !promotion)) return;
    const chess = new Chess(current.fen);
    if (chess.turn() !== puzzle.color) return;
    // Solo una coronación legal abre el selector: no se adelanta la pieza de la solución.
    if (!promotion && chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion)) {
      setPendingPromotion({ id: current.id, fen: current.fen, step: current.step, from, to, color: chess.turn() });
      setSelected(null);
      setTargets([]);
      return;
    }
    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      return;
    }
    setSelected(null);
    setTargets([]);
    sound(move.captured);
    const uci = from + to + (promotion ?? '');
    const res = checkMove(puzzle, current.fen, current.step, uci);

    if (!res.ok) {
      // Se ve la jugada un instante y vuelve atrás.
      const fenBefore = current.fen;
      setPlay((s) => {
        const failed = markFailed(s);
        return { ...failed, fen: chess.fen(), lastMove: { from, to }, message: { kind: 'wrong', san: move.san, tone: 'alerta', mood: 'preocupado', wrongUci: uci } };
      });
      timers.current.push(setTimeout(() => setPlay((s) => (s ? { ...s, fen: fenBefore, lastMove: null } : s)), WRONG_SHOW_MS));
      explainWrong(chess.fen(), uci, move.san);
      return;
    }

    if (res.done) {
      emitRewardEvent('puzzle-result', { id: puzzle.id, puzzleId: puzzle.id, solved: true, firstTry: !current.failed && !progress.results[puzzle.id] });
      setPlay((s) => {
        let next = { ...s, fen: chess.fen(), step: s.step + 1, status: 'solved', lastMove: { from, to }, animate: null };
        if (!s.failed) {
          const before = progress.rating;
          const date = new Date();
          const updated = recordReview(recordResult(progress, puzzle, true, date), puzzle.id, true, date);
          saveProgress(updated);
          next = { ...next, delta: updated.rating - before };
        }
        return { ...next, message: { kind: 'solved', san: move.san, tone: 'elogio', mood: 'feliz' } };
      });
      return;
    }

    // Jugada correcta intermedia: responde el rival.
    setPlay((s) => ({ ...s, fen: chess.fen(), step: s.step + 1, lastMove: { from, to }, animate: null, hint: 0, message: { kind: 'keepGoing', tone: 'elogio', mood: 'feliz' } }));
    const reply = res.reply;
    timers.current.push(
      setTimeout(() => {
        const c2 = new Chess(chess.fen());
        const m2 = c2.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
        sound(m2.captured);
        setPlay((s) => ({ ...s, fen: c2.fen(), step: s.step + 1, lastMove: { from: m2.from, to: m2.to }, animate: { from: m2.from, to: m2.to, key: s.step + 1 }, message: { kind: 'reply', san: m2.san, tone: 'neutral', mood: 'pensando' } }));
      }, REPLY_DELAY_MS),
    );
  };

  const onSquareClick = (row, col) => {
    if (!current || current.status !== 'playing' || promotionPrompt) return;
    const sq = `${String.fromCharCode(97 + col)}${8 - row}`;
    const chess = new Chess(current.fen);
    if (selected && targets.includes(sq)) {
      tryMove(selected, sq);
      return;
    }
    const piece = chess.get(sq);
    if (piece && piece.color === chess.turn() && piece.color === puzzle.color) {
      setSelected(sq);
      setTargets(chess.moves({ square: sq, verbose: true }).map((m) => m.to));
    } else {
      setSelected(null);
      setTargets([]);
    }
  };

  const hint = () => {
    if (!current || current.status !== 'playing') return;
    const level = Math.min(3, current.hint + 1);
    const uci = puzzle.solution[current.step];
    const chess = new Chess(current.fen);
    const piece = chess.get(uci.slice(0, 2));
    const message = {
      kind: 'hint',
      level,
      mateIn: puzzle.mateIn && current.step === 0 ? puzzle.mateIn : null,
      motif: puzzle.motif,
      piece: piece?.type ?? null,
      square: uci.slice(0, 2),
      tone: 'pista',
      mood: 'pensativo',
    };
    setPlay((s) => {
      const base = level === 3 ? markFailed(s) : s;
      return { ...base, hint: level, message };
    });
  };

  const reveal = () => {
    if (!current || current.status !== 'playing') return;
    clearTimers();
    setPendingPromotion(null);
    setPlay((s) => ({ ...markFailed(s), status: 'revealed', message: { kind: 'reveal', tone: 'neutral', mood: 'neutral' } }));
    const chess = new Chess(current.fen);
    puzzle.solution.slice(current.step).forEach((uci, i) => {
      timers.current.push(
        setTimeout(() => {
          const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          sound(m.captured);
          const fen = chess.fen();
          setPlay((s) => ({ ...s, fen, lastMove: { from: m.from, to: m.to }, animate: { from: m.from, to: m.to, key: 100 + i } }));
        }, 500 + i * 900),
      );
    });
  };

  const beginReview = () => {
    const queue = due.map((p) => p.id);
    if (!queue.length) return;
    emitRewardEvent('review-started', { ids: queue });
    setReviewQueue(queue);
    setReviewComplete(false);
    setPuzzleId(queue[0]);
    start(puzzles.find((p) => p.id === queue[0]));
  };

  const next = () => {
    if (reviewQueue) {
      const remaining = reviewQueue.filter((id) => id !== puzzle?.id && puzzles.some((p) => p.id === id));
      if (remaining.length) {
        setReviewQueue(remaining);
        setPuzzleId(remaining[0]);
        return;
      }
      setReviewQueue(null);
      setReviewComplete(true);
      emitRewardEvent('review-completed', { id: new Date().toDateString() });
    }
    const p = pickNext(pool.length ? pool : puzzles, progress, puzzle?.id);
    if (p) {
      setPuzzleId(p.id);
      if (p.id === puzzle?.id) start(p);
    }
  };

  const summary = progressSummary(progress);
  const motifs = [...new Set(puzzles.map((p) => String(p.motif)))];

  const fen = current?.fen ?? puzzle?.fen ?? new Chess().fen();
  const chessNow = new Chess(fen);
  const materialInfo = materialSummary(fen);
  const solverColor = puzzle?.color ?? 'w';
  const bottomColor = orientation === 'white' ? 'w' : 'b';
  const bar = (color) =>
    color === solverColor ? (
      <PlayerBar
        color={color}
        name={profile.name}
        detail={userRating ? `(${userRating})` : null}
        avatar={<UserAvatar config={profile.avatar} size={28} label={t('profile.avatarOf', { name: profile.name })} />}
        captured={materialInfo[color].captured}
        advantage={materialInfo[color].advantage}
        isTurn={chessNow.turn() === color}
      />
    ) : (
      <PlayerBar color={color} name={opponentName(puzzle, t)} detail={puzzle?.date} captured={materialInfo[color].captured} advantage={materialInfo[color].advantage} isTurn={chessNow.turn() === color} />
    );
  const hintArrow =
    current?.status === 'playing' && current.hint >= 3 ? [{ start: puzzle.solution[current.step].slice(0, 2), end: puzzle.solution[current.step].slice(2, 4), color: HINT_ARROW }] : [];
  const status = current?.status ?? 'playing';

  return (
    <div data-testid="puzzle-trainer" data-status={status} data-puzzle={puzzle?.id} className="flex flex-col min-[960px]:flex-row gap-3 xl:gap-4 pb-1 min-[960px]:flex-1 min-[960px]:min-h-0">
      <div className="bg-white dark:bg-ink-900 p-3 rounded-3xl shadow-sm border border-ink-100 dark:border-ink-800 flex flex-col items-center relative overflow-hidden min-[960px]:flex-1 min-[960px]:min-w-0 min-[960px]:min-h-[300px]">
        <ChessBoard
          board={chessNow.board()}
          onSquareClick={onSquareClick}
          onPieceDrop={(from, to) => tryMove(from, to)}
          promotion={promotionPrompt ? { square: promotionPrompt.to, color: promotionPrompt.color } : null}
          onPromotionSelect={(piece) => {
            const pending = promotionPrompt;
            setPendingPromotion(null);
            if (pending) tryMove(pending.from, pending.to, piece);
          }}
          onPromotionCancel={() => setPendingPromotion(null)}
          selectedSquare={selected}
          possibleMoves={targets}
          onReset={() => puzzle && start(puzzle)}
          resetLabel={t('puzzles.retry')}
          onNavigate={() => {}}
          canGoBack={false}
          canGoForward={false}
          showNavigation={false}
          showEval={false}
          orientation={orientation}
          onRotate={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
          extraArrows={hintArrow}
          fitHeight={isWide}
          lastMove={current?.lastMove ?? null}
          animateMove={current?.animate ?? null}
          boardTheme={boardTheme}
          onBoardThemeChange={onBoardThemeChange}
          topBar={bar(bottomColor === 'w' ? 'b' : 'w')}
          bottomBar={bar(bottomColor)}
        />
      </div>

      <div className="w-full min-[960px]:w-[320px] xl:w-[380px] flex flex-col gap-3 min-[960px]:h-full min-[960px]:overflow-y-auto flex-shrink-0">
        {/* Progreso */}
        <div data-testid="puzzle-progress" className={`${card} grid grid-cols-3 gap-2 text-center`}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-ink-500 dark:text-ink-400">{t('puzzles.rating')}</p>
            <p data-testid="puzzle-rating" className="text-xl font-black text-brand-700 dark:text-brand-300 flex items-center justify-center gap-1">
              <Trophy size={16} /> {progress.rating}
            </p>
            {current?.delta != null && (
              <p data-testid="puzzle-delta" className={`text-xs font-bold ${current.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {current.delta >= 0 ? '+' : ''}
                {current.delta}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-ink-500 dark:text-ink-400">{t('puzzles.streak')}</p>
            <p className="text-xl font-black text-ink-800 dark:text-ink-100 flex items-center justify-center gap-1">
              <Flame size={16} className="text-amber-500" /> {progress.streak}
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400">{t('puzzles.best', { n: progress.best })}</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-ink-500 dark:text-ink-400">{t('puzzles.solvedCount')}</p>
            <p className="text-xl font-black text-ink-800 dark:text-ink-100">
              {summary.solved}/{puzzles.length}
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400">{summary.rate == null ? '—' : t('puzzles.firstTry', { rate: summary.rate })}</p>
          </div>
        </div>

        <div data-testid="puzzle-review" className={`${card} flex flex-col gap-2`}>
          <h2 className="font-bold text-ink-800 dark:text-ink-100">{t('puzzles.review.title')}</h2>
          <p data-testid="puzzle-review-count" className="text-sm text-ink-600 dark:text-ink-300">{t('puzzles.review.pending', { n: due.length })}</p>
          {reviewQueue && <p data-testid="puzzle-review-active" className="text-xs text-ink-500 dark:text-ink-400">{t('puzzles.review.active', { n: reviewQueue.filter((id) => puzzles.some((p) => p.id === id)).length })}</p>}
          {reviewComplete && <p data-testid="puzzle-review-complete" className="text-sm text-emerald-700 dark:text-emerald-300">{t('puzzles.review.complete')}</p>}
          <button data-testid="puzzle-review-start" type="button" onClick={beginReview} disabled={!due.length} className={btn}>{t('puzzles.review.start')}</button>
        </div>

        {initialTarget && <p data-testid="plan-puzzle-target" data-motif={initialTarget.motif} className="text-sm text-brand-700 dark:text-brand-300">{t('progress.plan.targetPuzzles')}</p>}
        {/* Coach */}
        <div className={`${card} flex flex-col gap-3`}>
          <div className="flex gap-3 items-start">
            <div className="flex flex-col items-center gap-1 w-[72px] flex-shrink-0">
              <CoachAvatar coach={coachId} mood={current?.message?.mood ?? 'neutral'} size={72} />
              <p className="font-black text-ink-800 dark:text-ink-100 text-sm">{coach.name}</p>
            </div>
            <div data-testid="puzzle-message" data-tone={current?.message?.tone} className={`flex-1 min-w-0 rounded-2xl rounded-tl-md border p-3 text-sm text-ink-800 dark:text-ink-100 leading-snug ${TONES[current?.message?.tone ?? 'neutral']}`}>
              <CoachText text={messageText(current?.message, { puzzle, coachId, lang, t, voice })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button data-testid="puzzle-hint" onClick={hint} disabled={status !== 'playing' || (current?.hint ?? 0) >= 3} className={btn}>
              <Lightbulb size={15} /> {current?.hint ? t('puzzles.hintN', { level: Math.min(3, current.hint + 1) }) : t('puzzles.hint')}
            </button>
            <button data-testid="puzzle-reveal" onClick={reveal} disabled={status !== 'playing'} className={btn}>
              <Eye size={15} /> {t('puzzles.solution')}
            </button>
            <button data-testid="puzzle-retry" onClick={() => puzzle && start(puzzle)} className={btn}>
              <RotateCcw size={15} /> {t('puzzles.retry')}
            </button>
            <button data-testid="puzzle-next" onClick={next} className="py-2 px-3 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white">
              <SkipForward size={15} /> {t('puzzles.next')}
            </button>
          </div>
        </div>

        {/* Datos del puzle */}
        {puzzle && (
          <div data-testid="puzzle-info" className={`${card} text-sm flex flex-col gap-1.5`}>
            <div className="flex flex-wrap gap-1.5">
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${puzzle.type === 'oportunidad' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'}`}>
                {t(`puzzles.type.${puzzle.type}`)}
              </span>
              {(status !== 'playing' || (current?.hint ?? 0) >= 1) && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300">{motifText(puzzle.motif, t)}</span>
              )}
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300">{PHASE_KEY[puzzle.phase] ? t(`puzzles.phase.${PHASE_KEY[puzzle.phase]}`) : puzzle.phase}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300">≈{puzzle.rating}</span>
            </div>
            {puzzle.opening && <p className="text-xs text-ink-500 dark:text-ink-400 truncate">{puzzle.opening}</p>}
            {puzzle.gameUrl && (
              <a href={puzzle.gameUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand-700 dark:text-brand-300 hover:underline flex items-center gap-1">
                <ExternalLink size={12} />{' '}
                {SOURCE_NAME[puzzle.source]
                  ? t('puzzles.viewGameOn', { source: SOURCE_NAME[puzzle.source], n: puzzle.moveNumber })
                  : t('puzzles.viewGame', { n: puzzle.moveNumber })}
              </a>
            )}
          </div>
        )}

        {/* Filtros */}
        <div className={`${card} flex flex-col gap-2`}>
          <span className="text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400">{t('puzzles.train')}</span>
          <div role="radiogroup" aria-label={t('puzzles.typeGroup')} className="grid grid-cols-3 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl">
            {['todos', 'error', 'oportunidad'].map((id) => (
              <button key={id} type="button" role="radio" aria-checked={filters.type === id} data-testid={`puzzle-type-${id}`} onClick={() => setFilters((f) => ({ ...f, type: id }))} className={seg(filters.type === id)}>
                {t(`puzzles.filter.${id}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['todos', ...motifs].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, motif: m }))}
                className={`text-xs font-bold px-2.5 py-1 rounded-full transition-all ${filters.motif === m ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-ink-200 dark:hover:bg-ink-700'}`}
              >
                {m === 'todos' ? t('puzzles.allMotifs') : motifText(m, t)}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500 dark:text-ink-400">{t('puzzles.poolCount', { n: pool.length })}</p>
        </div>

        {/* Generar más puzles de partidas nuevas */}
        <div className={`${card} flex flex-col gap-2`}>
          <span className="text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400">{t('puzzles.newGames')}</span>
          <GeneratorPanel summary={genSummary} />
        </div>
      </div>
    </div>
  );
};

export default PuzzleTrainer;
