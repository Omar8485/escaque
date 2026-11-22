// Jugar en móvil (ronda M, tarea M1; diseño móvil interno). Lógica pura: disposición y qué muestra la
// línea del coach bajo el tablero. La interfaz está en MobilePlay.jsx.
import { boardSizeFor } from '../layout/boardSize.js';
import { PLAYER_BAR_HEIGHT, PLAYER_BAR_GAP } from '../utils/boardLayout.js';

/** Alto de la línea del coach (avatar + 2 líneas de texto + botón de pista). */
export const COACH_LINE_H = 56;
/** Alto de la fila de controles (botones de 44 px). */
export const CONTROLS_H = 44;
/** Separación vertical entre bloques. */
export const STACK_GAP = 8;
/** Horizontal: ancho mínimo de la columna derecha (barras, coach, controles, tarjeta). */
export const LANDSCAPE_COLUMN_MIN = 260;

/**
 * true si el coach detiene la partida y espera Retroceder / ¿Por qué? / Seguir.
 * @param {{view: {state: string}, interrupting: boolean}} coach
 */
export const coachAwaitsDecision = (coach) =>
  Boolean(coach?.interrupting) && (coach.view?.state === 'feedback' || coach.view?.state === 'thinking');

/**
 * Disposición de Jugar en móvil para el espacio disponible del contenedor.
 *  - 'portrait': barra del rival, tablero a todo el ancho, tu barra, línea del coach y controles.
 *  - 'landscape': tablero a la izquierda ocupando el alto; a la derecha barras, coach y controles.
 * @param {{width: number, height: number, landscape: boolean}} p  ancho y alto libres (px)
 * @returns {{mode: 'portrait'|'landscape', side: number, columnWidth: number}}
 */
export function mobilePlayLayout({ width, height, landscape }) {
  if (!landscape) {
    const reserved = [2 * (PLAYER_BAR_HEIGHT + PLAYER_BAR_GAP), STACK_GAP + COACH_LINE_H, STACK_GAP + CONTROLS_H];
    return { mode: 'portrait', side: boardSizeFor({ width, height, reserved }), columnWidth: width };
  }
  const side = boardSizeFor({ width: width - LANDSCAPE_COLUMN_MIN - STACK_GAP, height, margin: 0 });
  return { mode: 'landscape', side, columnWidth: Math.max(0, Math.floor(width - side - STACK_GAP)) };
}

/**
 * Qué muestra la línea del coach (resumen de una línea; el detalle está en la hoja del coach).
 * @param {object} p
 * @param {object} p.coach         estado de useCoach (view, hint, interrupting, active)
 * @param {boolean} p.isPlayerTurn
 * @returns {{kind: 'decide'|'hint'|'feedback'|'analyzing'|'thinking'|'error'|'idle'|'off', text?: string, san?: string, label?: string, greatMove?: boolean, tone?: string}}
 */
export function coachLine({ coach, isPlayerTurn }) {
  const view = coach?.view ?? { state: 'off' };
  if (coachAwaitsDecision(coach)) return { kind: 'decide', san: view.moveSan, label: view.label, text: view.state === 'feedback' ? view.text : undefined };
  const hint = coach?.hint;
  if (coach?.active && isPlayerTurn && hint && (hint.text || hint.thinking)) return { kind: 'hint', text: hint.thinking ? undefined : hint.text };
  switch (view.state) {
    case 'feedback':
      return { kind: 'feedback', text: view.text, san: view.moveSan, label: view.label, greatMove: Boolean(view.greatMove), tone: view.tone };
    case 'analyzing':
      return { kind: 'analyzing', san: view.moveSan };
    case 'thinking':
      return { kind: 'thinking', san: view.moveSan, label: view.label };
    case 'error':
      return { kind: 'error', text: view.text };
    case 'idle':
      return { kind: 'idle' };
    default:
      return { kind: coach?.active === false || view.state === 'off' ? 'off' : 'idle' };
  }
}
