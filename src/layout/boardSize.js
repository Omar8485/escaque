// Tamaño del tablero en móvil (contrato de la ronda M, diseño móvil interno §3). Lógica pura.
// En escritorio sigue mandando src/utils/boardLayout.js (ChessBoard): esto es para las pantallas
// móviles, donde el tablero va a todo el ancho y lo demás se apila arriba y abajo.

/** Margen horizontal total (px) que se deja al tablero respecto al ancho disponible. */
export const BOARD_MARGIN = 8;
/** Lado mínimo (px): por debajo el tablero no se encoge más (la pantalla se desplaza). */
export const MIN_BOARD_SIDE = 160;

/**
 * Suma lo reservado en vertical: un número o una lista de alturas (barras de jugador, línea del
 * coach, controles, barra inferior…). Ignora valores no numéricos o negativos.
 * @param {number | Array<number | null | undefined | false>} reserved
 * @returns {number}
 */
export function sumReserved(reserved) {
  const list = Array.isArray(reserved) ? reserved : [reserved];
  return list.reduce((acc, v) => acc + (Number.isFinite(v) && v > 0 ? v : 0), 0);
}

/**
 * El mayor cuadrado que cabe en el ancho (menos `margin`) y en el alto menos lo reservado.
 * @param {object} p
 * @param {number} p.width     ancho disponible (px), normalmente el del viewport o del contenedor
 * @param {number} p.height    alto disponible (px)
 * @param {number | Array<number | null | undefined | false>} [p.reserved=0]  alto que necesitan los demás elementos
 * @param {number} [p.margin=BOARD_MARGIN]  margen horizontal total
 * @param {number} [p.min=MIN_BOARD_SIDE]   lado mínimo
 * @returns {number} lado del tablero en px (entero)
 */
export function boardSizeFor({ width, height, reserved = 0, margin = BOARD_MARGIN, min = MIN_BOARD_SIDE }) {
  const w = (Number.isFinite(width) ? width : 0) - (Number.isFinite(margin) ? margin : 0);
  const h = (Number.isFinite(height) ? height : 0) - sumReserved(reserved);
  const side = Math.floor(Math.min(w, h));
  return Math.max(Number.isFinite(min) ? min : 0, side);
}
