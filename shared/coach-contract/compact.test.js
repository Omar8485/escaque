// Compactación de los hechos, esquemas de salida pedidos al LLM, normalización y "¿Por qué?"
// con la línea de refutación (v1.1).
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import MOVE_FIXTURE from './fixtures/01-move-feedback-mistake.json';
import HINT_FIXTURE from './fixtures/02-hint-level2.json';
import {
  compactRequest,
  isRepetition,
  llmSchemaFor,
  normalizeLlmOutput,
  prune,
  systemPrompt,
  userMessage,
  validateOutput,
  validateRequest,
} from './index.js';
import { classifyMove } from '../../src/engine/classify.js';
import { buildMoveRequest } from '../../src/coach/buildRequest.js';
import { buildRefutationLine } from '../../src/coach/refutationLine.js';

const MOVE = MOVE_FIXTURE.request;
const HINT = HINT_FIXTURE.request;

const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
const analysis = (fen, lines, depth = 15) => ({ fen, depth, bestMove: lines[0][1][0], lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth, score, pv })) });
const fenBefore = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
const fenAfter = play(['Nxe5'], fenBefore);
const PV = ['d8g5', 'e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3'];
const before = analysis(fenBefore, [[{ type: 'cp', value: 104 }, ['f3d4', 'e5d4']], [{ type: 'cp', value: 96 }, ['e1g1']], [{ type: 'cp', value: 54 }, ['b1c3']]]);
const after = analysis(fenAfter, [[{ type: 'cp', value: -64 }, PV]]);
const classification = classifyMove({ fenBefore, moveUci: 'f3e5', before, after });
const common = { classification, before, after, lastRivalMove: { san: 'Nd4', piece: 'n', to: 'd4', capture: null }, player: { color: 'w', rating: 1495 }, rival: { level: 6, label: 'Héctor' } };
const line = buildRefutationLine({ fenAfter, pv: PV });

describe('compactación de los hechos que viajan al LLM', () => {
  it('prune quita null, false, vacíos (pero conserva defended:false y los ceros)', () => {
    expect(prune({ a: null, b: false, c: [], d: {}, e: 0, f: { defended: false, x: null }, g: [null, 1] })).toEqual({ e: 0, f: { defended: false }, g: [1] });
  });

  it('sin evaluaciones numéricas, versiones, UCI ni piezas colgadas no confirmadas', () => {
    const c = compactRequest({ ...MOVE, hanging: [{ square: 'e5', piece: 'n', defended: false, confirmedByEngine: false }] });
    expect(c).not.toHaveProperty('schemaVersion');
    expect(c).not.toHaveProperty('promptVersion');
    expect(c).not.toHaveProperty('coach');
    expect(c).not.toHaveProperty('moveDetails');
    expect(c.classification).toEqual({ label: 'Mistake', moveSan: 'Nxe5' });
    expect(c.refutation).toEqual({ san: 'Qg5', motif: 'ataque_doble', targets: MOVE.refutation.targets });
    expect(c).not.toHaveProperty('hanging');
    expect(c.policy).toEqual({ offerTakeback: true });
    expect(c.allowedMoves).toEqual(MOVE.allowedMoves);
    expect(c.allowedSquares).toEqual(MOVE.allowedSquares);
    // Con showNumbers sí viajan los Win%.
    expect(compactRequest({ ...MOVE, policy: { ...MOVE.policy, showNumbers: true } }).classification).toMatchObject({ winBefore: 59.5, loss: 15.3 });
  });

  it('la pista conserva sus hechos y no lleva clasificación', () => {
    const c = compactRequest(HINT);
    expect(c.hintFacts).toEqual(HINT.hintFacts);
    expect(c.policy).toEqual({ hintLevel: 2 });
    expect(c).not.toHaveProperty('classification');
  });

  it('el mensaje compacto es mucho más corto que el completo', () => {
    const full = JSON.stringify(MOVE).length;
    expect(userMessage(MOVE).length).toBeLessThan(full * 0.6);
  });
});

describe('"¿Por qué?" con la línea de Stockfish', () => {
  it('el error que detiene la partida pide el "¿Por qué?" en la misma llamada', () => {
    const req = buildMoveRequest({ ...common, line });
    expect(validateRequest(req)).toEqual([]);
    expect(req.policy).toMatchObject({ offerTakeback: true, explainWhy: true });
    expect(req.refutationLine.san).toEqual(['Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+', 'Be2', 'Nf3#']);
    // Las jugadas y casillas de la línea están permitidas.
    for (const san of req.refutationLine.san) expect(req.allowedMoves).toContain(san);
    expect(req.allowedSquares).toEqual(expect.arrayContaining(['f7', 'g2', 'e4', 'e2', 'f3', 'f1']));
    expect(llmSchemaFor(req).required).toEqual(['comment', 'tone', 'question', 'why']);
    expect(systemPrompt('alfred', req)).toContain('"why":');
  });

  it('sin línea, o tras "Seguir", no se pide; why lleva la línea y escribe en comment', () => {
    expect(buildMoveRequest({ ...common }).policy.explainWhy).toBeUndefined();
    expect(buildMoveRequest({ ...common, line, revealBestMove: true }).refutationLine).toBeUndefined();
    const why = buildMoveRequest({ ...common, line, requestType: 'why' });
    expect(validateRequest(why)).toEqual([]);
    expect(why.policy.explainWhy).toBeUndefined();
    expect(why.refutationLine.mate).toBe(true);
    expect(llmSchemaFor(why).required).toEqual(['comment', 'tone']);
    expect(systemPrompt('alfred', why)).toContain('«¿Por qué?»');
  });

  it('la validación acepta jugadas de la línea y rechaza las que no están', () => {
    const req = buildMoveRequest({ ...common, line, requestType: 'why' });
    const ok = normalizeLlmOutput({ comment: 'Tras [[Qg5]] [[Nxf7]] [[Qxg2]] el rival amenaza tu torre y acaba con [[Nf3#]].', tone: 'alerta' }, req);
    expect(validateOutput(ok, req).ok).toBe(true);
    const bad = normalizeLlmOutput({ comment: 'Tras [[Qg5]] el rival sigue con [[Qh4]].', tone: 'alerta' }, req);
    expect(validateOutput(bad, req)).toMatchObject({ ok: false });
    // Sin la línea, Nxf7 no está permitida.
    const plain = buildMoveRequest({ ...common });
    expect(validateOutput(normalizeLlmOutput({ comment: 'Luego [[Nxf7]].', tone: 'alerta', question: null }, plain), plain).ok).toBe(false);
  });

  it('normalización: completa el contrato y valida también "why"', () => {
    const req = buildMoveRequest({ ...common, line });
    const out = normalizeLlmOutput({ comment: 'Tras [[Nxe5]], [[Qg5]] ataca dos piezas.', tone: 'alerta', question: null, why: 'La línea [[Qg5]] [[Nxf7]] [[Qxg2]] termina en mate con [[Nf3#]].' }, req);
    expect(out).toMatchObject({ suggestTakeback: true, hint: null, concepts: [], factsUsed: [] });
    expect(validateOutput(out, req)).toMatchObject({ ok: true });
    const leaked = normalizeLlmOutput({ comment: 'Ojo.', tone: 'alerta', question: null, why: 'Había que jugar [[Nxd4]].' }, req);
    expect(validateOutput(leaked, req).ok).toBe(false);
    expect(normalizeLlmOutput({ hint: 'Busca un ataque doble.', tone: 'neutral' }, HINT)).toMatchObject({ comment: '', hint: 'Busca un ataque doble.' });
  });

  it('detecta un "¿Por qué?" que repite el comentario', () => {
    const comment = '[[Nxe5]] es un error. El rival responde [[Qg5]] y ataca a la vez tu caballo de e5 y peón de g2.';
    expect(isRepetition(comment, 'El rival responde [[Qg5]] y ataca a la vez tu caballo de e5 y tu peón de g2.')).toBe(true);
    expect(isRepetition(comment, 'Tras [[Qg5]] [[Nxf7]] [[Qxg2]] la dama entra por g2 y tu rey queda sin refugio: la línea acaba en mate con [[Nf3#]].')).toBe(false);
    expect(isRepetition(comment, '')).toBe(true);
  });
});
