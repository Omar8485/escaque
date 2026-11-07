// Utilidades puras para el protocolo UCI de Stockfish (sin React ni Worker).
//
// Convención de puntuaciones en toda la app (objeto `Score`):
//   { type: 'cp',   value: <centipeones> }                      // siempre perspectiva de BLANCAS
//   { type: 'mate', value: <jugadas a mate>, winner: 'w'|'b' }   // value > 0: mate de blancas,
//                                                                // value < 0: mate de negras,
//                                                                // value = 0: posición ya mateada
// UCI entrega `score` desde el lado que mueve; `toWhitePerspective` lo normaliza.

/**
 * @typedef {{type:'cp', value:number} | {type:'mate', value:number, winner:'w'|'b'}} Score
 */

/** Coeficiente del modelo de Lichess para convertir centipeones a probabilidad de ganar. */
export const WIN_COEFFICIENT = -0.00368208;
/** Límite de centipeones que usa Lichess antes de aplicar la sigmoide. */
export const CP_CEILING = 1000;

const INT_FIELDS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull', 'tbhits']);

/**
 * Parsea una línea `info ... score ...` de UCI.
 * Devuelve null para líneas que no son `info` o que no traen `score`
 * (p. ej. `info string ...` o `info depth N currmove ...`).
 * La puntuación devuelta es la CRUDA de UCI (perspectiva del lado que mueve).
 *
 * @param {string} line
 * @returns {null | {depth:number, seldepth:number|null, multipv:number, nodes:number|null,
 *   nps:number|null, time:number|null, score:{type:'cp'|'mate', value:number},
 *   bound:'lower'|'upper'|null, wdl:[number,number,number]|null, pv:string[]}}
 */
export function parseInfo(line) {
  if (typeof line !== 'string') return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info' || tokens[1] === 'string') return null;

  const info = {
    depth: null,
    seldepth: null,
    multipv: 1,
    nodes: null,
    nps: null,
    time: null,
    score: null,
    bound: null,
    wdl: null,
    pv: [],
  };

  for (let i = 1; i < tokens.length; i++) {
    const key = tokens[i];
    if (INT_FIELDS.has(key)) {
      const n = Number.parseInt(tokens[i + 1], 10);
      if (Number.isFinite(n) && key in info) info[key] = n;
      i += 1;
    } else if (key === 'score') {
      const type = tokens[i + 1];
      const value = Number.parseInt(tokens[i + 2], 10);
      if ((type === 'cp' || type === 'mate') && Number.isFinite(value)) {
        info.score = { type, value };
      }
      i += 2;
    } else if (key === 'lowerbound') {
      info.bound = 'lower';
    } else if (key === 'upperbound') {
      info.bound = 'upper';
    } else if (key === 'wdl') {
      info.wdl = tokens.slice(i + 1, i + 4).map((t) => Number.parseInt(t, 10));
      i += 3;
    } else if (key === 'pv') {
      // `pv` siempre es el último campo de la línea.
      info.pv = tokens.slice(i + 1);
      break;
    } else if (key === 'currmove' || key === 'currmovenumber' || key === 'cpuload' || key === 'refutation' || key === 'currline') {
      i += 1;
    }
  }

  if (info.depth === null || info.score === null) return null;
  return info;
}

/**
 * Parsea `bestmove e2e4 [ponder e7e5]`. `bestmove (none)` (sin jugadas legales) → bestMove null.
 * @param {string} line
 * @returns {null | {bestMove: string|null, ponder: string|null}}
 */
export function parseBestMove(line) {
  if (typeof line !== 'string') return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'bestmove') return null;
  const move = tokens[1];
  const bestMove = move && move !== '(none)' && move !== '0000' ? move : null;
  const ponderIdx = tokens.indexOf('ponder');
  const ponder = ponderIdx > 0 && tokens[ponderIdx + 1] ? tokens[ponderIdx + 1] : null;
  return { bestMove, ponder };
}

/** Lado que mueve según el FEN ('w' | 'b'). */
export function sideToMove(fen) {
  const field = typeof fen === 'string' ? fen.trim().split(/\s+/)[1] : undefined;
  if (field !== 'w' && field !== 'b') throw new Error(`FEN inválido (turno): ${fen}`);
  return field;
}

/**
 * Convierte una puntuación UCI (perspectiva del lado que mueve) a perspectiva de blancas.
 * @param {{type:'cp'|'mate', value:number}} score
 * @param {'w'|'b'} turn  lado que mueve en la posición analizada
 * @returns {Score}
 */
export function toWhitePerspective(score, turn) {
  if (!score) return null;
  if (turn !== 'w' && turn !== 'b') throw new Error(`Turno inválido: ${turn}`);
  const sign = turn === 'w' ? 1 : -1;
  // `|| 0` evita -0 (p. ej. `cp 0` con negras al turno).
  const value = score.value * sign || 0;
  if (score.type === 'cp') return { type: 'cp', value };
  // mate 0: el lado que mueve está mateado → gana el otro.
  let winner;
  if (value > 0) winner = 'w';
  else if (value < 0) winner = 'b';
  else winner = turn === 'w' ? 'b' : 'w';
  return { type: 'mate', value, winner };
}

/**
 * Probabilidad de ganar de BLANCAS (0–100) según el modelo de Lichess.
 * cp acotado a ±1000; mate → 100 o 0 según el ganador.
 */
export function winPercent(score) {
  if (!score) return 50;
  if (score.type === 'mate') return score.winner === 'w' ? 100 : 0;
  const cp = Math.max(-CP_CEILING, Math.min(CP_CEILING, score.value));
  return 50 + 50 * (2 / (1 + Math.exp(WIN_COEFFICIENT * cp)) - 1);
}

/** Probabilidad de ganar (0–100) desde la perspectiva de `color` ('w' | 'b'). */
export function winPercentFor(score, color) {
  const white = winPercent(score);
  return color === 'w' ? white : 100 - white;
}

/**
 * Formato para la UI (perspectiva de blancas): "+0.35", "-1.20", "0.00", "M3", "-M2".
 * Una posición ya mateada se muestra como resultado: "1-0" / "0-1".
 */
export function formatScore(score) {
  if (!score) return '';
  if (score.type === 'mate') {
    if (score.value === 0) return score.winner === 'w' ? '1-0' : '0-1';
    return score.value > 0 ? `M${score.value}` : `-M${-score.value}`;
  }
  const pawns = (score.value / 100).toFixed(2);
  return score.value > 0 ? `+${pawns}` : pawns;
}

/** true si la puntuación es de mate (incluida la posición ya mateada). */
export function isMateScore(score) {
  return Boolean(score) && score.type === 'mate';
}
