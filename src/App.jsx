import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { Chess } from 'chess.js';
import { useStockfish, usePositionAnalysis } from './hooks/useStockfish';
import { useRivalEngine } from './hooks/useRivalEngine';
import { useGameLoop, gameResultFromChess, timeoutResult, abandonResult, isFinalResult, resultText, pliesToUndo } from './coach/useGameLoop';
import { useChessClock, useAbandonCountdown } from './hooks/useChessClock';
import { useCoach } from './coach/useCoach';
import { buildTrainingGame } from './storage/trainingGame';
import { savePlayedGame, removePlayedGame } from './import/store';
import { useMoveLedger } from './coach/useMoveLedger';
import { lineFromSans, summarizeGame, START_FEN } from './coach/summary';
import { getRivalLevel } from './engine/rivalLevels';
import { formatScore } from './engine/uci';
import { uciToSan } from './engine/classify';
import { isAbortError } from './engine/engine';
import {
  BarChart2, Play, Target, MessageSquare,
  Cpu, Brain, Activity, RotateCcw, Undo2, Pause, Flag,
  ChevronLeft, ChevronRight, MessageSquare as MessageSquareIcon, Menu, Volume2, VolumeX, Puzzle, Library, Download
} from 'lucide-react';

import ChessBoard from './components/ChessBoard';
import EvalBar from './components/EvalBar';
import LevelSelector from './components/LevelSelector';
import CoachPanel from './components/CoachPanel';
import ThemeToggle from './components/ThemeToggle';
import SideMenu from './components/SideMenu';
import PlayerBar from './components/PlayerBar';
import GameSummary from './components/GameSummary';
import { RivalAvatar, UserAvatar } from './components/Avatars';
import { readProfile, writeProfile } from './utils/avatarOptions';
import { getCoach } from '../shared/coach-contract/index.js';
import { materialSummary } from './utils/material';
import { playMoveSound, playGameStartSound, playGameEndSound, unlockAudio, readSoundPref, writeSoundPref } from './utils/sound';
import { useTheme } from './hooks/useTheme';
import { useMediaQuery } from './hooks/useMediaQuery';
import { getOpeningsMap } from './data/openings';
import { useImportedGames } from './import/useImportedGames';
import { displayPlayerName, opponentOf, outcomeFor, userRatingFromGames } from './import/normalize';
// Pantallas diferidas (no se ven al abrir): ver src/screens.js.
import { AvatarEditor, MyGames, ProgressPage, PuzzleTrainer, Welcome } from './screens';
import { markWelcomeSeen, readWelcomeSeen } from './welcome/welcomeState';
import ScreenLoading from './components/ScreenLoading';
import RewardsRoot from './rewards/RewardsRoot';
import { emitRewardEvent } from './rewards/events';
import { useRivalVoice } from './rivals/useRivalVoice';
import RivalSpeech from './components/RivalSpeech';
import { useI18n } from './i18n/useI18n';
import { BOARD_THEME_ORDER } from './premium/limits';
import { formatDate } from './i18n/core';
import { rivalEloText, rivalEpithet } from './rivals/labels';

// --- 1. DATOS ESTÁTICOS & UTILS ---
// Nombre por defecto del perfil: `profile.defaultName` del idioma activo (se cambia en el editor
// de avatar). El rating sale de las partidas importadas (Mis partidas); sin partidas con Elo no hay rating.

// Profundidad objetivo del motor: la usan tanto la evaluación en vivo como la
// clasificación, para que ambas compartan el mismo trabajo y la misma caché.
const ANALYSIS_DEPTH = 15;

// Estilos de cada etiqueta de clasificación (la lógica vive en src/engine/classify.js).
const CLASSIFICATION_STYLES = {
  Best: "text-emerald-600 font-bold",
  Excellent: "text-emerald-500 font-bold",
  Good: "text-emerald-400",
  Inaccuracy: "text-yellow-500 font-bold",
  Mistake: "text-orange-500 font-bold",
  Blunder: "text-red-600 font-black",
};

// Detect opening name from move history (SAN array)
// El mapa de aperturas se carga aparte (src/data/openings.js); hasta entonces no se detecta ninguna.
const detectOpening = (history) => {
    const OPENINGS_MAP = getOpeningsMap();
    let moveStr = "";
    let name = "";

    for (let i = 0; i < history.length; i++) {
        moveStr += (i === 0 ? "" : " ") + history[i];
        if (OPENINGS_MAP[moveStr]) {
            name = OPENINGS_MAP[moveStr];
        }
    }
    return name || "";
};

const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const NAV_ITEMS = [
  { id: 'progress', icon: BarChart2, labelKey: 'menu.progress' },
  { id: 'analysis', icon: Activity, labelKey: 'menu.analysis' },
  { id: 'practice', icon: Play, labelKey: 'menu.practice' },
  { id: 'puzzles', icon: Puzzle, labelKey: 'menu.puzzles' },
  { id: 'games', icon: Library, labelKey: 'menu.games' },
];

const OUTCOME_BADGE = {
  win: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300',
  loss: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300',
  draw: 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
};
const shortDate = (ms, lang, t) => (ms ? formatDate(lang, ms) : t('common.noDate'));

/** Hora actual en ms (fuera del componente: solo se llama en manejadores de eventos). */
const wallClockMs = () => Date.now();

/** Segundos fuera de Entrenar, con una partida en juego, antes de darla por abandonada. */
const ABANDON_GRACE_MS = 30_000;

// --- 2. COMPONENTE PRINCIPAL ---
const App = () => {
  const { t, lang } = useI18n();
  // LÓGICA: Chess.js + Stockfish
  const [game, setGame] = useState(new Chess());
  const [board, setBoard] = useState(game.board());
  
  // Tema claro/oscuro (botón en la esquina superior derecha)
  const { theme, toggleTheme } = useTheme();
  // Perfil del usuario (nombre visible + avatar), editable al hacer clic en su avatar.
  // Sin nombre guardado (null) se muestra el nombre por defecto del idioma activo.
  const [storedProfile, setProfile] = useState(() => readProfile(null));
  const profile = useMemo(() => ({ ...storedProfile, name: storedProfile.name ?? t('profile.defaultName') }), [storedProfile, t]);
  const [editingAvatar, setEditingAvatar] = useState(false);
  const saveProfile = (next) => {
    const stored = { ...next, name: next.name === t('profile.defaultName') ? null : next.name };
    setProfile(stored);
    writeProfile(stored);
    setEditingAvatar(false);
  };

  // Sonido de las piezas (sintetizado; se puede silenciar). El navegador solo permite audio tras
  // un gesto del usuario: el primer clic o tecla lo habilita.
  const [soundOn, setSoundOn] = useState(readSoundPref);
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  const toggleSound = () =>
    setSoundOn((on) => {
      writeSoundPref(!on);
      return !on;
    });

  // Tema del tablero: madera (por defecto) o verde; se recuerda en el navegador.
  const [boardTheme, setBoardTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('escaque:board');
      return BOARD_THEME_ORDER.includes(saved) ? saved : 'madera';
    } catch {
      return 'madera';
    }
  });
  const changeBoardTheme = (t) => {
    setBoardTheme(t);
    try {
      localStorage.setItem('escaque:board', t);
    } catch {
      // sin almacenamiento
    }
  };

  // Menú lateral tipo hamburguesa: { open, mode: 'click' | 'hover' }
  const [menu, setMenu] = useState({ open: false, mode: null });
  const openMenu = (mode) => setMenu((m) => (m.open ? m : { open: true, mode }));
  const closeMenu = useCallback(() => setMenu({ open: false, mode: null }), []);
  // Diseño: tablero y paneles lado a lado desde 960 px de ancho; por debajo, apilados con scroll.
  // El zoom del navegador reduce el ancho en píxeles CSS (150 % en 1500 px = 1000 px), así que
  // también cambia de uno a otro. Mantener en sincronía con las clases min-[960px]: de abajo.
  const isWide = useMediaQuery('(min-width: 960px)');
  const showEvalBar = useMediaQuery('(min-width: 768px)');

  // UI States
  const [activeTab, setActiveTab] = useState('practice'); // practice, analysis, progress, puzzles, games

  // --- Bienvenida (src/welcome/): primera visita y "Acerca de" en el menú ---
  const [welcomeOpen, setWelcomeOpen] = useState(() => !readWelcomeSeen());
  const closeWelcome = useCallback((tab) => {
    markWelcomeSeen();
    setWelcomeOpen(false);
    if (tab) setActiveTab(tab);
  }, []);
  const dismissWelcome = useCallback(() => closeWelcome(), [closeWelcome]);
  // --- fin bienvenida ---
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [possibleMoves, setPossibleMoves] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [puzzleTarget, setPuzzleTarget] = useState(null);
  const [reviewTargets, setReviewTargets] = useState(null);
  const [openingGoal, setOpeningGoal] = useState(null);
  // Partidas importadas por el usuario (IndexedDB): Análisis, Stats y su rating.
  const { games: gamesData, loading: gamesLoading } = useImportedGames();
  const userRating = useMemo(() => userRatingFromGames(gamesData)?.rating ?? null, [gamesData]);
  const [currentPage, setCurrentPage] = useState(1);
  const GAMES_PER_PAGE = 7;


  // Game Status
  // null | 'Puzzle Mode' | clave 'status.*' (juego libre) | { result, playerColor } (contra el rival)
  const [gameStatus, setGameStatus] = useState(null);
  const [openingName, setOpeningName] = useState("");
  // Se incrementa en cada reinicio: remonta el reloj para que vuelva al tiempo inicial.
  const [clockKey, setClockKey] = useState(0);
  const [orientation, setOrientation] = useState('white');
  // Posición inicial de la partida de Entrenar (la estándar; otra solo en las pruebas e2e).
  const [startFen, setStartFen] = useState(START_FEN);
  // Partida terminada: foto para la tarjeta de estadísticas (sigue disponible tras "Nueva
  // partida" hasta que empieza otra). { gameId, startFen, sans, result, playerColor, level,
  // timeUsedMs: {w, b}, durationMs }
  const [finishedGame, setFinishedGame] = useState(null);
  const gameStartedAtRef = useRef(null);
  const trainingSessionRef = useRef(null);
  const [saveFailure, setSaveFailure] = useState(null);
  const [showLastSummary, setShowLastSummary] = useState(false);

  // Review & Analysis State
  const [reviewMode, setReviewMode] = useState(false); // If true, clock paused, user exploring variant
  // Clasificación con la que se entró a "Ver Variante" (para mostrar la mejor jugada de esa posición)
  const [reviewClassification, setReviewClassification] = useState(null);
  // Clasificaciones calculadas, por jugada: clave "<FEN antes>|<jugada UCI>"
  const [classifications, setClassifications] = useState({});

  // Aviso no bloqueante (reemplaza a alert())
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  const showNotice = (text) => {
      setNotice(text);
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = setTimeout(() => setNotice(null), 4000);
  };
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  // Clock times for current game
  const [clockTimes, setClockTimes] = useState({ white: 600, black: 600 }); // Initial

  // Navigation State (partida de Entrenar)
  const [moveHistory, setMoveHistory] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);

  // Tablero de la pestaña Análisis: independiente de la partida de Entrenar, que sigue viva
  // (rival y reloj incluidos) mientras miras otra pestaña.
  const [analysisView, setAnalysisView] = useState({ sans: [], index: -1, opening: '', status: null, initialTime: 600, startFen: START_FEN });
  const analysisGame = useMemo(() => {
    const g = new Chess(analysisView.startFen);
    for (let i = 0; i <= analysisView.index; i++) g.move(analysisView.sans[i]);
    return g;
  }, [analysisView.sans, analysisView.index, analysisView.startFen]);
  const isAnalysisTab = activeTab === 'analysis';
  const inPractice = activeTab === 'practice';

  // Hook Stockfish (analista: fuerza completa, caché por FEN)
  const stockfish = useStockfish();
  const { classifyMove } = stockfish;
  const engineStatus = t(`status.engine.${stockfish.status}`);

  // Rival: worker propio con fuerza limitada. Siempre activo: la partida sigue aunque mires otra pestaña.
  const rivalEngine = useRivalEngine();

  // Bucle de partida contra el rival (pestaña Entrenar).
  const currentFen = game.fen();
  const viewingPast = currentMoveIndex < moveHistory.length - 1;
  const loop = useGameLoop({
    rival: rivalEngine.rival,
    fen: currentFen,
    // El rival no mueve mientras se explora una variante, se navega el historial,
    // hay un puzzle cargado o la partida terminó según chess.js.
    blocked: reviewMode || viewingPast || gameStatus === 'Puzzle Mode' || game.isGameOver(),
    onRivalMove: (move) => {
      if (game.fen() !== move.fen) return; // respuesta a una posición que ya no está
      // Alfred analiza tu jugada o espera tu decisión (Retroceder / Seguir): se retiene.
      if (coachRef.current?.rivalBlocked) {
        setHeldRivalMove(move);
        return;
      }
      commitMove({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
    },
  });
  // Hay partida contra el rival (en juego o terminada), en cualquier pestaña.
  const loopActive = loop.status !== 'setup';
  const showMatch = inPractice && loopActive;
  const rivalLevelDef = getRivalLevel(loop.activeLevel);

  // Alfred (coach): analiza cada jugada tuya, comenta y puede detener la partida.
  const [heldRivalMove, setHeldRivalMove] = useState(null);
  const coach = useCoach({
    engine: stockfish.engine,
    enabled: loopActive && loop.status === 'playing' && !reviewMode && !viewingPast && gameStatus !== 'Puzzle Mode',
    gameId: loop.gameId,
    playerColor: loop.playerColor,
    history: game.history({ verbose: true }),
    fen: currentFen,
    isPlayerTurn: loop.isPlayerTurn && !reviewMode && !viewingPast,
    rival: { level: rivalLevelDef.level, label: rivalLevelDef.label },
    rating: userRating, // null si aún no hay partidas importadas con Elo
    onTakeback: () => undoMoves(1),
    locale: lang,
  });
  const coachRef = useRef(coach);
  useEffect(() => {
    coachRef.current = coach;
  });
  // El reloj solo corre en una partida contra el rival, desde la primera jugada.
  const isClockRunning =
    loopActive && loop.status === 'playing' && !loop.paused && !reviewMode && !viewingPast && moveHistory.length > 0 &&
    !coach.interrupting; // mientras Alfred te detiene, el reloj se para
  // El usuario solo mueve su color y en su turno (en revisión puede explorar libremente;
  // sin partida en curso el tablero queda libre como antes, p. ej. para puzzles).
  const userCanMove = !loopActive || reviewMode || loop.isPlayerTurn;
  const undoPlies = loopActive ? pliesToUndo(game.history({ verbose: true }), loop.playerColor) : moveHistory.length > 0 ? 1 : 0;
  const canUndo = undoPlies > 0 && !reviewMode && !viewingPast && !isFinalResult(loop.result);

  // Lo que se muestra en el tablero: la partida de Entrenar o la de Análisis.
  const view = isAnalysisTab
    ? {
        game: analysisGame,
        board: analysisGame.board(),
        moveHistory: analysisView.sans,
        currentMoveIndex: analysisView.index,
        openingName: analysisView.opening,
        gameStatus: analysisView.status,
      }
    : { game, board, moveHistory, currentMoveIndex, openingName, gameStatus };
  const shownFen = view.game.fen();

  // --- Motor: clasificación por jugada y evaluación en vivo ---
  const analysisEnabled = activeTab === 'practice' || activeTab === 'analysis';

  // Última jugada de la posición mostrada (chess.js da FEN antes/después y la jugada en UCI).
  // En modo revisión no se clasifican las jugadas exploratorias.
  // Decisión: NO se analiza la partida completa al cargarla en Análisis (≈80 posiciones a
  // profundidad 15 bloquearían la cola del motor ~1 min). Se clasifica bajo demanda la jugada
  // que se está mostrando al navegar; lo ya calculado queda en caché (motor + este estado).
  // Contra el rival se clasifica la última jugada DEL USUARIO: así la respuesta del rival no
  // cancela esa clasificación y el panel sigue mostrando tu jugada.
  const shownHistory = analysisEnabled && (isAnalysisTab || !reviewMode) ? view.game.history({ verbose: true }) : [];
  const lastMove = loopActive && !isAnalysisTab ? shownHistory.findLast((m) => m.color === loop.playerColor) : shownHistory.at(-1);
  // Con Alfred activo, él clasifica y comenta (useCoach); este panel queda para Análisis y juego libre.
  const moveKey = lastMove && (isAnalysisTab || !coach.active) ? `${lastMove.before}|${lastMove.lan}` : null;
  const lastMoveClassification = moveKey ? classifications[moveKey] ?? null : null;

  // Voz del rival (src/rivals): frases según su personalidad; espera al coach si te detiene.
  // Sus buenas jugadas le llegan por `onRivalMoveClassified` (más abajo, desde useMoveLedger).
  const rivalVoice = useRivalVoice({
    enabled: inPractice && gameStatus !== 'Puzzle Mode', level: rivalLevelDef.level, gameId: loop.gameId,
    status: loop.status, result: loop.result, playerColor: loop.playerColor, history: game.history({ verbose: true }),
    playerMove: coach.view.state === 'feedback' ? coach.view : !isAnalysisTab && lastMoveClassification ? { key: moveKey, ...lastMoveClassification } : null,
    coachHolding: coach.rivalBlocked, lang,
  });

  // Se declara ANTES que la evaluación en vivo para que la posición previa entre primero a la cola.
  useEffect(() => {
    if (!moveKey || classifications[moveKey]) return undefined;
    const [fenBefore, moveUci] = moveKey.split('|');
    const controller = new AbortController();
    classifyMove(fenBefore, moveUci, { depth: ANALYSIS_DEPTH, signal: controller.signal })
      .then((result) => setClassifications((prev) => ({ ...prev, [moveKey]: result })))
      .catch((err) => {
        if (!isAbortError(err)) console.error('Error clasificando jugada:', err);
      });
    return () => controller.abort();
  }, [moveKey, classifications, classifyMove]);

  // En tu turno con Alfred: MultiPV 3 (el mismo trabajo sirve a la evaluación, a la clasificación y a las pistas).
  const liveAnalysis = usePositionAnalysis(stockfish, shownFen, {
    depth: ANALYSIS_DEPTH,
    multipv: coach.active && loop.isPlayerTurn && !isAnalysisTab ? 3 : 1,
    enabled: analysisEnabled,
  });
  const liveScore = liveAnalysis?.lines[0]?.score ?? null;
  const evaluationText = formatScore(liveScore);
  const bestMoveSan = liveAnalysis?.bestMove ? uciToSan(shownFen, liveAnalysis.bestMove) : null;

  // --- Clasificación de TODAS las jugadas de la partida (tuyas y del rival) ---
  // Para las estadísticas de fin de partida y las reacciones del rival. Se declara DESPUÉS de la
  // evaluación en vivo: así sus peticiones se unen a los trabajos que esta ya encoló (mismo FEN,
  // profundidad y MultiPV) y no hay búsquedas duplicadas. Ver src/coach/useMoveLedger.js.
  // En juego: la línea actual; terminada (también tras "Nueva partida"): la foto final.
  const ledgerSource = loop.status === 'playing' ? { startFen, sans: moveHistory } : finishedGame;
  const ledgerStartFen = ledgerSource?.startFen ?? START_FEN;
  const ledgerSans = ledgerSource?.sans;
  const ledgerLine = useMemo(() => (ledgerSans ? lineFromSans(ledgerStartFen, ledgerSans) : []), [ledgerStartFen, ledgerSans]);

  /**
   * ── Enganche: jugada del RIVAL clasificada ──────────────────────────────────────────────
   * `onRivalMoveClassified(classification)` se llama UNA vez por cada jugada del rival de la
   * partida de Entrenar en cuanto queda clasificada. Se calcula en segundo plano con los análisis
   * que la app ya tiene (no retrasa la respuesta del rival ni añade búsquedas), así que llega
   * poco después de que el rival mueva (lo que tarde la evaluación de tu turno, ~0,3–1,5 s).
   * No se llama para jugadas deshechas antes de clasificarse ni de partidas anteriores.
   *
   * `classification` (tipo `RivalMoveClassification` en src/coach/useMoveLedger.js) es la salida
   * de `classifyMove` (src/engine/classify.js) más datos de la partida:
   *   label ('Best'|'Excellent'|'Good'|'Inaccuracy'|'Mistake'|'Blunder'), loss (pp de Win%
   *   perdidos), winBefore/winAfter (Win% del rival), evalBefore/evalAfter (perspectiva de
   *   blancas), isBest, bestMoveUci/bestMoveSan, moveUci, moveSan, color (el del rival),
   *   fenBefore/fenAfter, pvSan, y además key, gameId, ply, moveNumber, san, byRival: true.
   *
   * Para las frases del rival: reaccionar aquí (o leer `lastRivalClassification`, que guarda la
   * última y se puede pasar como prop a la barra o al panel del rival).
   */
  const [lastRivalClassification, setLastRivalClassification] = useState(null);
  const notifyRivalVoice = rivalVoice.notifyRivalMove;
  const onRivalMoveClassified = useCallback((classification) => {
    setLastRivalClassification(classification);
    notifyRivalVoice(classification); // frase del rival si fue una buena jugada (src/rivals/voice.js)
  }, [notifyRivalVoice]);

  const ledger = useMoveLedger({
    engine: stockfish.engine,
    enabled: Boolean(ledgerSource) && gameStatus !== 'Puzzle Mode',
    gameId: ledgerSource ? loop.gameId : -1,
    line: ledgerLine,
    playerColor: ledgerSource?.playerColor ?? loop.playerColor,
    coachActive: coach.active,
    onRivalMoveClassified,
  });

  // Guardar inmediatamente; completar después con el ledger existente, sin analizar de nuevo.
  // La foto incluye identidad y coach antes de que una nueva partida reinicie los hooks.
  const trainingRecord = useMemo(() => {
    if (!finishedGame) return null;
    const sameSession = finishedGame.gameId === loop.gameId;
    return buildTrainingGame({
      ...finishedGame,
      line: lineFromSans(finishedGame.startFen, finishedGame.sans),
      classifications: { ...finishedGame.classifications, ...(sameSession ? ledger.classifications : {}) },
      coachRecords: sameSession ? coach.records : finishedGame.coachRecords,
      interactions: sameSession ? coach.interactions : finishedGame.interactions,
      retractedMoves: sameSession ? coach.retractedMoves : finishedGame.retractedMoves,
    });
  }, [finishedGame, loop.gameId, ledger.classifications, coach.records, coach.interactions, coach.retractedMoves]);
  // Partida cuyo resultado se deshizo (mate o tablas). Un efecto de guardado pendiente de un
  // render anterior puede ejecutarse DESPUÉS del clic en Deshacer (React vacía los efectos
  // pasivos al renderizar el siguiente cambio) y volvería a guardar la partida ya retirada.
  // finishGame lo limpia, así que repetir el mate sí guarda de nuevo.
  const discardedTrainingIdRef = useRef(null);
  useEffect(() => {
    if (!trainingRecord) return;
    if (discardedTrainingIdRef.current && trainingRecord.game.id === `escaque:${discardedTrainingIdRef.current}`) return;
    savePlayedGame(trainingRecord).then(
      () => setSaveFailure(null),
      () => setSaveFailure(trainingRecord),
    );
  }, [trainingRecord]);

  // Estadísticas de la partida terminada (se completan a medida que llegan las clasificaciones).
  const gameSummary = useMemo(
    () =>
      finishedGame
        ? summarizeGame({
            line: ledgerLine,
            classifications: ledger.classifications,
            timeUsedMs: finishedGame.timeUsedMs,
            durationMs: finishedGame.durationMs,
            result: finishedGame.result,
            playerColor: finishedGame.playerColor,
            startColor: finishedGame.startFen.split(' ')[1] === 'b' ? 'b' : 'w',
          })
        : null,
    [finishedGame, ledgerLine, ledger.classifications],
  );

  // Aplica una jugada (del usuario o del rival) a la partida y sincroniza el estado derivado:
  // historial, apertura y fin de partida. Devuelve la jugada de chess.js o null si es ilegal.
  const commitMove = (moveInput) => {
    let move;
    try {
      move = game.move(moveInput);
    } catch {
      return null; // Movimiento ilegal
    }
    if (soundOn) playMoveSound(move.captured ? 'capture' : 'move');
    setBoard(game.board());
    setSelectedSquare(null);
    setPossibleMoves([]);

    // En modo revisión se explora libremente: no se toca el historial principal.
    if (!reviewMode) {
      const history = game.history();
      setMoveHistory(history); // Guardamos SANs
      setCurrentMoveIndex(history.length - 1);
      setOpeningName(detectOpening(history));

      if (game.isGameOver()) {
        if (loopActive) {
          finishGame(gameResultFromChess(game), history);
        } else if (game.isCheckmate()) setGameStatus('status.checkmate');
        else if (game.isDraw()) setGameStatus('status.draw');
        else setGameStatus('status.over');
      }
    }
    return move;
  };

  // Campanilla de cierre cuando la partida pasa de "en juego" a "terminada" (mate, tablas,
  // tiempo o abandono). Deshacer un mate y volver a darlo la hace sonar otra vez.
  const prevLoopStatusRef = useRef(loop.status);
  useEffect(() => {
    const prev = prevLoopStatusRef.current;
    prevLoopStatusRef.current = loop.status;
    if (prev === 'playing' && loop.status === 'over' && soundOn) playGameEndSound();
  }, [loop.status, soundOn]);

  // Cuando Alfred libera la partida, entra la jugada retenida del rival (si sigue vigente).
  useEffect(() => {
    if (!heldRivalMove || coach.rivalBlocked || loop.paused) return;
    const move = heldRivalMove;
    queueMicrotask(() => {
      setHeldRivalMove(null);
      if (game.fen() === move.fen) commitMove({ from: move.from, to: move.to, promotion: move.promotion ?? undefined });
    });
  });

  // Coronación pendiente: el usuario llevó un peón a la última fila y elige la pieza en el
  // selector del tablero. Va atada a la posición: si la partida cambia (tiempo, abandono...),
  // el selector desaparece solo.
  const [pendingPromotion, setPendingPromotion] = useState(null); // { fen, from, to, color }
  const promotionPrompt = pendingPromotion && pendingPromotion.fen === game.fen() ? pendingPromotion : null;

  // Bloqueos comunes a clic y arrastre.
  const boardLocked = () =>
    game.isGameOver() ||
    viewingPast ||
    Boolean(promotionPrompt) ||
    // Solo permitir mover en modo práctica (Analysis es solo lectura/navegación según requerimiento)
    activeTab === 'analysis' ||
    !userCanMove;

  /** true si from→to es una coronación legal en la posición actual. */
  const isPromotionMove = (from, to) => {
    const piece = game.get(from);
    if (!piece || piece.type !== 'p') return false;
    return game.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  };

  /** Intenta una jugada del usuario; si es una coronación, abre el selector en vez de mover. */
  const tryUserMove = (from, to) => {
    if (isPromotionMove(from, to)) {
      setPendingPromotion({ fen: game.fen(), from, to, color: game.turn() });
      setPossibleMoves([]);
      return true;
    }
    return Boolean(commitMove({ from, to }));
  };

  const handlePromotionSelect = (piece) => {
    const p = promotionPrompt;
    setPendingPromotion(null);
    if (!p) return;
    commitMove({ from: p.from, to: p.to, promotion: piece });
  };

  // Esc o clic fuera: no se mueve nada (la pieza queda en su casilla).
  const handlePromotionCancel = () => {
    setPendingPromotion(null);
    setSelectedSquare(null);
    setPossibleMoves([]);
  };

  // Manejo de Clicks
  const handleSquareClick = (row, col) => {
    if (boardLocked()) return;

    const file = String.fromCharCode(97 + col);
    const rank = String(8 - row);
    const square = `${file}${rank}`;

    // 1. Intentar mover (las coronaciones abren el selector de pieza)
    if (selectedSquare && tryUserMove(selectedSquare, square)) return;

    // 2. Seleccionar (en partida contra el rival, solo piezas propias)
    const piece = game.get(square);
    if (piece && piece.color === game.turn()) {
      setSelectedSquare(square);
      const moves = game.moves({ square, verbose: true });
      setPossibleMoves([...new Set(moves.map(m => m.to))]);
    } else {
      setSelectedSquare(null);
      setPossibleMoves([]);
    }
  };

  const handlePieceDrop = (sourceSquare, targetSquare) => {
      if (boardLocked()) return;
      tryUserMove(sourceSquare, targetSquare);
  };

  // `fen`: posición inicial (solo la usan las pruebas e2e; por defecto, la estándar).
  const resetGame = (fullReset = true, fen = START_FEN) => {
    const newGame = new Chess(fen);
    setStartFen(fen);
    setGame(newGame);
    setBoard(newGame.board());
    setSelectedSquare(null);
    setPossibleMoves([]);
    setMoveHistory([]);
    setCurrentMoveIndex(-1);
    setGameStatus(null);
    setOpeningName("");
    setReviewMode(false);
    setReviewClassification(null);
    setHeldRivalMove(null);
    setPendingPromotion(null);
    setClockKey((k) => k + 1);
    loop.reset();
    if (fullReset) {
        setClockTimes({ white: 600, black: 600 });
    }
  };

  // Empieza una partida contra el rival con el color y nivel elegidos.
  const startGameFrom = ({ fen = START_FEN, color } = {}) => {
    resetGame(false, fen);
    const playerColor = loop.startGame(color);
    setOrientation(playerColor === 'w' ? 'white' : 'black');
    setFinishedGame(null);
    setShowLastSummary(false);
    gameStartedAtRef.current = wallClockMs();
    trainingSessionRef.current = {
      id: globalThis.crypto.randomUUID(), startedAt: gameStartedAtRef.current,
      playerName: profile.name,
      rival: { name: getRivalLevel(loop.level).name, level: loop.level, elo: getRivalLevel(loop.level).elo },
      timeControl: { initialSeconds: clockTimes.white, increment: 0 },
    };
    if (soundOn) playGameStartSound();
  };
  const handleStartGame = () => startGameFrom();

  // Gancho SOLO para las pruebas e2e (build con `--mode e2e`, ver README): empezar una partida
  // contra el rival desde un FEN. En producción `import.meta.env.MODE` es 'production' y Vite
  // elimina este bloque del bundle.
  const startGameFromRef = useRef(startGameFrom);
  useEffect(() => {
    startGameFromRef.current = startGameFrom;
  });
  useEffect(() => {
    if (import.meta.env.MODE !== 'e2e') return undefined;
    window.__escaqueTest = {
      /** @param {string} fen  @param {{color?: 'w'|'b'}} [opts]  color del usuario (por defecto, el que mueve) */
      startFromFen: (fen, { color } = {}) => startGameFromRef.current({ fen, color: color ?? fen.split(' ')[1] }),
    };
    return () => {
      delete window.__escaqueTest;
    };
  }, []);

  // Termina la partida de Entrenar con `result` y guarda la foto para las estadísticas.
  // `sans`: la línea jugada (por defecto, el historial actual).
  const finishGame = (result, sans = moveHistory) => {
    if (!loopActive || loop.status !== 'playing') return;
    discardedTrainingIdRef.current = null;
    emitRewardEvent('training-finished', { id: trainingSessionRef.current.id, plies: sans.length, startColor: startFen.split(' ')[1], result, playerColor: loop.playerColor, level: loop.activeLevel });
    loop.endGame(result);
    setGameStatus({ result, playerColor: loop.playerColor });
    const initialMs = clockTimes.white * 1000;
    setFinishedGame({
      ...trainingSessionRef.current,
      endedAt: wallClockMs(),
      times: { timeUsedMs: { w: initialMs - clock.ms.w, b: initialMs - clock.ms.b }, durationMs: wallClockMs() - gameStartedAtRef.current },
      classifications: { ...ledger.classifications },
      coachRecords: coach.records,
      interactions: coach.interactions,
      retractedMoves: coach.retractedMoves,
      gameId: loop.gameId,
      startFen,
      sans: [...sans],
      result,
      playerColor: loop.playerColor,
      level: loop.activeLevel,
      timeUsedMs: { w: initialMs - clock.ms.w, b: initialMs - clock.ms.b },
      durationMs: gameStartedAtRef.current ? wallClockMs() - gameStartedAtRef.current : null,
    });
  };

  // Deshacer: contra el rival vuelve a la posición previa a tu última jugada
  // (2 plies si el rival ya respondió; 1 si aún pensaba o si tu jugada terminó la partida).
  const undoMoves = (plies) => {
    setHeldRivalMove(null);
    for (let i = 0; i < plies; i++) game.undo();
    const history = game.history();
    setBoard(game.board());
    setSelectedSquare(null);
    setPossibleMoves([]);
    setMoveHistory(history);
    setCurrentMoveIndex(history.length - 1);
    setOpeningName(detectOpening(history));
    if (loopActive) {
      loop.resumeAfterUndo();
      // Un mate o unas tablas deshechos: la partida sigue (tiempo y abandono no se deshacen).
      if (!isFinalResult(loop.result)) {
        if (finishedGame?.id) {
          discardedTrainingIdRef.current = finishedGame.id;
          removePlayedGame(`escaque:${finishedGame.id}`).catch(() => showNotice(t('myGames.saveTrainingFailed')));
        }
        setFinishedGame(null);
      }
    }
    setGameStatus(null);
  };

  const handleUndo = () => {
    if (!canUndo) return;
    coach.noteUndo();
    undoMoves(undoPlies);
  };

  const handleTimeOut = (flagged) => {
    if (!loopActive || loop.status !== 'playing') return;
    finishGame(timeoutResult(flagged));
  };

  // Reloj de la partida de Entrenar: vive aquí (no en GameClock), así corre en cualquier pestaña.
  const clock = useChessClock({
    initialSeconds: clockTimes.white,
    running: isClockRunning,
    turn: game.turn(),
    resetKey: clockKey,
    onTimeOut: handleTimeOut,
  });

  // Última jugada mostrada (casillas resaltadas) y, si es del rival en la partida actual, se anima.
  const lastPlayed = view.game.history({ verbose: true }).at(-1) ?? null;
  const lastMoveSquares = lastPlayed && !reviewMode ? { from: lastPlayed.from, to: lastPlayed.to } : null;
  const animateRivalMove =
    inPractice && loopActive && lastPlayed && lastPlayed.color === loop.rivalColor && !viewingPast && !reviewMode
      ? { from: lastPlayed.from, to: lastPlayed.to, key: view.moveHistory.length }
      : null;

  // Rey derrotado (se inclina): partida de Entrenar terminada con ganador (mate, tiempo o
  // abandono) o mate en juego libre, mostrando la posición final. En tablas, ninguno.
  let defeatedKing = null;
  if (inPractice && !reviewMode && !viewingPast) {
    if (loopActive && loop.status === 'over' && loop.result?.winner) defeatedKing = loop.result.winner === 'w' ? 'b' : 'w';
    else if (!loopActive && game.isCheckmate()) defeatedKing = game.turn();
  }

  // Barras de jugador encima (rival) y debajo (tú) del tablero: nombre, capturas, +N y reloj.
  const materialInfo = materialSummary(shownFen);
  const bottomColor = orientation === 'white' ? 'w' : 'b';
  const topColor = bottomColor === 'w' ? 'b' : 'w';
  const playerBarProps = (color) => {
    let name = color === 'w' ? t('common.white') : t('common.black');
    let detail = null;
    let avatar = null;
    let speech = null;
    if (isAnalysisTab && selectedGame) {
      name = color === 'w' ? selectedGame.white : selectedGame.black;
      const elo = color === 'w' ? selectedGame.whiteElo : selectedGame.blackElo;
      detail = elo ? `(${elo})` : null;
    } else if (!isAnalysisTab && gameStatus !== 'Puzzle Mode') {
      // En Entrenar: tú y tu rival (antes de empezar, el personaje elegido; tú abajo).
      const mine = loopActive ? loop.playerColor : bottomColor;
      const rivalDef = loopActive ? rivalLevelDef : getRivalLevel(loop.level);
      if (color === mine) {
        name = profile.name;
        detail = userRating ? `(${userRating})` : null;
        avatar = <UserAvatar config={profile.avatar} size={28} label={t('profile.avatarOf', { name: profile.name })} />;
      } else {
        name = rivalDef.name;
        detail = rivalEloText(rivalDef, t);
        avatar = <RivalAvatar level={rivalDef.level} size={28} label={t('profile.avatarOf', { name: rivalDef.name })} />;
        speech = <RivalSpeech speech={rivalVoice.speech} onDismiss={rivalVoice.dismiss} name={rivalDef.name} />;
      }
    }
    // Relojes solo en la partida de Entrenar (Análisis no tiene tiempos por jugada).
    const showClock = !isAnalysisTab && gameStatus !== 'Puzzle Mode';
    return {
      color,
      name,
      detail,
      avatar,
      captured: materialInfo[color].captured,
      advantage: materialInfo[color].advantage,
      clock: showClock ? clock[color] : null,
      clockActive: showClock && isClockRunning && game.turn() === color,
      isTurn: view.game.turn() === color,
      speech,
    };
  };

  // Abandono: botón Abandonar, o más de 30 s fuera de Entrenar con la partida en juego
  // (una partida en pausa no cuenta: el reloj está parado).
  const handleAbandon = () => {
    if (loop.status !== 'playing') return;
    finishGame(abandonResult(loop.playerColor));
  };
  const awayFromGame = !inPractice && loop.status === 'playing' && !loop.paused;
  const abandonLeft = useAbandonCountdown({
    armed: awayFromGame,
    graceMs: ABANDON_GRACE_MS,
    onExpire: () => {
      handleAbandon();
      showNotice(t('practice.abandonedNotice'));
    },
  });

  const loadGame = (gameData, requestedPly = null) => {
      setReviewTargets(null);
      setSelectedGame(gameData);
      const newGame = new Chess();

      // PGN completo de la partida importada (cabeceras, relojes y comentarios: chess.js los admite).
      try {
          if (gameData.pgn) newGame.loadPgn(gameData.pgn);
      } catch {
          showNotice(t('analysis.pgnError'));
      }

      const history = newGame.history();

      // Tiempo inicial del control de tiempo ("300+3" → 300 s).
      const initialTime = parseInt(String(gameData.timeControl ?? '').split('+')[0], 10) || 600;
      // Solo el tablero de Análisis: la partida de Entrenar no se toca.
      setAnalysisView({
          sans: history,
          index: requestedPly == null ? history.length - 1 : Math.max(-1, Math.min(history.length - 1, requestedPly - 1)),
          opening: gameData.opening || detectOpening(history),
          status: gameData.result,
          initialTime,
          startFen: newGame.getHeaders().FEN ?? START_FEN,
      });
  };

  const openPlanReview = (target, targets) => {
    const saved = gamesData.find((g) => g.id === target.gameId);
    if (!saved) return;
    loadGame(saved, target.ply);
    setReviewTargets(targets);
    setActiveTab('analysis');
  };
  const followTrainingPlan = (action) => {
    if (action.type === 'puzzles') {
      setPuzzleTarget({ ...action.target, id: action.id });
      setActiveTab('puzzles');
    } else if (action.type === 'review') {
      openPlanReview(action.target, action.target.targets);
    } else if (action.type === 'practice') {
      if (loop.status === 'playing') { showNotice(t('progress.plan.finishFirst')); return; }
      loop.setLevel(action.target.level);
      loop.setColorChoice(action.target.color);
      resetGame(false);
      setOpeningGoal(action.target.opening);
      setActiveTab('practice');
    }
  };

  // Navegación (Analysis)
  const handleNavigate = (direction) => {
    if (view.moveHistory.length === 0) return;

    let newIndex = view.currentMoveIndex;

    if (direction === 'start') newIndex = -1;
    else if (direction === 'prev') newIndex = Math.max(-1, view.currentMoveIndex - 1);
    else if (direction === 'next') newIndex = Math.min(view.moveHistory.length - 1, view.currentMoveIndex + 1);
    else if (direction === 'end') newIndex = view.moveHistory.length - 1;

    if (isAnalysisTab) {
      setAnalysisView((v) => ({ ...v, index: newIndex }));
      return;
    }

    // Crear juego temporal para mostrar estado en newIndex
    const tempGame = new Chess(startFen);
    for (let i = 0; i <= newIndex; i++) {
        tempGame.move(moveHistory[i]);
    }

    setGame(tempGame);
    setBoard(tempGame.board());
    setCurrentMoveIndex(newIndex);
    setSelectedSquare(null);
    setPossibleMoves([]);

    // In this JSON data, we don't have per-move times, so we don't update clock dynamically based on move index.
    // The requirement says: "si es que está disponible en el json... caso contrario el reloj solo dirá el tiempo qué duró la partida en general"
    // So we keep the initial time or could show Total Time if we had it (duration).
    // We just leave the parsed time control.
  };


  // Pagination Logic
  const paginatedGames = useMemo(() => {
      const list = gamesData;
      // Tras borrar o filtrar puede quedar una página que ya no existe: se muestra la última.
      const page = Math.min(currentPage, Math.max(1, Math.ceil(list.length / GAMES_PER_PAGE)));
      const start = (page - 1) * GAMES_PER_PAGE;
      return list.slice(start, start + GAMES_PER_PAGE);
  }, [gamesData, currentPage]);

  const totalPages = Math.max(1, Math.ceil(gamesData.length / GAMES_PER_PAGE));


  // Texto del estado de la partida mostrada (cabecera): clave de juego libre, resultado contra el
  // rival (se traduce al vuelo) o el resultado tal cual de una partida importada ("1-0").
  const statusText = (s) =>
    typeof s === 'object' ? resultText(s.result, s.playerColor, t) : String(s).startsWith('status.') ? t(s) : s;

  // Selector de rival, color, coach y ritmo (entre partidas).
  const levelSelectorPanel =
    activeTab === 'practice' && loop.status !== 'playing' && gameStatus !== 'Puzzle Mode' ? (
      <LevelSelector
        level={loop.level}
        onLevelChange={loop.setLevel}
        colorChoice={loop.colorChoice}
        onColorChange={loop.setColorChoice}
        coachId={coach.prefs.coach}
        onCoachChange={(id) => coach.setPrefs({ coach: id })}
        timeControl={clockTimes.white}
        onTimeControlChange={(seconds) => {
          setClockTimes({ white: seconds, black: seconds });
          resetGame(false);
        }}
        onStart={handleStartGame}
        rivalStatus={t(`status.rival.${rivalEngine.status}`)}
        rivalVoiceOn={rivalVoice.voiceOn}
        onRivalVoiceChange={rivalVoice.setVoiceOn}
      />
    ) : null;

  return (
    <div className="bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100 font-sans flex flex-col h-[100dvh] w-full overflow-hidden">
      
      {/* MENÚ (hamburguesa): oculto hasta hacer clic en ☰ o acercar el ratón al borde izquierdo */}
      <SideMenu
        items={NAV_ITEMS}
        activeTab={activeTab}
        // Cambiar de pestaña no toca la partida de Entrenar: sigue en juego (ver abandono).
        onSelect={(id) => {
          if (id === 'puzzles') setPuzzleTarget(null);
          setActiveTab(id);
          closeMenu();
        }}
        open={menu.open}
        mode={menu.mode}
        onOpen={openMenu}
        onClose={closeMenu}
        practiceAlert={loop.status === 'playing' && !inPractice}
        onAbout={() => {
          closeMenu();
          setWelcomeOpen(true);
        }}
        gameInProgress={loop.status === 'playing'}
      />

      {/* CONTENIDO */}
      <main className="flex-1 min-h-0 min-w-0 p-3 lg:p-4 overflow-y-auto overflow-x-hidden flex flex-col relative">
        <header className="flex justify-between items-center gap-3 mb-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            data-testid="menu-toggle"
            aria-label={menu.open ? t('menu.close') : t('menu.open')}
            aria-expanded={menu.open}
            onClick={() => (menu.open ? closeMenu() : openMenu('click'))}
            className="relative w-10 h-10 p-0 flex-shrink-0 rounded-xl flex items-center justify-center bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 text-ink-600 dark:text-ink-200 hover:bg-ink-100 dark:hover:bg-ink-700 shadow-sm"
          >
            <Menu size={20} />
            {loop.status === 'playing' && !inPractice && (
              <span title={t('menu.gameInProgress')} className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
          <div className="min-w-0">
            <h2 className="text-xl lg:text-2xl font-black text-ink-800 dark:text-ink-100 tracking-tight leading-tight truncate">
              {t(`header.${activeTab}`)}
            </h2>
            <p className="text-ink-500 dark:text-ink-400 text-xs lg:text-sm font-medium truncate">
                {view.openingName && (isAnalysisTab || inPractice) && <span className="bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 px-2 py-1 rounded text-xs mr-2">{view.openingName}</span>}
                Stockfish: <span className={stockfish.isReady?'text-emerald-500 font-bold':'text-amber-500'}>{engineStatus}</span>
                {activeTab === 'practice' && (
                    <> · {t('header.rival')}: <span data-testid="rival-status" className={rivalEngine.isReady?'text-emerald-500 font-bold':'text-amber-500'}>{t(`status.rival.${rivalEngine.status}`)}</span></>
                )}
            </p>
          </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
             <button
               type="button"
               data-testid="sound-toggle"
               data-sound={soundOn ? 'on' : 'off'}
               onClick={toggleSound}
               aria-label={soundOn ? t('header.soundOffLong') : t('header.soundOnLong')}
               title={soundOn ? t('header.soundOff') : t('header.soundOn')}
               className="w-10 h-10 p-0 rounded-full flex items-center justify-center border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-700 shadow-sm transition-colors"
             >
               {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
             </button>
             <ThemeToggle theme={theme} onToggle={toggleTheme} />
             <RewardsRoot soundOn={soundOn} activeTab={activeTab} />
             {view.gameStatus && (isAnalysisTab || inPractice) && <div data-testid="game-status" className="px-4 py-2 bg-rose-500 text-white font-bold rounded-xl animate-pulse shadow-lg">{statusText(view.gameStatus)}</div>}
             <button
               type="button"
               data-testid="profile-button"
               onClick={() => setEditingAvatar(true)}
               title={t('profile.edit')}
               aria-label={t('profile.edit')}
               className="w-10 h-10 p-0 flex-shrink-0 rounded-full ring-2 ring-brand-500 hover:ring-4 transition-all"
             >
               <UserAvatar config={profile.avatar} size={40} label={t('profile.avatarOf', { name: profile.name })} />
             </button>
          </div>
        </header>

        {activeTab === 'analysis' && reviewTargets && (
          <div data-testid="plan-review-targets" data-game-id={selectedGame?.id} data-ply={analysisView.index + 1} className="rounded-2xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 p-3 mb-3 flex flex-wrap gap-2 flex-shrink-0">
            {reviewTargets.map((target) => <button key={`${target.gameId}:${target.ply}`} data-testid={`plan-review-target-${target.gameId}-${target.ply}`} className="rounded-xl bg-brand-600 text-white px-3 py-2 text-sm" onClick={() => openPlanReview(target, reviewTargets)}>
              {t('progress.plan.reviewTarget', { date: shortDate(gamesData.find((g) => g.id === target.gameId)?.endTime, lang, t), ply: target.ply })}
            </button>)}
          </div>
        )}

        {/* Partida en curso mientras miras otra pestaña: cuenta atrás de abandono */}
        {awayFromGame && abandonLeft !== null && (
            <div data-testid="away-banner" role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 rounded-2xl px-4 py-3 text-sm font-bold flex-shrink-0">
                <span>
                    {t('away.clock')} <span className="font-mono">{formatClock(clock[loop.playerColor])}</span> ·
                    {' '}{t('away.comeBack')} <span data-testid="away-seconds" className="font-mono">{abandonLeft}</span> {t('away.orAbandoned')}
                </span>
                <button
                  data-testid="back-to-game"
                  onClick={() => setActiveTab('practice')}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl"
                >
                    {t('away.back')}
                </button>
            </div>
        )}

        {/* --- PESTAÑA ENTRENAMIENTO y ANÁLISIS --- */}
        {(activeTab === 'practice' || activeTab === 'analysis') && (
          <div className="flex flex-col min-[960px]:flex-row gap-3 xl:gap-4 pb-1 min-[960px]:flex-1 min-[960px]:min-h-0">

            {/* COLUMNA IZQUIERDA: Tablero (se dimensiona solo: ChessBoard mide el espacio libre) */}
            <div className="bg-white dark:bg-ink-900 p-3 rounded-3xl shadow-sm border border-ink-100 dark:border-ink-800 flex flex-col items-center relative overflow-hidden min-[960px]:flex-1 min-[960px]:min-w-0 min-[960px]:min-h-[300px]">
                    <ChessBoard
                        board={view.board}
                        onSquareClick={handleSquareClick}
                        onPieceDrop={handlePieceDrop}
                        selectedSquare={selectedSquare}
                        possibleMoves={possibleMoves}
                        onReset={resetGame}
                        evaluation={evaluationText}
                        onNavigate={handleNavigate}
                        canGoBack={view.currentMoveIndex >= 0}
                        canGoForward={view.currentMoveIndex < view.moveHistory.length - 1}
                        orientation={orientation}
                        onRotate={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
                        extraArrows={inPractice ? coach.hintArrows : []}
                        fitHeight={isWide}
                        aside={showEvalBar ? <EvalBar score={liveScore} orientation={orientation} /> : null}
                        lastMove={lastMoveSquares}
                        boardTheme={boardTheme}
                        onBoardThemeChange={changeBoardTheme}
                        animateMove={animateRivalMove}
                        promotion={promotionPrompt && !isAnalysisTab ? { square: promotionPrompt.to, color: promotionPrompt.color } : null}
                        onPromotionSelect={handlePromotionSelect}
                        onPromotionCancel={handlePromotionCancel}
                        defeatedKing={defeatedKing}
                        topBar={<PlayerBar {...playerBarProps(topColor)} />}
                        bottomBar={<PlayerBar {...playerBarProps(bottomColor)} />}
                    />
            </div>
            
            {/* COLUMNA DERECHA: Paneles */}
            <div className="w-full min-[960px]:w-[320px] xl:w-[380px] flex flex-col gap-3 min-[960px]:h-full min-[960px]:overflow-y-auto flex-shrink-0">

               {/* Partida contra el rival: configuración (antes de empezar; al terminar va debajo de las estadísticas) */}
               {activeTab === 'practice' && openingGoal && <p data-testid="practice-opening-goal" className="rounded-2xl p-3 bg-brand-50 dark:bg-brand-950 text-brand-800 dark:text-brand-200 text-sm">{t('progress.plan.goal', { opening: openingGoal })}</p>}
               {loop.status === 'setup' && levelSelectorPanel}

               {/* Estadísticas de la partida anterior: disponibles hasta que empiece otra */}
               {activeTab === 'practice' && loop.status === 'setup' && gameSummary && (
                   showLastSummary ? (
                       <GameSummary
                         summary={gameSummary}
                         playerName={profile.name}
                         rivalName={getRivalLevel(finishedGame.level).name}
                         resultLabel={resultText(finishedGame.result, finishedGame.playerColor, t)}
                         onClose={() => setShowLastSummary(false)}
                       />
                   ) : (
                       <button
                         data-testid="summary-toggle"
                         onClick={() => setShowLastSummary(true)}
                         className="w-full py-2 bg-white dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800 border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                       >
                           <BarChart2 size={16}/> {t('practice.lastSummary')}
                       </button>
                   )
               )}

               {/* Partida contra el rival: estado */}
               {showMatch && (
                   <div
                     data-testid="match-panel"
                     data-status={loop.status}
                     data-player-color={loop.playerColor}
                     data-rival-thinking={loop.rivalThinking ? 'true' : 'false'}
                     data-last-rival-label={lastRivalClassification?.label ?? ''}
                     data-last-rival-uci={lastRivalClassification?.moveUci ?? ''}
                     className="bg-white dark:bg-ink-900 p-4 rounded-2xl shadow-sm border border-ink-200 dark:border-ink-700 flex flex-col gap-3"
                   >
                       <div className="flex justify-between items-center gap-2">
                           <div className="flex items-center gap-3 min-w-0">
                           <RivalAvatar level={rivalLevelDef.level} size={40} label={t('profile.avatarOf', { name: rivalLevelDef.name })} />
                           <div className="min-w-0">
                               <p className="text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400">
                                   {t('match.yourRival', { level: rivalLevelDef.level, elo: rivalEloText(rivalLevelDef, t) })}
                               </p>
                               <p className="font-bold text-ink-800 dark:text-ink-100 truncate" title={rivalEpithet(rivalLevelDef, t)}>
                                   {rivalLevelDef.name}{' '}
                                   <span className="text-xs font-medium text-ink-400">
                                       · {loop.playerColor === 'w' ? t('match.playingWhite') : t('match.playingBlack')}
                                   </span>
                               </p>
                           </div>
                           </div>
                           <span data-testid="match-state" className={`text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap ${
                               loop.status === 'over' ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                               : loop.paused ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                               : loop.rivalThinking ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300 animate-pulse'
                               : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                           }`}>
                               {loop.status === 'over' ? t('match.over')
                                 : loop.paused ? t('match.paused')
                                 : reviewMode ? t('match.review')
                                 : coach.interrupting ? t('match.coachStops', { coach: getCoach(coach.prefs.coach).name })
                                 : coach.rivalBlocked ? t('match.coachLooks', { coach: getCoach(coach.prefs.coach).name })
                                 : loop.rivalThinking ? t('match.rivalThinking')
                                 : loop.isPlayerTurn ? t('match.yourTurn') : '...'}
                           </span>
                       </div>

                       {loop.status === 'over' && loop.result && (
                           <p data-testid="game-result" className="text-sm font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">
                               {resultText(loop.result, loop.playerColor, t)}
                           </p>
                       )}
                       {loop.rivalError && (
                           <p role="alert" className="text-xs text-rose-600">{t('match.rivalError', { error: loop.rivalError })}</p>
                       )}

                       <div className="grid grid-cols-2 gap-2">
                           {loop.status === 'playing' ? (
                               <button
                                 data-testid="pause"
                                 onClick={() => loop.setPaused((p) => !p)}
                                 className="py-2 bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700 text-ink-600 dark:text-ink-300 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                               >
                                   {loop.paused ? <><Play size={16}/> {t('match.resume')}</> : <><Pause size={16}/> {t('match.pause')}</>}
                               </button>
                           ) : (
                               <button
                                 data-testid="new-game"
                                 onClick={() => resetGame(false)}
                                 className="py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm"
                               >
                                   {t('match.newGame')}
                               </button>
                           )}
                           {loop.status === 'playing' ? (
                               <button
                                 data-testid="abandon"
                                 onClick={handleAbandon}
                                 className="py-2 bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700 text-ink-600 dark:text-ink-300 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                               >
                                   <Flag size={16}/> {t('match.resign')}
                               </button>
                           ) : (
                               <span />
                           )}
                       </div>
                   </div>
               )}

               {saveFailure && (
                 <button data-testid="training-save-retry" className="p-3 rounded-2xl text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950" onClick={() => {
                   savePlayedGame(saveFailure).then(() => setSaveFailure(null), () => {});
                 }}>{t('myGames.saveTrainingFailed')}</button>
               )}
               {/* Estadísticas al terminar la partida */}
               {showMatch && loop.status === 'over' && gameSummary && (
                   <GameSummary
                     summary={gameSummary}
                     playerName={profile.name}
                     rivalName={rivalLevelDef.name}
                     resultLabel={loop.result ? resultText(loop.result, loop.playerColor, t) : null}
                   />
               )}

               {/* Alfred (coach) */}
               {showMatch && <CoachPanel coach={coach} isPlayerTurn={loop.isPlayerTurn && !reviewMode && !viewingPast} />}

               {/* Partida terminada: el selector para la siguiente, debajo del resultado y las estadísticas */}
               {loop.status === 'over' && levelSelectorPanel}

               {/* Reloj y Controles */}
               <div className="flex flex-col gap-2">

                   {activeTab === 'practice' && gameStatus !== 'Puzzle Mode' && (
                       <button
                         data-testid="undo"
                         onClick={handleUndo}
                         disabled={!canUndo}
                         title={loopActive ? t('practice.undoTitleRival') : t('practice.undoTitle')}
                         className="w-full py-3 bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700 text-ink-600 dark:text-ink-300 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                       >
                           <Undo2 size={18}/> {loopActive && undoPlies === 2 ? t('practice.undoTwo') : t('practice.undoOne')}
                       </button>
                   )}
               </div>

               {/* Move Classification & Review */}
               {(activeTab === 'practice' || activeTab === 'analysis') && lastMoveClassification && !reviewMode && (
                   <div data-testid="move-classification" className="bg-ink-800 p-4 rounded-2xl border border-ink-600 animate-in fade-in slide-in-from-bottom-2">
                       <div className="flex justify-between items-center mb-2">
                           <span className={`text-xl ${CLASSIFICATION_STYLES[lastMoveClassification.label]}`}>
                               <span className="text-ink-300 font-mono text-base mr-2">{lastMoveClassification.moveSan}</span>
                               {lastMoveClassification.label}
                           </span>
                           <span className="text-ink-400 text-xs">{t('practice.loss', { pct: lastMoveClassification.loss.toFixed(1) })}</span>
                       </div>
                       {!isAnalysisTab && (lastMoveClassification.label === 'Mistake' || lastMoveClassification.label === 'Blunder') && (
                           <button
                             onClick={() => {
                                 setReviewClassification(lastMoveClassification);
                                 setReviewMode(true);
                                 // We are now in review mode. User can explore.
                                 // Ideally we show the best move arrow or something.
                             }}
                             className="w-full py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold text-sm"
                           >
                               {t('review.show')}
                           </button>
                       )}
                   </div>
               )}

               {/* Review Mode Control */}
               {reviewMode && (
                   <div className="bg-amber-100 dark:bg-amber-900/40 p-4 rounded-2xl border border-amber-300 dark:border-amber-700">
                       <h4 className="font-bold text-amber-800 dark:text-amber-200 mb-2">{t('review.title')}</h4>
                       <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">{t('review.exploring')}</p>
                       <p className="text-sm font-mono mb-2">{t('review.bestWas')} <strong>{reviewClassification?.bestMoveSan ?? "..."}</strong></p>
                       <button
                         onClick={() => {
                             // Restore game state to before exploration?
                             // Currently we are exploring on the main board object.
                             // To properly restore, we should have saved the FEN/history before entering review.
                             // For simplicity in this iteration: We just undo moves until we are back to 'currentMoveIndex'
                             // OR we rely on the user to manually undo or we reset to the history state.

                             // Reset board to the state of 'moveHistory'
                             const restoredGame = new Chess(startFen);
                             for (const move of moveHistory) {
                                 restoredGame.move(move);
                             }
                             setGame(restoredGame);
                             setBoard(restoredGame.board());

                             setReviewMode(false);
                             setReviewClassification(null);
                         }}
                         className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-sm"
                       >
                           {t('review.continue')}
                       </button>
                   </div>
               )}

               {/* Stockfish */}
               <div className="bg-ink-900 text-white p-6 rounded-[2rem] relative overflow-hidden flex-shrink-0">
                  <h3 className="text-sm font-black mb-2 z-10 relative uppercase tracking-wider text-brand-400">Stockfish 17.1</h3>
                  <div className="grid grid-cols-2 gap-4 z-10 relative mt-2">
                     <div className="bg-white/10 p-3 rounded-xl">
                        <p className="text-[10px] text-ink-400 font-bold uppercase">{t('engine.bestMove')}</p>
                        {/* Con Alfred, en tu turno la mejor jugada se oculta: para eso están las pistas. */}
                        {coach.active && loop.isPlayerTurn && !isAnalysisTab ? (
                            <p data-testid="best-move" data-hidden="true" data-san={bestMoveSan ?? ''} className="text-xs text-ink-400 mt-1">{t('engine.hiddenBest')}</p>
                        ) : (
                            <p data-testid="best-move" className="text-lg font-mono text-amber-300 truncate">{bestMoveSan || "..."}</p>
                        )}
                     </div>
                     <div className="bg-white/10 p-3 rounded-xl">
                        <p className="text-[10px] text-ink-400 font-bold uppercase">{t('engine.evaluation')}</p>
                        <p data-testid="evaluation" className="text-lg font-mono text-white">{evaluationText || "-"}</p>
                     </div>
                  </div>
               </div>

               {/* Lista de Partidas (Solo Análisis) */}
               {activeTab === 'analysis' && (
                   <div className="bg-white dark:bg-ink-900 p-6 rounded-[2rem] shadow-sm border border-ink-100 dark:border-ink-800 flex-1 overflow-hidden flex flex-col min-h-[360px] flex-shrink-0">
                       {/* Summary Panel */}
                       <div className="mb-4 p-3 bg-brand-50 dark:bg-brand-950/50 rounded-xl border border-brand-100 dark:border-brand-900">
                           <h4 className="font-bold text-brand-800 dark:text-brand-200 text-xs uppercase mb-2">{t('analysis.liveSummary')}</h4>
                           <div className="grid grid-cols-2 gap-2 text-xs">
                               <div className="bg-white dark:bg-ink-900 p-2 rounded">
                                   <span className="block text-ink-400 font-bold">{t('analysis.state')}</span>
                                   <span className="font-mono text-ink-800 dark:text-ink-100">{lastMoveClassification ? lastMoveClassification.label : "Neutral"}</span>
                               </div>
                               <div className="bg-white dark:bg-ink-900 p-2 rounded">
                                   <span className="block text-ink-400 font-bold">{t('analysis.turn')}</span>
                                   <span className="font-mono text-ink-800 dark:text-ink-100">{view.game.turn() === 'w' ? t('common.white') : t('common.black')}</span>
                               </div>
                           </div>
                       </div>

                       <h3 className="font-bold text-ink-800 dark:text-ink-100 mb-4 flex items-center gap-2 flex-shrink-0">
                           <Activity size={20} className="text-brand-600"/> {t('analysis.history')}
                       </h3>
                       {gamesData.length === 0 ? (
                           <div data-testid="analysis-empty" className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-6">
                               <p className="font-bold text-ink-700 dark:text-ink-200">{gamesLoading ? t('games.loading') : t('games.importCta')}</p>
                               {!gamesLoading && (
                                   <button
                                     data-testid="analysis-go-import"
                                     onClick={() => setActiveTab('games')}
                                     className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm flex items-center gap-2"
                                   >
                                       <Download size={16}/> {t('games.goTo')}
                                   </button>
                               )}
                           </div>
                       ) : (
                       <div data-testid="analysis-games" className="space-y-3 overflow-y-auto flex-1 pr-2">
                           {paginatedGames.map((g) => {
                               const outcome = outcomeFor(g);
                               return (
                               <div
                                 key={g.id}
                                 data-testid="analysis-game"
                                 data-game-id={g.id}
                                 onClick={() => loadGame(g)}
                                 className={`p-3 rounded-xl cursor-pointer transition-all border text-sm ${selectedGame?.id === g.id ? 'bg-brand-50 dark:bg-brand-950/50 border-brand-200 dark:border-brand-800' : 'bg-ink-50 dark:bg-ink-800/60 border-ink-100 dark:border-ink-800 hover:bg-ink-100 dark:hover:bg-ink-700'}`}
                               >
                                   <div className="flex justify-between items-center mb-1 gap-2">
                                       <span className="font-bold text-ink-700 dark:text-ink-200 truncate">{g.playerColor ? `vs ${displayPlayerName(opponentOf(g), t)}` : `${displayPlayerName(g.white, t)} – ${displayPlayerName(g.black, t)}`}</span>
                                       <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${OUTCOME_BADGE[outcome] ?? OUTCOME_BADGE.draw}`}>
                                           {g.result}
                                       </span>
                                   </div>
                                   <p className="text-xs text-ink-500 dark:text-ink-400 truncate">{shortDate(g.endTime, lang, t)} • {t(`speed.${g.speed ?? 'unknown'}`)}{g.opening ? ` • ${g.opening}` : ''}</p>
                               </div>
                               );
                           })}
                       </div>
                       )}

                       {/* Paginación */}
                       <div className="flex justify-between items-center mt-4 pt-4 border-t border-ink-100 dark:border-ink-800 flex-shrink-0">
                          <button
                            disabled={Math.min(currentPage, totalPages) === 1}
                            onClick={() => setCurrentPage(p => Math.min(p, totalPages) - 1)}
                            className="p-2 bg-transparent hover:bg-ink-100 dark:hover:bg-ink-700 rounded-lg disabled:opacity-30"
                          >
                             <ChevronLeft size={16}/>
                          </button>
                          <span className="text-xs font-bold text-ink-500 dark:text-ink-400">{t('analysis.page', { page: Math.min(currentPage, totalPages), total: totalPages })}</span>
                          <button
                            disabled={currentPage >= totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                            className="p-2 bg-transparent hover:bg-ink-100 dark:hover:bg-ink-700 rounded-lg disabled:opacity-30"
                          >
                             <ChevronRight size={16}/>
                          </button>
                       </div>
                   </div>
               )}
            </div>
          </div>
        )}

        {/* --- PESTAÑA PUZLES --- */}
        {activeTab === 'puzzles' && (
          <Suspense fallback={<ScreenLoading />}>
          <PuzzleTrainer
            initialTarget={puzzleTarget}
            engine={stockfish.engine}
            coachId={coach.prefs.coach}
            profile={profile}
            userRating={userRating}
            soundOn={soundOn}
            boardTheme={boardTheme}
            onBoardThemeChange={changeBoardTheme}
            isWide={isWide}
          />
          </Suspense>
        )}

        {/* --- PESTAÑA MIS PARTIDAS (importación) --- */}
        {activeTab === 'games' && (
          <Suspense fallback={<ScreenLoading />}>
          <MyGames
            games={gamesData}
            loading={gamesLoading}
            onOpenGame={(g) => {
              loadGame(g);
              setActiveTab('analysis');
            }}
          />
          </Suspense>
        )}

        {activeTab === 'progress' && (
          <Suspense fallback={<ScreenLoading />}>
          <ProgressPage
            onAction={followTrainingPlan}
            onPractice={() => setActiveTab('practice')}
            onImport={() => setActiveTab('games')}
            onAnalyze={() => setActiveTab('puzzles')}
            onPuzzles={() => setActiveTab('puzzles')}
          />
          </Suspense>
        )}

        {welcomeOpen && (
          <Suspense fallback={null}>
            <Welcome onStart={() => closeWelcome('practice')} onImport={() => closeWelcome('games')} onClose={dismissWelcome} />
          </Suspense>
        )}

        {editingAvatar && <Suspense fallback={null}><AvatarEditor profile={profile} onSave={saveProfile} onClose={() => setEditingAvatar(false)} /></Suspense>}

        {/* Aviso no bloqueante */}
        {notice && (
            <div
              role="status"
              aria-live="polite"
              className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-ink-900 text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-2xl"
            >
                <span>{notice}</span>
                <button
                  onClick={() => setNotice(null)}
                  aria-label={t('common.closeNotice')}
                  className="bg-transparent border-0 p-1 text-ink-400 hover:text-white"
                >
                    ✕
                </button>
            </div>
        )}


      </main>
    </div>
  );
};

export default App;
