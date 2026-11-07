// Bucle de partida contra el rival (T4, docs/COACH_DESIGN.md §1.2 y §3).
//
// El hook NO es dueño del tablero: App.jsx conserva la instancia de chess.js y aplica las
// jugadas (las del usuario y las del rival) con la misma función. Aquí vive el estado de la
// partida (color, nivel, pausa, resultado) y el efecto que pide la jugada al rival cuando le
// toca. Cualquier cambio de posición, pausa o bloqueo cancela la búsqueda en curso.
import { getT } from '../i18n/core.js';
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { sideToMove } from '../engine/uci.js';
import { isAbortError } from '../engine/engine.js';
import { DEFAULT_RIVAL_LEVEL, getRivalLevel } from '../engine/rivalLevels.js';

/** @typedef {'w'|'b'} Color */
/** @typedef {'w'|'b'|'random'} ColorChoice */
/** @typedef {'setup'|'playing'|'over'} LoopStatus */
/**
 * @typedef {{reason:'checkmate'|'stalemate'|'insufficient'|'threefold'|'fifty'|'draw'|'timeout'|'abandon',
 *   winner:Color|null}} GameResult
 */

const other = (color) => (color === 'w' ? 'b' : 'w');

/**
 * Resultado según chess.js (null si la partida sigue).
 * @param {import('chess.js').Chess} chess
 * @returns {GameResult|null}
 */
export function gameResultFromChess(chess) {
  if (chess.isCheckmate()) return { reason: 'checkmate', winner: other(chess.turn()) };
  if (chess.isStalemate()) return { reason: 'stalemate', winner: null };
  if (chess.isInsufficientMaterial()) return { reason: 'insufficient', winner: null };
  if (chess.isThreefoldRepetition()) return { reason: 'threefold', winner: null };
  if (chess.isDrawByFiftyMoves()) return { reason: 'fifty', winner: null };
  if (chess.isDraw()) return { reason: 'draw', winner: null };
  return null;
}

/**
 * Derrota por tiempo del bando `flagged`.
 * (Simplificación: no se comprueba si el rival tiene material para dar mate.)
 * @param {Color} flagged
 * @returns {GameResult}
 */
export function timeoutResult(flagged) {
  return { reason: 'timeout', winner: other(flagged) };
}

/**
 * Derrota por abandono del bando `color` (botón Abandonar o más de 30 s fuera de Entrenar).
 * @param {Color} color
 * @returns {GameResult}
 */
export function abandonResult(color) {
  return { reason: 'abandon', winner: other(color) };
}

/** Resultados que Deshacer no revierte (tiempo y abandono). */
export function isFinalResult(result) {
  return result?.reason === 'timeout' || result?.reason === 'abandon';
}

/**
 * Texto del resultado desde la perspectiva del jugador ("Jaque mate · Ganas tú (1-0)").
 * @param {GameResult} result
 * @param {Color} playerColor
 * @param {import('../i18n/core.js').TFunction} [t]  traductor (por defecto, español)
 */
export function resultText(result, playerColor, t = getT('es')) {
  if (!result) return '';
  const reasonKey = `result.reason.${result.reason}`;
  const reason = t(reasonKey) === reasonKey ? t('result.over') : t(reasonKey);
  if (!result.winner) return t('result.drawn', { reason });
  const score = result.winner === 'w' ? '1-0' : '0-1';
  return t('result.decisive', { reason, who: result.winner === playerColor ? t('result.youWin') : t('result.rivalWins'), score });
}

/**
 * Cuántos plies deshacer para volver a la posición anterior a la última jugada del usuario:
 * 2 si el rival ya respondió (su jugada + la tuya), 1 si aún no (o si tu jugada terminó la
 * partida), 0 si todavía no hiciste ninguna jugada.
 * @param {{color:Color}[]} verboseHistory  game.history({verbose:true})
 * @param {Color} playerColor
 */
export function pliesToUndo(verboseHistory, playerColor) {
  for (let i = verboseHistory.length - 1; i >= 0; i--) {
    if (verboseHistory[i].color === playerColor) return verboseHistory.length - i;
  }
  return 0;
}

/**
 * @param {object} params
 * @param {{level:number|null, newGame:(level:number)=>Promise<void>,
 *   chooseMove:(fen:string, opts?:{signal?:AbortSignal})=>Promise<import('../engine/rival.js').RivalMove|null>}} params.rival
 *        RivalEngine (o el objeto `rival` de useRivalEngine)
 * @param {string|null} params.fen   posición actual del tablero
 * @param {boolean} [params.enabled=true]  false fuera de la pestaña Entrenar
 * @param {boolean} [params.blocked=false] true si el rival NO debe mover ahora (revisión,
 *        navegando el historial, partida terminada según chess.js...)
 * @param {(move: import('../engine/rival.js').RivalMove) => void} params.onRivalMove
 *        aplica la jugada del rival; recibe `move.fen` para descartar respuestas viejas
 * @param {() => number} [params.random=Math.random]  sorteo del color "aleatorio"
 */
export function useGameLoop({ rival, fen, enabled = true, blocked = false, onRivalMove, random = Math.random }) {
  const [colorChoice, setColorChoice] = useState(/** @type {ColorChoice} */ ('w'));
  const [level, setLevelState] = useState(DEFAULT_RIVAL_LEVEL);
  const [session, setSession] = useState({
    status: /** @type {LoopStatus} */ ('setup'),
    playerColor: /** @type {Color} */ ('w'),
    level: DEFAULT_RIVAL_LEVEL,
    paused: false,
    result: /** @type {GameResult|null} */ (null),
    id: 0,
  });
  const [rivalError, setRivalError] = useState(null);

  const onRivalMoveRef = useRef(onRivalMove);
  useLayoutEffect(() => {
    onRivalMoveRef.current = onRivalMove;
  });

  const { status, playerColor, paused } = session;
  const rivalColor = other(playerColor);
  const turn = fen ? sideToMove(fen) : null;
  const isRivalTurn = status === 'playing' && turn === rivalColor;
  const rivalThinking = enabled && isRivalTurn && !paused && !blocked;
  const isPlayerTurn = status === 'playing' && turn === playerColor && !paused;

  const sessionLevel = session.level;
  useEffect(() => {
    if (!rivalThinking) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    // Tras reiniciarse el worker (p. ej. al cambiar de pestaña) el rival pierde el nivel.
    const ready = rival.level === sessionLevel ? Promise.resolve() : rival.newGame(sessionLevel);
    ready
      .then(() => rival.chooseMove(fen, { signal }))
      .then((move) => {
        if (move && !signal.aborted) onRivalMoveRef.current?.(move);
      })
      .catch((err) => {
        if (isAbortError(err) || signal.aborted) return;
        console.error('Error del rival:', err);
        setRivalError(err?.message ?? String(err));
      });
    return () => controller.abort();
  }, [rivalThinking, rival, fen, sessionLevel]);

  /** Cambia el nivel para la PRÓXIMA partida (no durante una). */
  const setLevel = useCallback((next) => {
    getRivalLevel(next); // valida
    setLevelState(next);
  }, []);

  /**
   * Empieza una partida con el color y nivel elegidos. Devuelve el color del usuario.
   * El llamador debe dejar el tablero en la posición inicial.
   * @param {Color} [forcedColor]  color del usuario, en vez de la elección (p. ej. al empezar
   *        desde un FEN en las pruebas); cualquier otro valor se ignora
   * @returns {Color}
   */
  const startGame = useCallback((forcedColor) => {
    const chosen = forcedColor === 'w' || forcedColor === 'b' ? forcedColor : colorChoice;
    const color = chosen === 'random' ? (random() < 0.5 ? 'w' : 'b') : chosen;
    setSession((s) => ({ status: 'playing', playerColor: color, level, paused: false, result: null, id: s.id + 1 }));
    setRivalError(null);
    rival.newGame(level).catch((err) => {
      if (!isAbortError(err)) setRivalError(err?.message ?? String(err));
    });
    return color;
  }, [colorChoice, level, random, rival]);

  /** Termina la partida en curso con un resultado (mate, tablas, tiempo). */
  const endGame = useCallback((result) => {
    setSession((s) => (s.status === 'playing' ? { ...s, status: 'over', paused: false, result } : s));
  }, []);

  /** Tras deshacer: una partida terminada por mate/tablas vuelve a estar en juego. */
  const resumeAfterUndo = useCallback(() => {
    setSession((s) =>
      s.status === 'over' && !isFinalResult(s.result) ? { ...s, status: 'playing', result: null } : s,
    );
  }, []);

  const setPaused = useCallback((value) => {
    setSession((s) => {
      if (s.status !== 'playing') return s;
      const next = typeof value === 'function' ? value(s.paused) : Boolean(value);
      return next === s.paused ? s : { ...s, paused: next };
    });
  }, []);

  /** Vuelve a la configuración (sin partida en curso). */
  const reset = useCallback(() => {
    setSession((s) => (s.status === 'setup' ? s : { ...s, status: 'setup', paused: false, result: null }));
    setRivalError(null);
  }, []);

  return {
    // Configuración para la próxima partida
    colorChoice,
    setColorChoice,
    level,
    setLevel,
    // Partida en curso
    status,
    gameId: session.id,
    playerColor,
    rivalColor,
    activeLevel: session.level,
    paused,
    result: session.result,
    isPlayerTurn,
    isRivalTurn,
    rivalThinking,
    rivalError,
    // Acciones
    startGame,
    endGame,
    resumeAfterUndo,
    setPaused,
    reset,
  };
}
