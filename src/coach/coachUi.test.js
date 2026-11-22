import { getT } from '../i18n/core.js';
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove } from '../engine/classify.js';
import { buildHintRequest, buildMoveRequest } from './buildRequest.js';
import { feedbackTemplate, hintTemplate, moodForTone, figurine, segmentText, plainText, praiseText, refutationSentence } from './templates.js';
import { shouldInterrupt, wantsAutoLlm } from './useCoach.js';

const cp = (value) => ({ type: 'cp', value });
const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
const analysis = (fen, lines, depth = 15) => ({
  fen,
  depth,
  bestMove: lines[0][1][0],
  lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth, score, pv })),
});
const fenBefore = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
const fenAfter = play(['Nxe5'], fenBefore);
const before = analysis(fenBefore, [[cp(104), ['f3d4', 'e5d4']], [cp(96), ['e1g1']], [cp(54), ['b1c3']]]);
const common = { lastRivalMove: { san: 'Nd4', piece: 'n', to: 'd4', capture: null }, player: { color: 'w', rating: 1495 }, rival: { level: 6, label: 'Héctor' } };
const mistakeReq = (() => {
  const after = analysis(fenAfter, [[cp(-64), ['d8g5']]]);
  return buildMoveRequest({ classification: classifyMove({ fenBefore, moveUci: 'f3e5', before, after }), before, after, ...common });
})();
const bestReq = (() => {
  const fa = play(['Nxd4'], fenBefore);
  const after = analysis(fa, [[cp(104), ['e5d4']]]);
  return buildMoveRequest({ classification: classifyMove({ fenBefore, moveUci: 'f3d4', before, after }), before, after, ...common });
})();
const inaccuracyReq = (() => {
  const fa = play(['Nc3'], fenBefore);
  const after = analysis(fa, [[cp(20), ['d4f3']]]);
  return buildMoveRequest({ classification: classifyMove({ fenBefore, moveUci: 'b1c3', before, after }), before, after, ...common });
})();

describe('plantillas de Alfred', () => {
  it('Mistake: consecuencia concreta + invitación a reconsiderar', () => {
    const t = feedbackTemplate(mistakeReq);
    expect(t.tone).toBe('alerta');
    expect(t.text).toBe('[[Nxe5]] es un error. El rival responde [[Qg5]] y ataca a la vez tu caballo de e5 y peón de g2. ¿Seguro? Puedes retroceder y buscar otra jugada.');
  });

  it('Best: elogio; tras retroceder, felicitación', () => {
    expect(feedbackTemplate(bestReq).tone).toBe('elogio');
    expect(feedbackTemplate(bestReq, { retryOf: true }).text).toBe('¡Eso es! [[Nxd4]] corrige el problema.');
  });

  it('Inaccuracy sin interrumpir; "¿Por qué?" da más detalle', () => {
    expect(inaccuracyReq.classification.label).toBe('Inaccuracy');
    expect(inaccuracyReq.policy.offerTakeback).toBe(false);
    const t = feedbackTemplate(inaccuracyReq, { detailed: true });
    expect(t.tone).toBe('advertencia');
    expect(t.text).toContain('imprecisión');
    expect(t.text).toContain('[[Nxf3+]]');
  });

  it('con la mejor jugada revelada la nombra', () => {
    const revealed = { ...mistakeReq, policy: { ...mistakeReq.policy, revealBestMove: true }, classification: { ...mistakeReq.classification, bestMoveSan: 'Nxd4' } };
    expect(feedbackTemplate(revealed).text).toContain('La mejor era [[Nxd4]].');
  });

  it('pistas nivel 1 y 2 sin la casilla de destino', () => {
    const hb = analysis(fenAfter, [[cp(-55), ['d8g5']], [cp(-15), ['d7d5']], [cp(10), ['d8e7']]]);
    const base = { fen: fenAfter, before: hb, ...common, player: { color: 'b', rating: 1495 } };
    expect(hintTemplate(buildHintRequest({ ...base, hintLevel: 1 }))).toBe('Busca un ataque doble.');
    const h2 = hintTemplate(buildHintRequest({ ...base, hintLevel: 2 }));
    expect(h2).toBe('Busca un ataque doble. Mira tu dama de d8.');
    expect(h2).not.toContain('g5');
  });

  it('refutationSentence para mate', () => {
    expect(refutationSentence({ san: 'Qh4#', motif: 'mate', mateIn: 1, targets: [] })).toBe('El rival tiene mate en 1, empezando por [[Qh4#]].');
  });

  it('notación con figuras y segmentos', () => {
    expect(figurine('Nxe5')).toBe('♘xe5');
    expect(figurine('e8=Q+')).toBe('e8=♕+');
    expect(figurine('O-O')).toBe('O-O');
    expect(segmentText('Tras [[Nxe5]] llega [[Qg5]].')).toEqual([
      { type: 'text', value: 'Tras ' },
      { type: 'move', san: 'Nxe5' },
      { type: 'text', value: ' llega ' },
      { type: 'move', san: 'Qg5' },
      { type: 'text', value: '.' },
    ]);
    expect(plainText('[[Qg5]]!')).toBe('♕g5!');
    expect(praiseText('e4', 0)).toContain('[[e4]]');
  });
});

describe('reglas de interrupción', () => {
  it('por defecto solo Mistake/Blunder; preferencias', () => {
    expect(shouldInterrupt(mistakeReq, 'mistakes')).toBe(true);
    expect(shouldInterrupt(inaccuracyReq, 'mistakes')).toBe(false);
    expect(shouldInterrupt(inaccuracyReq, 'inaccuracies')).toBe(true);
    expect(shouldInterrupt(mistakeReq, 'never')).toBe(false);
    expect(wantsAutoLlm(mistakeReq)).toBe(true);
    expect(wantsAutoLlm(inaccuracyReq)).toBe(false);
  });
});

describe('avatar de Alfred', () => {
  it('expresión según el tono', () => {
    expect(moodForTone('elogio')).toBe('feliz');
    expect(moodForTone('alerta')).toBe('preocupado');
    expect(moodForTone('advertencia')).toBe('pensativo');
    expect(moodForTone('neutral')).toBe('neutral');
    expect(moodForTone(undefined)).toBe('neutral');
  });
});

describe('abandono', async () => {
  const { abandonResult, isFinalResult, resultText } = await import('./useGameLoop.js');
  it('pierde quien abandona y Deshacer no lo revierte', () => {
    expect(abandonResult('w')).toEqual({ reason: 'abandon', winner: 'b' });
    expect(resultText(abandonResult('w'), 'w')).toBe('Abandono · Gana el rival (0-1)');
    expect(resultText(abandonResult('b'), 'b')).toBe('Abandono · Gana el rival (1-0)');
    expect(resultText(abandonResult('w'), 'w', getT('en'))).toBe('Resignation · Opponent wins (0-1)');
    expect(resultText({ reason: 'checkmate', winner: 'w' }, 'w', getT('en'))).toBe('Checkmate · You win (1-0)');
    expect(resultText({ reason: 'stalemate', winner: null }, 'w', getT('en'))).toBe('Draw by stalemate · ½-½');
    expect(resultText({ reason: 'raro', winner: null }, 'w')).toBe('Partida terminada · ½-½');
    expect(isFinalResult(abandonResult('w'))).toBe(true);
    expect(isFinalResult({ reason: 'timeout', winner: 'w' })).toBe(true);
    expect(isFinalResult({ reason: 'checkmate', winner: 'w' })).toBe(false);
  });
});

describe('coaches: Alfred, Kairós y Ariadna', async () => {
  const { coachVoice, praiseText } = await import('./templates.js');
  const { validateRequest: validate } = await import('../../shared/coach-contract/index.js');
  it('cada coach tiene su voz; los hechos no cambian', () => {
    const k = feedbackTemplate({ ...mistakeReq, coach: 'kairos' });
    const a = feedbackTemplate({ ...mistakeReq, coach: 'ariadna' });
    expect(k.text).toContain('Aún estás a tiempo');
    expect(a.text).toContain('otro camino');
    // La consecuencia concreta es la misma para los tres.
    for (const t of [k.text, a.text, feedbackTemplate(mistakeReq).text]) expect(t).toContain('[[Qg5]]');
    expect(praiseText('e4', 0, 'kairos')).toBe('¡Justo a tiempo! [[e4]].');
    expect(coachVoice('desconocido')).toBe(coachVoice('alfred'));
  });
  it('el pedido lleva el coach y valida contra el contrato', () => {
    expect(mistakeReq.coach).toBe('alfred');
    expect(validate({ ...mistakeReq, coach: 'ariadna' })).toEqual([]);
    expect(validate({ ...mistakeReq, coach: 'zeus' }).length).toBeGreaterThan(0);
  });
});

describe('plantillas en inglés (req.locale = "en")', async () => {
  const { lossText, whyTemplate, coachVoice, labelText, pieceName, interruptText } = await import('./templates.js');
  const en = (req) => ({ ...req, locale: 'en' });

  it('el CoachRequest lleva el idioma y pasa el schema', async () => {
    const { validateRequest } = await import('../../shared/coach-contract/index.js');
    const req = buildMoveRequest({ ...mistakeReqArgs(), locale: 'en' });
    expect(req.locale).toBe('en');
    expect(validateRequest(req)).toEqual([]);
    expect(mistakeReq.locale).toBe('es');
  });
  it('Mistake: mismos hechos, texto en inglés con la voz de Alfred', () => {
    const t = feedbackTemplate(en(mistakeReq));
    expect(t.tone).toBe('alerta');
    expect(t.text).toBe('[[Nxe5]] is a mistake. Your opponent replies [[Qg5]], hitting your knight on e5 and pawn on g2 at once. Are you sure? You can take it back and look for another move.');
  });
  it('elogios, corrección y voces de los coaches', () => {
    expect(feedbackTemplate(en(bestReq), { retryOf: true }).text).toBe("That's it! [[Nxd4]] fixes the problem.");
    expect(praiseText('e4', 0, 'kairos', 'en')).toBe('Right on time! [[e4]].');
    expect(coachVoice('ariadna', 'en').idle).toBe("Whenever you're ready; we'll go step by step.");
    expect(coachVoice('desconocido', 'en')).toBe(coachVoice('alfred', 'en'));
  });
  it('imprecisión detallada y "¿Por qué?"', () => {
    const t = feedbackTemplate(en(inaccuracyReq), { detailed: true });
    expect(t.text).toContain('inaccuracy');
    expect(t.text).not.toMatch(/rival|jugada/);
    const w = whyTemplate({ ...en(mistakeReq), requestType: 'why' });
    expect(w.text).toMatch(/^\[\[Qg5\]\] attacks two things at once/);
    expect(w.text).toContain('Before you move');
  });
  it('pistas, pérdida de material, etiquetas y piezas', () => {
    const hint = buildHintRequest({ fen: fenBefore, before, hintLevel: 2, ...common, locale: 'en' });
    expect(hint.locale).toBe('en');
    expect(hintTemplate(hint)).toMatch(/^Look (for|at)/);
    expect(lossText({ materialSwing: -4 }, ['n', 'p'], 'en')).toBe('a knight and a pawn');
    expect(lossText({ materialSwing: -1 }, [], 'en')).toBe('≈ 1 pawn of material');
    expect(lossText({ materialSwing: -2 }, ['n'], 'en')).toBe('≈ 2 pawns of material');
    expect(refutationSentence({ san: 'Qh4#', motif: 'mate', mateIn: 1, targets: [] }, 'en')).toBe('Your opponent has mate in 1, starting with [[Qh4#]].');
    expect(labelText('Blunder', 'en')).toBe('Blunder');
    expect(labelText('Blunder', 'es')).toBe('Error grave');
    expect(pieceName('n', 'en')).toBe('knight');
    expect(interruptText('en')).toBe('Careful: this move has a problem. Are you sure?');
  });
});

function mistakeReqArgs() {
  const after = analysis(fenAfter, [[cp(-64), ['d8g5']]]);
  return { classification: classifyMove({ fenBefore, moveUci: 'f3e5', before, after }), before, after, ...common };
}
