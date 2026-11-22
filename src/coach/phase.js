// Hechos de la partida con chess.js: jugada (ply), fase y material (diseño §4.3).
// Funciones puras sobre FEN; sin React ni motor.
import { Chess } from 'chess.js';

/** Valor de las piezas en peones (el rey no cuenta como material). */
export const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });
/** Material sin peones de ambos bandos en la posición inicial. */
export const MAX_NON_PAWN_MATERIAL = 62;
/** Material sin peones a partir del cual (hacia abajo, incluido) es final. */
export const ENDGAME_MATERIAL = 26;
/** Material sin peones mínimo para seguir en la apertura. */
export const OPENING_MATERIAL = 54;
/** Última jugada (número de jugada completa) que puede ser apertura. */
export const OPENING_LAST_MOVE = 12;

/** @typedef {'apertura'|'medio juego'|'final'} GamePhase */

function fenFields(fen) {
  const fields = typeof fen === 'string' ? fen.trim().split(/\s+/) : [];
  if (fields.length < 2 || (fields[1] !== 'w' && fields[1] !== 'b')) throw new Error(`FEN inválido: ${fen}`);
  return fields;
}

/** Número de jugada completa del FEN (campo 6; 1 si falta). */
export function moveNumberOf(fen) {
  const n = Number.parseInt(fenFields(fen)[5], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Media jugada (1-based) que se juega desde `fen`, contando desde la posición inicial:
 * 1.e4 es el ply 1, 1…e5 el 2. Supone que la partida empezó con blancas en la jugada 1.
 */
export function plyOf(fen) {
  const turn = fenFields(fen)[1];
  return (moveNumberOf(fen) - 1) * 2 + (turn === 'w' ? 1 : 2);
}

/**
 * Material por color en peones.
 * @param {string} fen
 * @returns {{w: {total:number, nonPawn:number}, b: {total:number, nonPawn:number}}}
 */
export function material(fen) {
  const result = { w: { total: 0, nonPawn: 0 }, b: { total: 0, nonPawn: 0 } };
  for (const row of new Chess(fen).board()) {
    for (const sq of row) {
      if (!sq) continue;
      const value = PIECE_VALUES[sq.type];
      result[sq.color].total += value;
      if (sq.type !== 'p') result[sq.color].nonPawn += value;
    }
  }
  return result;
}

/** Material sin peones de ambos bandos (C=3, A=3, T=5, D=9; máx. 62). */
export function nonPawnMaterial(fen) {
  const m = material(fen);
  return m.w.nonPawn + m.b.nonPawn;
}

/** Material del jugador − material del rival, en peones. */
export function materialBalance(fen, color) {
  const m = material(fen);
  return color === 'w' ? m.w.total - m.b.total : m.b.total - m.w.total;
}

/**
 * Fase (§4.3): `final` si el material sin peones es ≤ 26; `apertura` si la jugada es ≤ 12
 * y el material sin peones ≥ 54; si no, `medio juego`.
 * @param {string} fen  posición cuyo material se mide
 * @param {number} [moveNumber]  número de jugada (por defecto, el del FEN)
 * @returns {GamePhase}
 */
export function gamePhase(fen, moveNumber = moveNumberOf(fen)) {
  const npm = nonPawnMaterial(fen);
  if (npm <= ENDGAME_MATERIAL) return 'final';
  if (moveNumber <= OPENING_LAST_MOVE && npm >= OPENING_MATERIAL) return 'apertura';
  return 'medio juego';
}

/**
 * Bloque `game` del contrato (sin `opening`, que viene de detectOpening()).
 * `ply` y `moveNumber` son los de la jugada comentada (o por jugar): se toman de `fenBefore`.
 * La fase y el balance se miden en `fenAfter` si existe (tras la jugada del jugador),
 * si no en `fenBefore` (petición de pista en el turno del jugador).
 *
 * @param {{fenBefore: string, fenAfter?: string|null, color: 'w'|'b'}} params
 * @returns {{ply:number, moveNumber:number, phase:GamePhase, materialBalance:number}}
 */
export function gameFacts({ fenBefore, fenAfter = null, color }) {
  const moveNumber = moveNumberOf(fenBefore);
  const fen = fenAfter ?? fenBefore;
  return {
    ply: plyOf(fenBefore),
    moveNumber,
    phase: gamePhase(fen, moveNumber),
    materialBalance: materialBalance(fen, color),
  };
}
