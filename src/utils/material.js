// Piezas capturadas y ventaja de material de cada bando (barras de jugador junto al tablero).
// Se deduce del FEN comparando con la dotación inicial: no necesita el historial.
import { material } from '../coach/phase.js';

const INITIAL = Object.freeze({ p: 8, n: 2, b: 2, r: 2, q: 1 });
/** Orden de presentación de las capturas (de menor a mayor valor, como en chess.com/lichess). */
const ORDER = ['p', 'n', 'b', 'r', 'q'];

function counts(fen) {
  const out = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  const placement = fen.split(' ')[0];
  for (const ch of placement) {
    const t = ch.toLowerCase();
    if (!(t in INITIAL)) continue;
    out[ch === t ? 'b' : 'w'][t] += 1;
  }
  return out;
}

/**
 * @param {string} fen
 * @returns {{w: {captured: string[], advantage: number}, b: {captured: string[], advantage: number}}}
 *   `captured`: tipos de pieza que ESE bando le capturó al rival (ordenados);
 *   `advantage`: puntos de material de ventaja (P=1, C=A=3, T=5, D=9), 0 si no va por delante.
 *   Una promoción cuenta como peón "desaparecido" del que corona y pieza extra (se compensa en la ventaja).
 */
export function materialSummary(fen) {
  const c = counts(fen);
  const capturedBy = (color) => {
    const victim = color === 'w' ? 'b' : 'w';
    return ORDER.flatMap((t) => Array(Math.max(0, INITIAL[t] - c[victim][t])).fill(t));
  };
  const m = material(fen);
  const diff = m.w.total - m.b.total;
  return {
    w: { captured: capturedBy('w'), advantage: Math.max(0, diff) },
    b: { captured: capturedBy('b'), advantage: Math.max(0, -diff) },
  };
}
