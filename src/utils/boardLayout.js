// Tamaño del tablero y posición de sus controles y barras de jugador (ChessBoard). Lógica pura.

// Medidas (px). MIN_SIDE: por debajo, la página se desplaza en vez de encoger más.
export const MIN_SIDE = 240;
export const ASIDE_WIDTH = 20;
export const GAP = 12;
export const STACKED_MAX_VH = 0.8;
// Controles en una columna estrecha al lado del tablero o en una fila debajo.
export const CONTROLS_SIDE_WIDTH = 104;
export const CONTROLS_BELOW_HEIGHT = 44;
export const CONTROLS_SIDE_MIN_HEIGHT = 260;
/** Alto de cada barra de jugador (encima/debajo del tablero) y separación con el tablero. */
export const PLAYER_BAR_HEIGHT = 32;
export const PLAYER_BAR_GAP = 6;
/** Columna lateral con barra del rival arriba, controles y tu barra abajo (estilo lichess). */
export const SIDE_COLUMN_WIDTH = 184;
export const SIDE_COLUMN_MIN_HEIGHT = 320;
/** La columna solo se usa si agranda el tablero al menos este factor (si no, barras arriba/abajo). */
export const PREFER_EDGES_FACTOR = 1.12;

/**
 * Tamaño del tablero y disposición para un espacio disponible.
 *  - controls: 'side' (columna estrecha) | 'below' (fila) | 'column' (columna con las barras)
 *  - bars: 'edges' (encima/debajo del tablero, estilo chess.com) | 'column' (a la derecha, estilo lichess)
 * @returns {{side: number, controls: 'side'|'below'|'column', bars: 'edges'|'column'}}
 */
export function boardLayout({ width, height, fitHeight, hasAside, viewportHeight, barsHeight = 0 }) {
  const asideW = hasAside ? ASIDE_WIDTH + GAP : 0;
  const clamp = (x) => Math.max(MIN_SIDE, Math.floor(x));
  if (!fitHeight) {
    return { side: clamp(Math.min(width - asideW, viewportHeight * STACKED_MAX_VH - barsHeight)), controls: 'below', bars: 'edges' };
  }
  const h = height - barsHeight;
  const below = Math.min(width - asideW, h - CONTROLS_BELOW_HEIGHT - GAP);
  const beside = Math.min(width - asideW - CONTROLS_SIDE_WIDTH - GAP, h);
  let best =
    beside > below && beside >= CONTROLS_SIDE_MIN_HEIGHT
      ? { side: beside, controls: 'side', bars: 'edges' }
      : { side: below, controls: 'below', bars: 'edges' };
  if (barsHeight > 0) {
    const column = Math.min(width - asideW - SIDE_COLUMN_WIDTH - GAP, height);
    if (column >= SIDE_COLUMN_MIN_HEIGHT && column > best.side * PREFER_EDGES_FACTOR) {
      best = { side: column, controls: 'column', bars: 'column' };
    }
  }
  return { ...best, side: clamp(best.side) };
}
