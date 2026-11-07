// Alfred durante la partida (T6 + T9, docs/COACH_DESIGN.md §1.2 y §7.1).
//
// Por cada jugada del usuario: analiza (pipeline T5), arma el CoachRequest y comenta. Sin IA, la
// plantilla sale al instante (y ninguna petición de red). Si toca llamar a la IA del usuario, el
// coach queda "pensando" hasta que llega su texto (validado §5.3) o falla/vence el plazo, y solo
// entonces habla: sin parpadeo plantilla→IA (v1.1). Las dos versiones quedan disponibles y el
// usuario alterna entre ellas (textChoice.js). "¿Por qué?" muestra la línea de refutación de
// Stockfish (refutationLine.js) con una explicación; en los errores que detienen la partida esa
// explicación ya viene en la misma llamada (policy.explainWhy).
// En Mistake/Blunder (o mate concedido, según la preferencia) INTERRUMPE: el rival no mueve
// hasta que el usuario elige Retroceder o Seguir. Pistas 1–2 (texto) y 3 (flecha).
//
// El hook no toca el tablero: Retroceder llama a `onTakeback` (App deshace 1 ply).
import { emitRewardEvent } from '../rewards/events';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analyzePlayerMove, prefetchTurn, refutationLineFor, COACH_MULTIPV } from './coachPipeline.js';
import { buildHintRequest, buildMoveRequest, hintForbiddenSquares, historyFacts } from './buildRequest.js';
import { feedbackTemplate, hintTemplate, whyTemplate } from './templates.js';
import { getT } from '../i18n/core.js';
import { netLoss } from './refutationLine.js';
import { pickText, readPreferredSource, writePreferredSource } from './textChoice.js';
import { isRepetition } from '../../shared/coach-contract/index.js';
import { openingFacts } from './opening.js';
import { CoachClient, cacheKey } from './coachClient.js';
import { isAbortError, DEFAULT_DEPTH } from '../engine/engine.js';
import { rivalMoveFacts } from './tactics.js';
import { COACH_IDS, DEFAULT_COACH } from '../../shared/coach-contract/index.js';

/** Máximo de llamadas al LLM por partida (§7.1). */
export const MAX_LLM_CALLS_PER_GAME = 30;
/** Preferencias de interrupción. */
/** Modos de interrupción → clave del texto (`coach.mode.*`). */
export const INTERRUPT_MODES = Object.freeze({
  mistakes: 'coach.mode.mistakes',
  inaccuracies: 'coach.mode.inaccuracies',
  never: 'coach.mode.never',
});
const PREFS_KEY = 'alfred:prefs';
export const HINT_ARROW_COLOR = '#16a34a';

/**
 * ¿Interrumpe esta jugada? `policy.offerTakeback` es la regla del diseño; la preferencia
 * puede ampliarla a imprecisiones o desactivarla.
 */
export function shouldInterrupt(request, mode) {
  if (mode === 'never') return false;
  if (request.policy.offerTakeback) return true;
  return mode === 'inaccuracies' && request.classification.label === 'Inaccuracy';
}

/** ¿Pide comentario automático al LLM? (§7.1: gran jugada o jugada que ofrece retroceder). */
export function wantsAutoLlm(request) {
  return Boolean(request.coachFacts?.greatMove || request.policy?.offerTakeback);
}

function readPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return {
      mode: INTERRUPT_MODES[p.mode] ? p.mode : 'mistakes',
      active: p.active !== false,
      coach: COACH_IDS.includes(p.coach) ? p.coach : DEFAULT_COACH,
    };
  } catch {
    return { mode: 'mistakes', active: true, coach: DEFAULT_COACH };
  }
}

function writePrefs(prefs) {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Sin almacenamiento: la preferencia dura la sesión.
  }
}

const freshSession = (gameId) => ({
  gameId,
  records: {},
  positions: {},
  retractedMoves: [],
  takebacks: 0,
  hintsUsed: 0,
  llmCalls: 0,
  retry: null, // { fenBefore, badKey } tras Retroceder
  hint: null, // { fen, level, text, tone, source, loading, arrow }
});

/** Jugadas propias ya analizadas en la línea actual → `history` del contrato. */
function historyFromRecords(records, playerMoves, counters) {
  const played = playerMoves
    .map((m) => records[`${m.before}|${m.lan}`])
    .filter((r) => r?.request)
    .map((r) => ({ label: r.request.classification.label, motif: r.request.refutation?.motif ?? null }));
  return historyFacts(played, counters);
}

/** ¿La jugada corrige (mejor, excelente o gran jugada)? Tras retroceder se felicita con plantilla. */
export function isCorrection(request) {
  const c = request.classification;
  return c.label === 'Best' || c.label === 'Excellent' || Boolean(request.coachFacts?.greatMove);
}

/**
 * Texto de la IA para el "¿Por qué?" de un registro: el de su propia llamada o, en los errores que
 * detienen la partida, el campo `why` que ya vino con el comentario (si no repite el comentario).
 */
export function whyLlmOf(record) {
  if (record.why?.status && record.why.status !== 'idle') return record.why;
  if (!record.request?.policy?.explainWhy) return record.why ?? { status: 'idle' };
  const llm = record.llm ?? { status: 'idle' };
  if (llm.status === 'loading') return { status: 'loading' };
  if (llm.status === 'done' && llm.why && !isRepetition(llm.text, llm.why)) return { status: 'done', text: llm.why, tone: llm.tone, by: llm.by };
  return { status: llm.status === 'idle' ? 'idle' : 'failed' };
}

/**
 * Vista del comentario de una jugada analizada (pura, para tests).
 * @param {object} record  registro de la jugada (useCoach)
 * @param {{isRetry?: boolean, preferred?: 'ia'|'plantilla', locale?: 'es'|'en'}} [opts]
 *   `locale`: idioma de las plantillas (por defecto, el de la petición); así cambiar de idioma
 *   traduce al momento los comentarios de plantilla ya mostrados.
 */
export function feedbackView(record, { isRetry = false, preferred = 'ia', locale } = {}) {
  const request = locale ? { ...record.request, locale } : record.request;
  const c = request.classification;
  const template = feedbackTemplate(request, { retryOf: isRetry });
  // Al corregir tras Retroceder se felicita con plantilla ("¡Eso es! … corrige el problema").
  const main = pickText({ template, llm: isRetry && isCorrection(request) ? null : record.llm, preferred });
  const whyOpen = Boolean(record.why?.open);
  const whyRequest = whyOpen ? { ...request, requestType: 'why', refutationLine: request.refutationLine ?? lineContractOf(record) } : null;
  const why = whyOpen ? pickText({ template: whyTemplate(whyRequest, { netLoss: netLoss(record.line) }), llm: whyLlmOf(record), preferred }) : null;
  return {
    state: main.state === 'thinking' ? 'thinking' : 'feedback',
    key: record.key,
    moveSan: c.moveSan,
    label: c.label,
    playerColor: c.color,
    greatMove: Boolean(request.coachFacts.greatMove),
    text: main.text,
    tone: main.tone ?? (main.state === 'thinking' ? null : template.tone),
    source: main.source,
    sourceModel: main.model,
    alternate: main.alternate,
    alternateLoading: main.alternateLoading,
    question: main.source === 'ia' ? record.llm.question ?? null : null,
    bestMoveSan: record.revealRequest?.classification.bestMoveSan ?? null,
    decision: record.decision,
    why,
    whyLine: whyOpen ? record.line ?? null : null,
    canWhy: c.label !== 'Best' && c.label !== 'Excellent' && !whyOpen,
  };
}

/** Hechos de la línea del registro (si la petición no la llevaba, p. ej. una imprecisión). */
function lineContractOf(record) {
  const l = record.line;
  return l ? { san: l.moves.map((m) => m.san), mate: l.mate, mateIn: l.mateIn, materialSwing: l.materialSwing, playerLost: l.playerLost, rivalLost: l.rivalLost } : null;
}

/**
 * Plantilla de la pista en el idioma pedido: la guardada como petición (`template.request`) o
 * como clave (`template.key`) se traduce al pintar; un texto fijo (`template.text`) se usa tal cual.
 */
function hintTemplateOf(template, locale) {
  if (!template) return template;
  if (template.request) return { text: hintTemplate(locale ? { ...template.request, locale } : template.request), tone: 'neutral' };
  if (template.key) return { text: getT(locale ?? 'es')(template.key) };
  return template;
}

/** Vista de la pista actual: mismo criterio IA/plantilla (pensando mientras la IA redacta). */
export function hintView(hint, preferred = 'ia', locale) {
  if (!hint) return null;
  if (hint.loading) return { ...hint, text: null, thinking: true };
  const choice = pickText({ template: hintTemplateOf(hint.template, locale), llm: hint.llm, preferred });
  return {
    ...hint,
    thinking: choice.state === 'thinking',
    text: choice.text,
    source: choice.source,
    by: choice.model,
    alternate: choice.alternate,
    alternateLoading: choice.alternateLoading,
  };
}

/**
 * @param {object} p
 * @param {import('../engine/engine.js').StockfishEngine} p.engine  analista
 * @param {boolean} p.enabled  partida contra el rival en curso en la pestaña Entrenar
 * @param {number} p.gameId
 * @param {'w'|'b'} p.playerColor
 * @param {import('chess.js').Move[]} p.history  game.history({verbose:true})
 * @param {string} p.fen  posición actual
 * @param {boolean} p.isPlayerTurn
 * @param {{level:number, label:string}} p.rival
 * @param {number} p.rating
 * @param {() => void} p.onTakeback  deshace la última jugada del usuario (1 ply)
 * @param {CoachClient} [p.client]
 * @param {'es'|'en'} [p.locale]  idioma de las plantillas y de la IA (CoachRequest.locale)
 */
export function useCoach({ engine, enabled, gameId, playerColor, history, fen, isPlayerTurn, rival, rating, onTakeback, client: injected, locale = 'es' }) {
  const [client] = useState(() => injected ?? new CoachClient());
  const connection = useSyncExternalStore(client.subscribe, client.getConnection);
  const usage = useSyncExternalStore(client.usage.subscribe, client.usage.getSnapshot);
  // El consumo de la IA se cuenta por partida.
  useEffect(() => client.usage.startGame(gameId), [client, gameId]);
  const [prefs, setPrefsState] = useState(readPrefs);
  const [preferredSource, setPreferredState] = useState(readPreferredSource);
  const [stored, setSession] = useState(() => freshSession(gameId));
  const session = stored.gameId === gameId ? stored : freshSession(gameId);
  const active = enabled && prefs.active;

  // Espejo para callbacks asíncronos (no se lee durante el render).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  /** Actualiza la sesión de ESTA partida (descarta respuestas de partidas anteriores). */
  const update = useCallback(
    (fn) => setSession((s) => (s.gameId === gameId ? fn(s) : s.gameId < gameId ? fn(freshSession(gameId)) : s)),
    [gameId],
  );
  const updateRecord = useCallback(
    (key, fn) => update((s) => (s.records[key] ? { ...s, records: { ...s.records, [key]: fn(s.records[key]) } } : s)),
    [update],
  );

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      writePrefs(next);
      return next;
    });
  }, []);

  /** Alterna la vista IA ↔ plantilla (se recuerda la última elegida). */
  const setPreferredSource = useCallback((source) => {
    setPreferredState(source);
    writePreferredSource(source);
  }, []);

  // ---------- Jugada observada ----------
  const playerMoves = useMemo(() => history.filter((m) => m.color === playerColor), [history, playerColor]);
  const lastIdx = history.findLastIndex((m) => m.color === playerColor);
  const move = lastIdx >= 0 ? history[lastIdx] : null;
  const key = move ? `${move.before}|${move.lan}` : null;
  const awaitingRival = move !== null && lastIdx === history.length - 1;
  const record = key ? session.records[key] ?? null : null;
  const prevRival = lastIdx > 0 && history[lastIdx - 1].color !== playerColor ? history[lastIdx - 1] : null;
  const prevRivalUci = prevRival?.lan ?? null;
  const prevRivalBefore = prevRival?.before ?? null;
  const openingSans = useMemo(() => (lastIdx >= 0 ? history.slice(0, lastIdx + 1).map((m) => m.san) : []), [history, lastIdx]);

  /** Llamada al LLM; el resultado reemplaza a la plantilla en `field` del registro. */
  const callLlm = useCallback(
    (recKey, request, field, { forbiddenSquares = [], onDone } = {}) => {
      if (sessionRef.current.llmCalls >= MAX_LLM_CALLS_PER_GAME) return false;
      update((s) => ({ ...s, llmCalls: s.llmCalls + 1 }));
      client.request(request, { forbiddenSquares, key: cacheKey(request, recKey ?? '') }).then((res) => {
        const llm = res.ok
          ? { status: 'done', text: res.data.hint ?? res.data.comment, tone: res.data.tone, question: res.data.question ?? null, why: res.data.why ?? null, by: res.meta?.model ?? null }
          : { status: 'failed', kind: res.kind };
        if (onDone) onDone(llm);
        else updateRecord(recKey, (r) => ({ ...r, [field]: { ...r[field], ...llm } }));
      });
      return true;
    },
    [client, update, updateRecord],
  );

  // ---------- Análisis de cada jugada del usuario ----------
  const hasRecord = Boolean(record);
  useEffect(() => {
    if (!active || !key || hasRecord) return undefined;
    const controller = new AbortController();
    const [fenBefore, moveUci] = key.split('|');
    analyzePlayerMove(engine, { fenBefore, moveUci }, { signal: controller.signal })
      .then(async (analysis) => {
        // Línea de refutación de Stockfish para "¿Por qué?" (no hace falta en Best/Excellent).
        const { label, fenAfter } = analysis.classification;
        const line = label === 'Best' || label === 'Excellent' ? null : await refutationLineFor(engine, { fenAfter, after: analysis.after }, { signal: controller.signal }).catch((err) => {
          if (isAbortError(err)) throw err;
          return null;
        });
        return { analysis, line };
      })
      .then(({ analysis, line }) => {
        const lastRivalMove = prevRivalUci ? rivalMoveFacts(prevRivalBefore, prevRivalUci) : null;
        const s = sessionRef.current;
        const args = {
          classification: analysis.classification,
          before: analysis.before,
          after: analysis.after,
          lastRivalMove,
          player: { color: playerColor, rating },
          rival,
          opening: openingFacts(openingSans),
          history: historyFromRecords(s.records, playerMoves.slice(0, -1), { takebacks: s.takebacks, hintsUsed: s.hintsUsed }),
          coach: prefs.coach,
          line,
          locale,
        };
        const request = buildMoveRequest(args);
        const interrupt = shouldInterrupt(request, prefs.mode);
        // Tras retroceder, si corriges se felicita con plantilla: no hace falta la IA.
        const isRetry = Boolean(s.retry && s.retry.fenBefore === fenBefore && s.retry.badKey !== key);
        if (isRetry && isCorrection(request)) emitRewardEvent('correction', { gameId, key: fenBefore });
        const auto = wantsAutoLlm(request) && !(isRetry && isCorrection(request)) && client.llmEnabled;
        update((st) => ({
          ...st,
          records: {
            ...st.records,
            [key]: {
              key,
              fenBefore,
              analysis,
              args,
              line,
              request,
              interrupt,
              decision: null,
              revealRequest: null,
              llm: { status: auto ? 'loading' : 'idle' },
              why: { status: 'idle', open: false },
            },
          },
        }));
        if (auto && !callLlm(key, request, 'llm')) updateRecord(key, (r) => ({ ...r, llm: { status: 'idle' } }));
      })
      .catch((err) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        console.error('Alfred no pudo analizar la jugada:', err);
        update((st) => ({ ...st, records: { ...st.records, [key]: { key, fenBefore, error: String(err?.message ?? err) } } }));
      });
    return () => controller.abort();
    // `playerMoves`, `openingSans` y `rival` cambian con `key`/partida; no deben relanzar el análisis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, hasRecord, engine]);

  // Cancela lo pendiente al cambiar de partida o al desmontar.
  useEffect(() => () => client.cancel(), [client, gameId]);

  // ---------- Acciones ----------
  const takeback = useCallback(() => {
    if (!record?.request) return;
    update((s) => ({
      ...s,
      takebacks: s.takebacks + 1,
      positions: { ...s.positions, [record.fenBefore]: { ...s.positions[record.fenBefore], takebackUsed: true } },
      retractedMoves: [...s.retractedMoves, { key: record.key, san: record.request.classification.moveSan, uci: record.request.classification.moveUci, classification: record.request.classification, coachInterrupted: Boolean(record.interrupt), takebackUsed: true, hintsUsed: s.positions[record.fenBefore]?.hintsUsed ?? 0 }],
      retry: { fenBefore: record.fenBefore, badKey: record.key },
      // Si vuelve a jugar lo mismo, Alfred debe volver a avisar.
      records: { ...s.records, [record.key]: { ...record, decision: null } },
    }));
    onTakeback();
  }, [record, update, onTakeback]);

  /** Deshacer desde el botón general (cuenta como retroceso en el resumen). */
  const noteUndo = useCallback(() => update((s) => ({
    ...s, takebacks: s.takebacks + 1,
    positions: move ? { ...s.positions, [move.before]: { ...s.positions[move.before], takebackUsed: true } } : s.positions,
  })), [update, move]);

  const continueGame = useCallback(() => {
    if (!record?.request) return;
    const revealRequest = buildMoveRequest({ ...record.args, requestType: 'move_feedback', revealBestMove: true, locale });
    updateRecord(record.key, (r) => ({ ...r, decision: 'continued', revealRequest }));
  }, [record, updateRecord, locale]);

  const why = useCallback(() => {
    if (!record?.request || record.why.open) return;
    // Los errores que detienen la partida ya traen el "¿Por qué?" en la misma llamada.
    if (record.request.policy.explainWhy && record.llm.status !== 'idle') {
      updateRecord(record.key, (r) => ({ ...r, why: { ...r.why, open: true } }));
      return;
    }
    const request = buildMoveRequest({ ...record.args, requestType: 'why', locale });
    const shown = record.llm.status === 'done' ? record.llm.text : feedbackTemplate(record.request).text;
    const asked =
      client.llmEnabled &&
      callLlm(record.key, request, 'why', {
        // Si la IA solo repite el comentario inicial, no aporta: queda la explicación de plantilla.
        onDone: (llm) =>
          updateRecord(record.key, (r) => ({
            ...r,
            why: { ...r.why, ...(llm.status === 'done' && isRepetition(shown, llm.text) ? { status: 'failed', kind: 'repetition' } : llm) },
          })),
      });
    updateRecord(record.key, (r) => ({ ...r, why: { status: asked ? 'loading' : 'idle', open: true } }));
  }, [record, client, callLlm, updateRecord, locale]);

  const requestHint = useCallback(async () => {
    if (!active || !isPlayerTurn) return;
    const current = sessionRef.current.hint;
    const level = Math.min(3, current?.fen === fen ? current.level + 1 : 1);
    update((s) => ({ ...s, hintsUsed: s.hintsUsed + 1, positions: { ...s.positions, [fen]: { ...s.positions[fen], hintsUsed: (s.positions[fen]?.hintsUsed ?? 0) + 1 } }, hint: { fen, level, loading: true, template: null, llm: null } }));
    let before = engine.getCached(fen, { depth: DEFAULT_DEPTH, multipv: COACH_MULTIPV });
    try {
      before = before ?? (await prefetchTurn(engine, fen));
    } catch (err) {
      if (!isAbortError(err)) console.error('Alfred no pudo preparar la pista:', err);
      update((s) => ({ ...s, hint: s.hint?.fen === fen ? { ...s.hint, loading: false, template: { key: 'coach.hintFailed' } } : s.hint }));
      return;
    }
    const best = before.bestMove ?? before.lines?.[0]?.pv?.[0];
    const setHint = (patch) =>
      update((s) => (s.hint?.fen === fen && s.hint.level === level ? { ...s, hint: { ...s.hint, ...patch } } : s));
    if (level === 3) {
      setHint({ loading: false, template: { key: 'coach.hintArrow' }, llm: null, arrow: best ? { start: best.slice(0, 2), end: best.slice(2, 4), color: HINT_ARROW_COLOR } : null });
      return;
    }
    const last = history.at(-1);
    const s = sessionRef.current;
    const request = buildHintRequest({
      fen,
      before,
      hintLevel: level,
      lastRivalMove: last && last.color !== playerColor ? rivalMoveFacts(last.before, last.lan) : null,
      player: { color: playerColor, rating },
      rival,
      opening: openingFacts(history.map((m) => m.san)),
      history: historyFromRecords(s.records, playerMoves, { takebacks: s.takebacks, hintsUsed: s.hintsUsed }),
      coach: prefs.coach,
      locale,
    });
    const asked =
      client.llmEnabled &&
      callLlm(null, request, 'hint', { forbiddenSquares: hintForbiddenSquares(before), onDone: (llm) => setHint({ llm }) });
    setHint({ loading: false, template: { request }, llm: { status: asked ? 'loading' : 'idle' } });
  }, [active, isPlayerTurn, fen, engine, update, history, playerColor, rating, rival, playerMoves, client, callLlm, prefs.coach, locale]);

  // ---------- Vista ----------
  const analyzing = active && key !== null && !record;
  const interrupting = Boolean(active && awaitingRival && record?.interrupt && !record.decision);
  const view = useMemo(() => {
    if (!active) return { state: 'off' };
    if (!key) return { state: 'idle' };
    if (!record) return { state: 'analyzing', moveSan: move.san };
    if (record.error) return { state: 'error', moveSan: move.san, text: getT(locale)('coach.analyzeFailed') };
    const retry = session.retry;
    const isRetry = Boolean(retry && retry.fenBefore === record.fenBefore && retry.badKey !== record.key);
    return feedbackView(record, { isRetry, preferred: preferredSource, locale });
  }, [active, key, record, move, session.retry, preferredSource, locale]);

  const rawHint = active && session.hint?.fen === fen ? session.hint : null;
  const hint = useMemo(() => hintView(rawHint, preferredSource, locale), [rawHint, preferredSource, locale]);

  return {
    active,
    prefs,
    setPrefs,
    connection,
    disabledKind: client.disabledKind,
    usage,
    view,
    hint,
    hintArrows: hint?.arrow ? [hint.arrow] : [],
    canHint: active && isPlayerTurn && (hint?.level ?? 0) < 3 && !hint?.loading && !hint?.thinking,
    preferredSource,
    setPreferredSource,
    interrupting,
    // El rival espera mientras Alfred analiza tu jugada o mientras decides tras un aviso.
    rivalBlocked: active && awaitingRival && (analyzing || interrupting),
    records: session.records,
    interactions: session.positions,
    retractedMoves: session.retractedMoves,
    counters: { takebacks: session.takebacks, hintsUsed: session.hintsUsed, llmCalls: session.llmCalls },
    takeback,
    continueGame,
    why,
    requestHint,
    noteUndo,
  };
}
