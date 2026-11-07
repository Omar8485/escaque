// Línea de refutación para "¿Por qué?" (v1.1): la PV del rival tras tu jugada, de Stockfish
// (nunca del LLM), en SAN, cortada entre LINE_MIN_PLIES y LINE_MAX_PLIES en un punto tranquilo,
// con los hechos de lo que gana el rival (material, mate) calculados con chess.js.
// Funciones puras: reciben FEN y la PV en UCI ya calculadas.
import { Chess } from 'chess.js';
import { moveNumberOf, PIECE_VALUES } from './phase.js';

/** Plies mínimos que se intentan mostrar (si la PV es más corta, se alarga con el motor). */
export const LINE_MIN_PLIES = 4;
/** Plies máximos de la línea. */
export const LINE_MAX_PLIES = 8;

/**
 * @typedef {'p'|'n'|'b'|'r'|'q'|'k'} PieceType
 * @typedef {{uci:string, san:string, color:'w'|'b', piece:PieceType, from:string, to:string,
 *   captured:PieceType|null, check:boolean, mate:boolean}} LineMove
 * @typedef {{fen:string, startColor:'w'|'b', startMoveNumber:number, moves:LineMove[],
 *   mate:boolean, mateIn:number|null, materialSwing:number, playerLost:PieceType[],
 *   rivalLost:PieceType[]}} RefutationLine
 *   `fen`: posición tras tu jugada (mueve el rival). `materialSwing`: cambio del balance de
 *   material desde TU punto de vista al final de la línea (negativo = pierdes).
 */

const opponent = (c) => (c === 'w' ? 'b' : 'w');

function playUci(chess, uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/** Jugadas legales de la PV (se detiene en la primera ilegal o al acabar la partida). */
export function playLine(fen, pv = []) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv) {
    if (chess.isGameOver()) break;
    const m = playUci(chess, uci);
    if (!m) break;
    out.push({
      uci,
      san: m.san,
      color: m.color,
      piece: m.piece,
      from: m.from,
      to: m.to,
      captured: m.captured ?? null,
      check: /[+#]$/.test(m.san),
      mate: m.san.endsWith('#'),
    });
  }
  return out;
}

/**
 * Cuántos plies mostrar: entre min y max, terminando en un punto "tranquilo" (la jugada siguiente
 * de la PV no es una captura: así el balance de material no queda a mitad de un cambio).
 * Si hay mate dentro del máximo, hasta el mate.
 * @param {LineMove[]} moves
 */
export function cutPoint(moves, { min = LINE_MIN_PLIES, max = LINE_MAX_PLIES } = {}) {
  const mateAt = moves.findIndex((m) => m.mate);
  if (mateAt >= 0 && mateAt < max) return mateAt + 1;
  const hi = Math.min(max, moves.length);
  const lo = Math.min(min, hi);
  for (let k = hi; k >= lo; k--) {
    if (k === moves.length || !moves[k].captured) return k;
  }
  return hi;
}

function material(chess, color) {
  let total = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.color === color) total += PIECE_VALUES[sq.type];
  return total;
}

/**
 * Línea de refutación a partir de la PV del análisis de `fenAfter`.
 * @param {{fenAfter:string, pv:string[], score?:{type:'cp'|'mate', value:number, winner?:'w'|'b'}|null,
 *   min?:number, max?:number}} p
 * @returns {RefutationLine|null}  null si no hay PV jugable
 */
export function buildRefutationLine({ fenAfter, pv, score = null, min = LINE_MIN_PLIES, max = LINE_MAX_PLIES }) {
  const all = playLine(fenAfter, pv);
  if (!all.length) return null;
  const moves = all.slice(0, cutPoint(all, { min, max }));
  const start = new Chess(fenAfter);
  const rival = start.turn();
  const player = opponent(rival);
  const end = new Chess(fenAfter);
  moves.forEach((m) => end.move({ from: m.from, to: m.to, promotion: m.uci[4] }));
  const balance = (c) => material(c, player) - material(c, rival);
  const mate = Boolean(moves.at(-1)?.mate);
  const mateIn = score?.type === 'mate' && (score.winner ?? (score.value > 0 ? 'w' : 'b')) === rival ? Math.abs(score.value) : mate ? Math.ceil(moves.length / 2) : null;
  return {
    fen: fenAfter,
    startColor: rival,
    startMoveNumber: moveNumberOf(fenAfter),
    moves,
    mate,
    mateIn,
    materialSwing: balance(end) - balance(start),
    playerLost: moves.filter((m) => m.color === rival && m.captured).map((m) => m.captured),
    rivalLost: moves.filter((m) => m.color === player && m.captured).map((m) => m.captured),
  };
}

/** ¿Conviene alargar la PV con el motor? (más corta que el mínimo y sin terminar en mate). */
export function needsExtension(line, min = LINE_MIN_PLIES) {
  return Boolean(line) && line.moves.length < min && !line.mate && !new Chess(lineFens(line).at(-1)).isGameOver();
}

/** SAN de la línea. */
export const lineSans = (line) => (line?.moves ?? []).map((m) => m.san);

/**
 * Línea numerada: "4…Qg5 5.Nf3 Qxg2".
 * @param {RefutationLine} line
 * @param {(san:string) => string} [fmt]  formato de cada jugada (p. ej. figuras)
 */
export function formatLine(line, fmt = (s) => s) {
  return numberedMoves(line)
    .map(({ prefix, san }) => `${prefix}${fmt(san)}`)
    .join(' ');
}

/** Jugadas con su prefijo de número ("4…", "5.", "" ) para renderizarlas por separado. */
export function numberedMoves(line) {
  let n = line?.startMoveNumber ?? 1;
  let color = line?.startColor ?? 'w';
  return (line?.moves ?? []).map((m, i) => {
    const prefix = color === 'w' ? `${n}.` : i === 0 ? `${n}…` : '';
    if (color === 'b') n += 1;
    color = opponent(color);
    return { prefix, san: m.san, index: i };
  });
}

/** FEN tras cada ply: [posición inicial, tras la 1.ª, …]. */
export function lineFens(line) {
  const chess = new Chess(line.fen);
  const out = [chess.fen()];
  for (const m of line.moves) {
    chess.move({ from: m.from, to: m.to, promotion: m.uci[4] });
    out.push(chess.fen());
  }
  return out;
}

/** Une una línea corta con la continuación calculada desde su última posición. */
export function extendLine(line, extraPv, score = null) {
  return buildRefutationLine({ fenAfter: line.fen, pv: [...line.moves.map((m) => m.uci), ...extraPv], score });
}

/**
 * Bloque `refutationLine` del contrato (lo que viaja al LLM): SAN y hechos de la línea.
 * @param {RefutationLine|null} line
 */
export function lineContract(line) {
  if (!line) return null;
  return {
    san: lineSans(line),
    startMoveNumber: line.startMoveNumber,
    mate: line.mate,
    mateIn: line.mateIn,
    materialSwing: line.materialSwing,
    playerLost: line.playerLost,
    rivalLost: line.rivalLost,
  };
}

/** Casillas de origen y destino de la línea (para allowedSquares). */
export function lineSquares(line) {
  return (line?.moves ?? []).flatMap((m) => [m.from, m.to]);
}

/**
 * Lo que pierdes en neto: piezas que te capturan menos las que capturas (multiconjunto).
 * @returns {PieceType[]}  ordenado de mayor a menor valor
 */
export function netLoss(line) {
  const rest = [...(line?.rivalLost ?? [])];
  const net = [];
  for (const p of [...(line?.playerLost ?? [])].sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a])) {
    const i = rest.indexOf(p);
    if (i >= 0) rest.splice(i, 1);
    else net.push(p);
  }
  return net;
}
