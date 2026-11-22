// Sin parpadeo plantilla→IA y alternancia IA ↔ plantilla (v1.1).
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove } from '../engine/classify.js';
import { buildMoveRequest } from './buildRequest.js';
import { buildRefutationLine } from './refutationLine.js';
import { pickText, readPreferredSource, writePreferredSource, VIEW_KEY } from './textChoice.js';
import { feedbackView, hintView, isCorrection, whyLlmOf } from './useCoach.js';

const TPL = { text: 'Plantilla.', tone: 'alerta' };

describe('pickText', () => {
  it('sin IA: la plantilla al instante, sin alternativa', () => {
    expect(pickText({ template: TPL })).toMatchObject({ state: 'ready', text: 'Plantilla.', source: 'plantilla', alternate: null });
    expect(pickText({ template: TPL, llm: { status: 'failed', kind: 'timeout' } })).toMatchObject({ state: 'ready', source: 'plantilla', alternate: null });
  });

  it('IA redactando y vista IA: "pensando", sin ningún texto (no aparece la plantilla antes)', () => {
    expect(pickText({ template: TPL, llm: { status: 'loading' } })).toEqual({ state: 'thinking', text: null, tone: null, source: null, model: null, alternate: null, alternateLoading: false });
  });

  it('IA redactando y vista plantilla: plantilla ya, la IA llegará como alternativa', () => {
    expect(pickText({ template: TPL, llm: { status: 'loading' }, preferred: 'plantilla' })).toMatchObject({ state: 'ready', source: 'plantilla', alternate: 'ia', alternateLoading: true });
  });

  it('con las dos versiones se alterna según la preferencia', () => {
    const llm = { status: 'done', text: 'Texto IA.', tone: 'alerta', by: 'gemini-3.5-flash-lite' };
    expect(pickText({ template: TPL, llm })).toMatchObject({ text: 'Texto IA.', source: 'ia', model: 'gemini-3.5-flash-lite', alternate: 'plantilla' });
    expect(pickText({ template: TPL, llm, preferred: 'plantilla' })).toMatchObject({ text: 'Plantilla.', source: 'plantilla', alternate: 'ia' });
  });

  it('recuerda la última vista elegida (y tolera almacenamiento roto)', () => {
    const m = new Map();
    const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
    expect(readPreferredSource(storage)).toBe('ia');
    writePreferredSource('plantilla', storage);
    expect(m.get(VIEW_KEY)).toBe('plantilla');
    expect(readPreferredSource(storage)).toBe('plantilla');
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(readPreferredSource(broken)).toBe('ia');
    expect(() => writePreferredSource('ia', broken)).not.toThrow();
  });
});

const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
const analysis = (fen, lines) => ({ fen, depth: 15, bestMove: lines[0][1][0], lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth: 15, score, pv })) });
const fenBefore = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
const fenAfter = play(['Nxe5'], fenBefore);
const PV = ['d8g5', 'e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3'];
const before = analysis(fenBefore, [[{ type: 'cp', value: 104 }, ['f3d4', 'e5d4']], [{ type: 'cp', value: 96 }, ['e1g1']]]);
const after = analysis(fenAfter, [[{ type: 'cp', value: -64 }, PV]]);
const line = buildRefutationLine({ fenAfter, pv: PV });
const args = { classification: classifyMove({ fenBefore, moveUci: 'f3e5', before, after }), before, after, lastRivalMove: { san: 'Nd4', piece: 'n', to: 'd4', capture: null }, player: { color: 'w', rating: 1495 }, rival: { level: 6, label: 'Héctor' }, line };
const record = (patch = {}) => ({ key: 'k', fenBefore, args, line, request: buildMoveRequest(args), interrupt: true, decision: null, revealRequest: null, llm: { status: 'idle' }, why: { status: 'idle', open: false }, ...patch });

describe('vista del comentario de un error', () => {
  it('sin IA: plantilla al instante', () => {
    const v = feedbackView(record());
    expect(v).toMatchObject({ state: 'feedback', source: 'plantilla', label: 'Mistake', alternate: null });
    expect(v.text).toContain('[[Qg5]]');
  });

  it('con la IA redactando: estado "pensando" sin texto', () => {
    const v = feedbackView(record({ llm: { status: 'loading' } }));
    expect(v.state).toBe('thinking');
    expect(v.text).toBeNull();
    expect(v.label).toBe('Mistake'); // la insignia sí puede verse
  });

  it('tras la respuesta: texto de la IA y la plantilla a un clic', () => {
    const llm = { status: 'done', text: 'IA: tras [[Nxe5]] llega [[Qg5]].', tone: 'alerta', question: '¿Qué queda sin defensa?', why: 'La línea [[Qg5]] [[Nxf7]] [[Qxg2]] acaba en mate con [[Nf3#]]; vigila la casilla f7.', by: 'm' };
    const v = feedbackView(record({ llm }));
    expect(v).toMatchObject({ state: 'feedback', source: 'ia', text: llm.text, alternate: 'plantilla', question: llm.question });
    const p = feedbackView(record({ llm }), { preferred: 'plantilla' });
    expect(p).toMatchObject({ source: 'plantilla', alternate: 'ia', question: null });
  });

  it('"¿Por qué?" del error: viene en la misma respuesta, con la línea para el mini tablero', () => {
    const llm = { status: 'done', text: 'IA: tras [[Nxe5]] llega [[Qg5]].', tone: 'alerta', why: 'La línea [[Qg5]] [[Nxf7]] [[Qxg2]] acaba en mate con [[Nf3#]].', by: 'm' };
    const v = feedbackView(record({ llm, why: { status: 'idle', open: true } }));
    expect(v.why).toMatchObject({ state: 'ready', source: 'ia', text: llm.why, alternate: 'plantilla' });
    expect(v.whyLine.moves).toHaveLength(7);
    expect(v.canWhy).toBe(false);
    // Mientras la IA redacta, "¿Por qué?" también espera.
    expect(feedbackView(record({ llm: { status: 'loading' }, why: { status: 'idle', open: true } })).why.state).toBe('thinking');
  });

  it('si el "why" de la IA repite el comentario, queda la plantilla', () => {
    const llm = { status: 'done', text: 'Tras [[Nxe5]] el rival responde [[Qg5]] y ataca tu caballo.', tone: 'alerta', why: 'Tras [[Nxe5]] el rival responde [[Qg5]] y ataca tu caballo.' };
    expect(whyLlmOf(record({ llm }))).toEqual({ status: 'failed' });
    const v = feedbackView(record({ llm, why: { status: 'idle', open: true } }));
    expect(v.why).toMatchObject({ source: 'plantilla', alternate: null });
    expect(v.why.text).toContain('ataca dos cosas a la vez');
  });

  it('tras retroceder, otro error sigue usando la IA (solo la corrección es de plantilla)', () => {
    const v = feedbackView(record({ llm: { status: 'loading' } }), { isRetry: true });
    expect(v.state).toBe('thinking');
    expect(isCorrection({ classification: { label: 'Best' }, coachFacts: {} })).toBe(true);
    expect(isCorrection({ classification: { label: 'Good' }, coachFacts: { greatMove: true } })).toBe(true);
    expect(isCorrection({ classification: { label: 'Mistake' }, coachFacts: {} })).toBe(false);
  });
});

describe('vista de la pista', () => {
  it('pensando mientras la IA redacta; luego alternable', () => {
    const base = { fen: 'x', level: 1, loading: false, template: { text: 'Busca un ataque doble.', tone: 'neutral' } };
    expect(hintView({ ...base, llm: { status: 'loading' } })).toMatchObject({ thinking: true, text: null });
    expect(hintView({ ...base, llm: { status: 'done', text: 'IA: mira las piezas sueltas.' } })).toMatchObject({ thinking: false, source: 'ia', alternate: 'plantilla' });
    expect(hintView({ ...base, llm: { status: 'idle' } })).toMatchObject({ source: 'plantilla', text: 'Busca un ataque doble.' });
    expect(hintView({ fen: 'x', level: 1, loading: true })).toMatchObject({ thinking: true });
    expect(hintView(null)).toBeNull();
  });
  it('las plantillas guardadas como clave o petición se traducen al idioma pedido', () => {
    const keyed = { fen: 'x', level: 3, loading: false, template: { key: 'coach.hintArrow' }, llm: null };
    expect(hintView(keyed, 'ia', 'en').text).toBe('This is the move the engine recommends.');
    expect(hintView(keyed, 'ia', 'es').text).toBe('Esta es la jugada que recomienda el motor.');
    const req = { locale: 'es', hintFacts: { motif: 'ataque_doble' }, policy: { hintLevel: 1 } };
    const fromReq = { fen: 'x', level: 1, loading: false, template: { request: req }, llm: { status: 'idle' } };
    expect(hintView(fromReq).text).toBe('Busca un ataque doble.');
    expect(hintView(fromReq, 'ia', 'en').text).toBe('Look for a double attack.');
  });
});
