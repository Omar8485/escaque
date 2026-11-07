// Armado del CoachRequest (contrato v1, docs/COACH_DESIGN.md §4.3–§4.4).
// Funciones puras: reciben la jugada ya clasificada y los análisis TERMINADOS del motor y
// devuelven el JSON que viaja a /api/coach. Aquí se aplica la minimización (§4): lo que el
// LLM no debe revelar no se envía (FEN, UCI de la mejor jugada, mejor jugada sin permiso).
import { DEFAULT_COACH, PROMPT_VERSION, SCHEMA_VERSION } from '../../shared/coach-contract/index.js';
import { winPercentFor, sideToMove } from '../engine/uci.js';
import { coachFacts, evalLabel, shouldOfferTakeback } from './enrich.js';
import { gameFacts } from './phase.js';
import {
  allowedLists,
  hangingPieces,
  hintFacts,
  moveDetails,
  opponentLoose,
  refutationFacts,
  REVEALED_PV_PLIES,
} from './tactics.js';
import { lineContract } from './refutationLine.js';

/**
 * @typedef {ReturnType<typeof import('../engine/classify.js').classifyMove>} ClassifiedMove
 * @typedef {{lines: {multipv:number, score:object, pv:string[]}[], bestMove?: string|null}} Analysis
 * @typedef {{san:string, piece:string, to:string, capture:string|null}} RivalMoveFacts
 * @typedef {{color:'w'|'b', rating:number|null}} PlayerInfo  rating null si el usuario aún no importó partidas con Elo
 * @typedef {{level:number, label:string}} RivalInfo
 * @typedef {{name:string|null, inBook:boolean}} OpeningInfo
 * @typedef {{recentLabels:string[], repeatedMotif:string|null, takebacks:number, hintsUsed:number}} HistoryFacts
 * @typedef {{label:string, motif:string|null}} PlayedMoveRecord  jugada propia ya comentada
 */

/** Cantidad de etiquetas recientes que viajan en `history.recentLabels`. */
export const RECENT_LABELS = 5;
const BAD_LABELS = new Set(['Inaccuracy', 'Mistake', 'Blunder']);
const round1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);

/**
 * Bloque `history` (§4.3) a partir de las jugadas propias ya clasificadas de esta partida.
 * `repeatedMotif`: motivo de refutación que aparece ≥ 2 veces en jugadas imprecisas o peores
 * (el más reciente si hay varios).
 * @param {PlayedMoveRecord[]} moves  en orden de juego
 * @param {{takebacks?:number, hintsUsed?:number}} [counters]
 * @returns {HistoryFacts}
 */
export function historyFacts(moves = [], { takebacks = 0, hintsUsed = 0 } = {}) {
  const counts = new Map();
  let repeatedMotif = null;
  for (const m of moves) {
    if (!m.motif || !BAD_LABELS.has(m.label)) continue;
    const n = (counts.get(m.motif) ?? 0) + 1;
    counts.set(m.motif, n);
    if (n >= 2) repeatedMotif = m.motif;
  }
  return {
    recentLabels: moves.slice(-RECENT_LABELS).map((m) => m.label),
    repeatedMotif,
    takebacks,
    hintsUsed,
  };
}

/**
 * Bloque `classification` del contrato: la salida de classifyMove sin `fenBefore`, `fenAfter`
 * ni `bestMoveUci`; Win% redondeados a 1 decimal; mejor jugada y PV solo si se revelan.
 * @param {ClassifiedMove} c
 * @param {boolean} revealBestMove
 */
export function contractClassification(c, revealBestMove) {
  return {
    label: c.label,
    color: c.color,
    moveUci: c.moveUci,
    moveSan: c.moveSan,
    evalBefore: c.evalBefore,
    evalAfter: c.evalAfter,
    winBefore: round1(c.winBefore),
    winAfter: round1(c.winAfter),
    loss: round1(c.loss),
    isBest: c.isBest,
    bestMoveSan: revealBestMove ? c.bestMoveSan ?? null : null,
    pvSan: revealBestMove ? (c.pvSan ?? []).slice(0, REVEALED_PV_PLIES) : null,
    depthBefore: c.depthBefore ?? null,
    depthAfter: c.depthAfter ?? null,
  };
}

function header({ requestType, player, rival, game, opening, coach = DEFAULT_COACH, locale = 'es' }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    requestType,
    locale: locale === 'en' ? 'en' : 'es',
    coach,
    player: { color: player.color, rating: Number.isFinite(player.rating) ? Math.round(player.rating) : null },
    rival: { level: rival.level, label: rival.label },
    game: { ...game, opening: { name: opening?.name ?? null, inBook: Boolean(opening?.inBook) } },
  };
}

/**
 * CoachRequest de una jugada del jugador (`move_feedback` o `why`).
 *
 * @param {object} p
 * @param {'move_feedback'|'why'} [p.requestType]
 * @param {ClassifiedMove} p.classification  salida de classifyMove
 * @param {Analysis} p.before  análisis MultiPV (idealmente 3) de `fenBefore`
 * @param {Analysis} p.after   análisis de `fenAfter` (su PV es la refutación)
 * @param {RivalMoveFacts|null} [p.lastRivalMove]  jugada del rival que llevó a `fenBefore`
 * @param {PlayerInfo} p.player
 * @param {RivalInfo} p.rival
 * @param {OpeningInfo|null} [p.opening]
 * @param {HistoryFacts} [p.history]
 * @param {boolean} [p.revealBestMove]  true solo tras "Seguir" (§4.3)
 * @param {string} [p.coach]  alfred | kairos | ariadna (la voz; los hechos no cambian)
 * @param {'es'|'en'} [p.locale]  idioma de la respuesta (plantillas e IA)
 * @param {import('./refutationLine.js').RefutationLine|null} [p.line]  línea de refutación de
 *   Stockfish (v1.1). Viaja en `why` y en el `move_feedback` que ya pide el "¿Por qué?"
 *   (`policy.explainWhy`: errores que ofrecen retroceder); sus jugadas pasan a allowedMoves.
 * @returns {object}  CoachRequest
 */
export function buildMoveRequest({
  line = null,
  requestType = 'move_feedback',
  classification,
  before,
  after,
  lastRivalMove = null,
  player,
  rival,
  opening = null,
  history = historyFacts(),
  revealBestMove = false,
  coach = DEFAULT_COACH,
  locale = 'es',
}) {
  const { fenBefore, fenAfter, moveUci, color } = classification;
  const facts = coachFacts(classification, { before, lastRivalMove });
  const refutation = refutationFacts({ fenAfter, after });
  const hanging = hangingPieces({ fenAfter, after });
  const offerTakeback = shouldOfferTakeback(classification, facts);
  // Errores que detienen la partida: el mismo pedido trae el "¿Por qué?" (1 llamada en vez de 2).
  const explainWhy = requestType === 'move_feedback' && offerTakeback && !revealBestMove && Boolean(line);
  const withLine = (requestType === 'why' || explainWhy) && line ? line : null;
  const lists = allowedLists({ classification, lastRivalMove, refutation, hanging, revealBestMove, line: withLine });

  return {
    ...header({
      requestType,
      player: { ...player, color },
      rival,
      game: gameFacts({ fenBefore, fenAfter, color }),
      opening,
      coach,
      locale,
    }),
    lastRivalMove,
    classification: contractClassification(classification, revealBestMove),
    moveDetails: moveDetails(fenBefore, moveUci),
    coachFacts: facts,
    refutation,
    hanging,
    opponentLoose: null,
    hintFacts: null,
    history,
    policy: {
      offerTakeback,
      revealBestMove,
      showNumbers: false,
      hintLevel: null,
      ...(explainWhy ? { explainWhy: true } : {}),
    },
    ...lists,
    userQuestion: null,
    ...(withLine ? { refutationLine: lineContract(withLine) } : {}),
  };
}

/**
 * Casillas que una pista NO puede mencionar: el destino de la mejor jugada (§5.3, regla 4).
 * Viajan en la cabecera de control, no en el cuerpo.
 * @param {Analysis} before
 * @returns {string[]}
 */
export function hintForbiddenSquares(before) {
  const best = before?.bestMove ?? before?.lines?.[0]?.pv?.[0] ?? null;
  return best ? [best.slice(2, 4)] : [];
}

/**
 * CoachRequest de una pista (`hint`, niveles 1–2; el 3 es la flecha y no va al LLM).
 * Las piezas sueltas en la casilla de destino de la mejor jugada se quitan: nombrarlas
 * revelaría la jugada.
 *
 * @param {object} p
 * @param {string} p.fen  posición actual (le toca al jugador)
 * @param {Analysis} p.before  análisis MultiPV de `fen`
 * @param {1|2} p.hintLevel
 * @param {RivalMoveFacts|null} [p.lastRivalMove]
 * @param {PlayerInfo} p.player
 * @param {RivalInfo} p.rival
 * @param {OpeningInfo|null} [p.opening]
 * @param {HistoryFacts} [p.history]
 * @returns {object}  CoachRequest
 */
export function buildHintRequest({
  fen,
  before,
  hintLevel,
  lastRivalMove = null,
  player,
  rival,
  opening = null,
  history = historyFacts(),
  coach = DEFAULT_COACH,
  locale = 'es',
}) {
  const color = sideToMove(fen);
  const forbidden = new Set(hintForbiddenSquares(before));
  const loose = opponentLoose(fen, color).filter((p) => !forbidden.has(p.square));
  const hint = hintFacts({ fen, before, hintLevel });
  const lists = allowedLists({ lastRivalMove, opponentLoose: loose, hintFacts: hint });
  const score = before?.lines?.[0]?.score ?? null;

  return {
    ...header({ requestType: 'hint', player: { ...player, color }, rival, game: gameFacts({ fenBefore: fen, color }), opening, coach, locale }),
    lastRivalMove,
    classification: null,
    moveDetails: null,
    coachFacts: {
      greatMove: null,
      playedRank: null,
      stillWinning: null,
      mateAllowed: null,
      mateMissed: null,
      evalLabelBefore: score ? evalLabel(winPercentFor(score, color)) : null,
      evalLabelAfter: null,
    },
    refutation: null,
    hanging: null,
    opponentLoose: loose,
    hintFacts: hint,
    history,
    policy: { offerTakeback: false, revealBestMove: false, showNumbers: false, hintLevel },
    allowedMoves: lists.allowedMoves,
    allowedSquares: lists.allowedSquares.filter((sq) => !forbidden.has(sq)),
    userQuestion: null,
  };
}
