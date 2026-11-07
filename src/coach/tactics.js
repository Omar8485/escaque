// Hechos tácticos con chess.js (diseño §4.3): detalles de la jugada, refutación con su
// motivo y objetivos, piezas colgadas, piezas sueltas del rival, hechos de pista y las
// listas `allowedMoves` / `allowedSquares` que usa la validación del backend.
// Funciones puras: reciben FEN y análisis ya terminados (perspectiva de blancas, ver uci.js).
import { Chess } from 'chess.js';
import { uciToSan } from '../engine/classify.js';
import { PIECE_VALUES } from './phase.js';
import { lineSans, lineSquares } from './refutationLine.js';

/**
 * @typedef {import('../engine/uci.js').Score} Score
 * @typedef {{multipv:number, score:Score, pv:string[]}} AnalysisLine
 * @typedef {{lines: AnalysisLine[], bestMove?: string|null}} Analysis
 * @typedef {'p'|'n'|'b'|'r'|'q'|'k'} PieceType
 * @typedef {'mate'|'jaque_y_ataque'|'ataque_doble'|'captura'} Motif
 * @typedef {{square:string, piece:PieceType, defended:boolean}} Target
 * @typedef {{square:string, piece:PieceType, defended:boolean, confirmedByEngine:boolean}} HangingPiece
 * @typedef {{square:string, piece:PieceType}} LoosePiece
 * @typedef {{san:string, piece:PieceType, to:string, check:boolean, captures:PieceType|null,
 *   motif:Motif|null, mateIn:number|null, targets:Target[]}} Refutation
 * @typedef {{motif:Motif|null, bestPiece:PieceType|null, bestFrom:string|null}} HintFacts
 */

/** Plies de la PV del rival en los que una captura confirma una pieza colgada. */
export const HANGING_CONFIRM_PLIES = 3;
/** Plies de `pvSan` que se revelan (y se permiten) cuando `revealBestMove` es true. */
export const REVEALED_PV_PLIES = 4;

const opponent = (color) => (color === 'w' ? 'b' : 'w');
/** Valor para comparar atacantes: el rey "vale" infinito (no puede cambiarse por nada). */
const attackValue = (type) => (type === 'k' ? Infinity : PIECE_VALUES[type]);

function parseUci(uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

/** Aplica una jugada UCI sobre `chess` (mutándolo). Devuelve el Move de chess.js o null si es ilegal. */
function playUci(chess, uci) {
  const move = parseUci(uci);
  if (!move) return null;
  try {
    return chess.move(move);
  } catch {
    return null;
  }
}

/** Casillas con piezas de `color` (sin el rey), en orden del tablero (a8 → h1). */
function piecesOf(chess, color) {
  const out = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.color === color && sq.type !== 'k') out.push(sq);
    }
  }
  return out;
}

const firstLine = (analysis) =>
  [...(analysis?.lines ?? [])].sort((a, b) => a.multipv - b.multipv)[0] ?? null;

// ---------- Jugadas ----------

/**
 * Descripción completa de una jugada UCI desde `fen` (null si es ilegal).
 * @param {string} fen
 * @param {string} uci
 * @returns {{san:string, color:'w'|'b', piece:PieceType, from:string, to:string,
 *   capture:PieceType|null, check:boolean, mate:boolean, castle:boolean,
 *   promotion:PieceType|null} | null}
 */
export function describeMove(fen, uci) {
  const move = playUci(new Chess(fen), uci);
  if (!move) return null;
  return {
    san: move.san,
    color: move.color,
    piece: move.piece,
    from: move.from,
    to: move.to,
    capture: move.captured ?? null,
    check: /[+#]$/.test(move.san),
    mate: move.san.endsWith('#'),
    castle: move.flags.includes('k') || move.flags.includes('q'),
    promotion: move.promotion ?? null,
  };
}

/**
 * Bloque `moveDetails` del contrato (§4.3) para la jugada del jugador.
 * @returns {{piece:PieceType, from:string, to:string, capture:PieceType|null, check:boolean,
 *   castle:boolean, promotion:PieceType|null} | null}
 */
export function moveDetails(fen, uci) {
  const d = describeMove(fen, uci);
  if (!d) return null;
  const { piece, from, to, capture, check, castle, promotion } = d;
  return { piece, from, to, capture, check, castle, promotion };
}

/**
 * Bloque `lastRivalMove` del contrato (§4.3). `fen` es la posición ANTES de la jugada del rival.
 * @returns {{san:string, piece:PieceType, to:string, capture:PieceType|null} | null}
 */
export function rivalMoveFacts(fen, uci) {
  const d = describeMove(fen, uci);
  if (!d) return null;
  return { san: d.san, piece: d.piece, to: d.to, capture: d.capture };
}

// ---------- Ataques ----------

/**
 * Piezas del bando contrario (sin el rey) que ataca la pieza situada en `square`, con
 * `defended` = tiene al menos un defensor propio. Solo las relevantes: sin defensa o de
 * más valor que la atacante. Orden del tablero (a8 → h1).
 * @param {Chess} chess  posición ya jugada
 * @param {string} square  casilla de la pieza atacante
 * @returns {Target[]}
 */
export function attackedTargets(chess, square) {
  const attacker = chess.get(square);
  if (!attacker) return [];
  const victimColor = opponent(attacker.color);
  const value = attackValue(attacker.type);
  const targets = [];
  for (const sq of piecesOf(chess, victimColor)) {
    if (!chess.attackers(sq.square, attacker.color).includes(square)) continue;
    const defended = chess.attackers(sq.square, victimColor).length > 0;
    if (!defended || PIECE_VALUES[sq.type] > value) {
      targets.push({ square: sq.square, piece: sq.type, defended });
    }
  }
  return targets;
}

/**
 * Motivo táctico de una jugada (§4.3, `refutation.motif`), en este orden:
 * 1. `mate` si la línea del motor es mate a favor de quien mueve;
 * 2. `jaque_y_ataque` si da jaque y la pieza que movió ataca una pieza sin defensa;
 * 3. `ataque_doble` si la pieza que movió ataca ≥ 2 objetivos relevantes (sin defensa o de
 *    más valor que ella); el rey en jaque cuenta como uno de ellos;
 * 4. `captura` si captura; si no, null.
 *
 * @param {string} fen  posición antes de la jugada
 * @param {string} uci
 * @param {{score?: Score|null}} [opts]  evaluación de la línea que empieza con esta jugada
 * @returns {{motif: Motif|null, targets: Target[], check: boolean, capture: PieceType|null,
 *   san: string, piece: PieceType, from: string, to: string} | null}  null si la jugada es ilegal
 */
export function moveMotif(fen, uci, { score = null } = {}) {
  const chess = new Chess(fen);
  const move = playUci(chess, uci);
  if (!move) return null;
  const check = chess.inCheck();
  const targets = attackedTargets(chess, move.to);
  const capture = move.captured ?? null;

  let motif = null;
  if (score?.type === 'mate' && score.winner === move.color) motif = 'mate';
  else if (check && targets.some((t) => !t.defended)) motif = 'jaque_y_ataque';
  else if (targets.length + (check ? 1 : 0) >= 2) motif = 'ataque_doble';
  else if (capture) motif = 'captura';

  return { motif, targets, check, capture, san: move.san, piece: move.piece, from: move.from, to: move.to };
}

// ---------- Refutación ----------

/**
 * Bloque `refutation` (§4.3): la mejor respuesta del rival según el análisis de `fenAfter`.
 * @param {{fenAfter: string, after: Analysis}} params
 * @returns {Refutation|null}  null si no hay PV (p. ej. el jugador dio mate o ahogado)
 */
export function refutationFacts({ fenAfter, after }) {
  const line = firstLine(after);
  const uci = after?.bestMove ?? line?.pv?.[0] ?? null;
  if (!uci) return null;
  // El score de lines[0] corresponde a la PV que empieza por bestMove.
  const score = line?.pv?.[0] === uci ? line.score : null;
  const m = moveMotif(fenAfter, uci, { score });
  if (!m) return null;
  const rival = new Chess(fenAfter).turn();
  const mateIn = score?.type === 'mate' && score.winner === rival ? Math.abs(score.value) : null;
  return {
    san: uciToSan(fenAfter, uci),
    piece: m.piece,
    to: m.to,
    check: m.check,
    captures: m.capture,
    motif: m.motif,
    mateIn,
    targets: m.targets,
  };
}

// ---------- Piezas colgadas y sueltas ----------

/** Casilla de una captura (al paso: el peón capturado no está en `to`). */
function capturedSquare(move) {
  if (!move.captured) return null;
  return move.flags.includes('e') ? move.to[0] + move.from[1] : move.to;
}

/** true si la PV (desde `fen`, mueve el rival) captura la pieza de `square` en sus primeros plies. */
function pvCaptures(fen, pv, square, plies = HANGING_CONFIRM_PLIES) {
  const chess = new Chess(fen);
  let sq = square;
  for (let i = 0; i < Math.min(plies, pv?.length ?? 0); i++) {
    const move = playUci(chess, pv[i]);
    if (!move) return false;
    if (i % 2 === 0) {
      if (capturedSquare(move) === sq) return true;
    } else if (move.from === sq) {
      sq = move.to; // la pieza del jugador se movió
    }
  }
  return false;
}

/**
 * Piezas colgadas del jugador tras su jugada (§4.3, `hanging[]`): pieza (no rey) atacada por
 * el rival y (sin defensores o atacada por una pieza de menor valor).
 * `confirmedByEngine` = la PV del rival la captura en sus HANGING_CONFIRM_PLIES primeros plies.
 *
 * @param {{fenAfter: string, after?: Analysis|null}} params  `fenAfter`: juega el rival
 * @returns {HangingPiece[]}
 */
export function hangingPieces({ fenAfter, after = null }) {
  const chess = new Chess(fenAfter);
  const rival = chess.turn();
  const player = opponent(rival);
  const pv = firstLine(after)?.pv ?? [];
  const out = [];
  for (const sq of piecesOf(chess, player)) {
    const attackers = chess.attackers(sq.square, rival);
    if (!attackers.length) continue;
    const defended = chess.attackers(sq.square, player).length > 0;
    const cheapest = Math.min(...attackers.map((a) => attackValue(chess.get(a).type)));
    if (defended && cheapest >= PIECE_VALUES[sq.type]) continue;
    out.push({
      square: sq.square,
      piece: sq.type,
      defended,
      confirmedByEngine: pvCaptures(fenAfter, pv, sq.square),
    });
  }
  return out;
}

/**
 * Piezas sueltas del rival (§4.3, `opponentLoose[]`, para pistas): sin defensores y fuera de
 * sus dos primeras filas. Sin el rey. Orden del tablero (a8 → h1).
 * @param {string} fen
 * @param {'w'|'b'} color  color del JUGADOR
 * @returns {LoosePiece[]}
 */
export function opponentLoose(fen, color) {
  const chess = new Chess(fen);
  const rival = opponent(color);
  const homeRanks = rival === 'w' ? ['1', '2'] : ['7', '8'];
  return piecesOf(chess, rival)
    .filter((sq) => !homeRanks.includes(sq.square[1]))
    .filter((sq) => chess.attackers(sq.square, rival).length === 0)
    .map((sq) => ({ square: sq.square, piece: sq.type }));
}

// ---------- Pistas ----------

/**
 * Bloque `hintFacts` (§4.3) para el turno del jugador en `fen`, a partir de la mejor línea.
 * Nivel 1: solo `motif`; nivel ≥ 2: además `bestPiece` y `bestFrom` (el nivel 3 es la flecha).
 * @param {{fen: string, before: Analysis, hintLevel: 1|2|3|null}} params
 * @returns {HintFacts|null}
 */
export function hintFacts({ fen, before, hintLevel }) {
  if (!hintLevel) return null;
  const line = firstLine(before);
  const uci = before?.bestMove ?? line?.pv?.[0] ?? null;
  if (!uci) return null;
  const score = line?.pv?.[0] === uci ? line.score : null;
  const m = moveMotif(fen, uci, { score });
  if (!m) return null;
  const reveal = hintLevel >= 2;
  return { motif: m.motif, bestPiece: reveal ? m.piece : null, bestFrom: reveal ? m.from : null };
}

// ---------- Listas permitidas ----------

/** Casillas from/to de una línea en SAN desde `fen` (se detiene en la primera ilegal). */
function sanLineSquares(fen, sans) {
  const chess = new Chess(fen);
  const out = [];
  for (const san of sans) {
    try {
      const move = chess.move(san);
      out.push(move.from, move.to);
    } catch {
      break;
    }
  }
  return out;
}

/**
 * `allowedMoves` y `allowedSquares` (§4.3). Orden estable y sin duplicados:
 * - Jugadas: `lastRivalMove.san`, `classification.moveSan`, `refutation.san`, las de la línea de
 *   refutación si viaja (v1.1) y, solo si `revealBestMove`, `bestMoveSan` y los primeros
 *   REVEALED_PV_PLIES de `pvSan`.
 * - Casillas: destino de `lastRivalMove`, origen y destino de la jugada del jugador, destino
 *   de la refutación, origen y destino de la línea revelada, `refutation.targets`, `hanging`
 *   confirmadas por el motor, `opponentLoose` y `hintFacts.bestFrom`.
 *   De la jugada del rival y de la refutación solo se permite el destino (su `from` no viaja
 *   en el contrato).
 *
 * @param {object} params
 * @param {{fenBefore:string, moveUci:string, moveSan:string|null, bestMoveSan?:string|null,
 *   pvSan?:string[]}|null} [params.classification]
 * @param {{san:string, to:string}|null} [params.lastRivalMove]
 * @param {Refutation|null} [params.refutation]
 * @param {HangingPiece[]|null} [params.hanging]
 * @param {LoosePiece[]|null} [params.opponentLoose]
 * @param {HintFacts|null} [params.hintFacts]
 * @param {boolean} [params.revealBestMove]
 * @param {import('./refutationLine.js').RefutationLine|null} [params.line]  línea de refutación de
 *   "¿Por qué?" (v1.1): sus jugadas y casillas de origen/destino pasan a estar permitidas.
 * @returns {{allowedMoves: string[], allowedSquares: string[]}}
 */
export function allowedLists({
  line = null,
  classification = null,
  lastRivalMove = null,
  refutation = null,
  hanging = null,
  opponentLoose: loose = null,
  hintFacts: hint = null,
  revealBestMove = false,
}) {
  const moves = new Set();
  const squares = new Set();
  const addMove = (san) => san && moves.add(san);
  const addSquare = (sq) => sq && squares.add(sq);

  addMove(lastRivalMove?.san);
  addSquare(lastRivalMove?.to);

  if (classification) {
    addMove(classification.moveSan);
    addSquare(classification.moveUci?.slice(0, 2));
    addSquare(classification.moveUci?.slice(2, 4));
  }

  addMove(refutation?.san);
  addSquare(refutation?.to);

  if (revealBestMove && classification) {
    const line = (classification.pvSan ?? []).slice(0, REVEALED_PV_PLIES);
    const best = classification.bestMoveSan ?? null;
    addMove(best);
    line.forEach(addMove);
    // La PV empieza en la mejor jugada; si no coincidiera, se calculan las dos por separado.
    const lines = best && line[0] !== best ? [[best], line] : [line];
    for (const sans of lines) sanLineSquares(classification.fenBefore, sans).forEach(addSquare);
  }

  lineSans(line).forEach(addMove);
  lineSquares(line).forEach(addSquare);

  refutation?.targets?.forEach((t) => addSquare(t.square));
  hanging?.filter((h) => h.confirmedByEngine).forEach((h) => addSquare(h.square));
  loose?.forEach((p) => addSquare(p.square));
  addSquare(hint?.bestFrom);

  return { allowedMoves: [...moves], allowedSquares: [...squares] };
}
