// Validación anti-alucinación en el cliente (docs/COACH_DESIGN.md §5.3) y system prompt.
// Antes vivían en el Worker; ahora corren en el navegador con la IA que pone el usuario.
import { describe, expect, it } from 'vitest';
import MOVE_FIXTURE from './fixtures/01-move-feedback-mistake.json';
import HINT_FIXTURE from './fixtures/02-hint-level2.json';
import {
  COACH_IDS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  systemPrompt,
  truncateAtSentence,
  userMessage,
  validateOutput,
  validateRequest,
  compactRequest,
} from './index.js';

const MOVE_REQUEST = MOVE_FIXTURE.request;
const HINT_REQUEST = HINT_FIXTURE.request;

const GOOD_FEEDBACK = {
  comment: 'Ganaste un peón con [[Nxe5]], pero tu caballo en e5 queda sin defensa: el rival responde [[Qg5]] y ataca a la vez el caballo y el peón de g2. ¿Quieres reconsiderar la jugada?',
  tone: 'alerta',
  suggestTakeback: false,
  hint: null,
  question: '¿Qué piezas tuyas quedan sin defensa después de capturar en e5?',
  concepts: ['ataque_doble', 'piezas_sin_defensa'],
  factsUsed: ['refutation.motif'],
};
const GOOD_HINT = {
  comment: '',
  tone: 'neutral',
  suggestTakeback: false,
  hint: 'El caballo que acaba de jugar [[Nxe5]] no tiene defensores. Busca una jugada con tu dama, desde d8, que ataque dos objetivos a la vez.',
  question: null,
  concepts: ['ataque_doble'],
  factsUsed: ['hintFacts.motif'],
};

describe('fixtures del contrato', () => {
  it('las peticiones de ejemplo cumplen el schema', () => {
    expect(validateRequest(MOVE_REQUEST)).toEqual([]);
    expect(validateRequest(HINT_REQUEST)).toEqual([]);
  });
});

describe('validateOutput (§5.3) en el cliente', () => {
  it('1. acepta el ejemplo de §6.2 y 5. sobrescribe suggestTakeback con policy.offerTakeback', () => {
    const r = validateOutput(GOOD_FEEDBACK, MOVE_REQUEST);
    expect(r.ok).toBe(true);
    expect(r.data.suggestTakeback).toBe(true);
    expect(validateOutput({ ...GOOD_FEEDBACK, suggestTakeback: true }, { ...MOVE_REQUEST, policy: { ...MOVE_REQUEST.policy, offerTakeback: false } }).data.suggestTakeback).toBe(false);
  });

  it('acepta la pista de §6.3 con la casilla prohibida fuera del texto', () => {
    expect(validateOutput(GOOD_HINT, HINT_REQUEST, { forbiddenSquares: HINT_FIXTURE.forbiddenSquares }).ok).toBe(true);
  });

  it('1. rechaza salidas que no cumplen el schema', () => {
    expect(validateOutput({ ...GOOD_FEEDBACK, tone: 'eufórico' }, MOVE_REQUEST).ok).toBe(false);
    expect(validateOutput({ comment: 'x' }, MOVE_REQUEST).ok).toBe(false);
    expect(validateOutput({ ...GOOD_FEEDBACK, extra: 1 }, MOVE_REQUEST).ok).toBe(false);
    expect(validateOutput({ ...GOOD_FEEDBACK, concepts: ['a', 'b', 'c', 'd'] }, MOVE_REQUEST).ok).toBe(false);
    expect(validateOutput(null, MOVE_REQUEST).ok).toBe(false);
  });

  it('2. rechaza jugadas entre [[ ]] que no están en allowedMoves', () => {
    const r = validateOutput({ ...GOOD_FEEDBACK, comment: 'Mejor era [[Nxd4]].' }, MOVE_REQUEST);
    expect(r).toMatchObject({ ok: false });
    expect(r.errors[0]).toMatch(/Nxd4/);
    expect(validateOutput({ ...GOOD_FEEDBACK, question: '¿Y [[Bxf7+]]?' }, MOVE_REQUEST).ok).toBe(false);
  });

  it('2b. rechaza SAN fuera de corchetes (incluido el enroque)', () => {
    expect(validateOutput({ ...GOOD_FEEDBACK, comment: 'Tras Qg5 pierdes.' }, MOVE_REQUEST).ok).toBe(false);
    expect(validateOutput({ ...GOOD_FEEDBACK, comment: 'Mejor enrocar con O-O.' }, MOVE_REQUEST).ok).toBe(false);
    expect(validateOutput({ ...GOOD_FEEDBACK, comment: 'Había dxe5 limpio.' }, MOVE_REQUEST).ok).toBe(false);
  });

  it('3. rechaza casillas que no están en allowedSquares', () => {
    expect(validateOutput({ ...GOOD_FEEDBACK, comment: 'Vigila la casilla h7.' }, MOVE_REQUEST).ok).toBe(false);
  });

  it('4. rechaza la casilla de destino de la mejor jugada en una pista (aunque esté permitida)', () => {
    const leaked = { ...GOOD_HINT, hint: 'Lleva la dama a e5.' };
    expect(validateOutput(leaked, HINT_REQUEST).ok).toBe(true);
    expect(validateOutput(leaked, HINT_REQUEST, { forbiddenSquares: ['e5'] }).ok).toBe(false);
  });

  it('6. corta comentarios largos en la última oración completa; en feedback hint = null', () => {
    const long = `${'Primera oración. '.repeat(15)}Y una más que no cabe en el límite de caracteres permitido`;
    const r = validateOutput({ ...GOOD_FEEDBACK, comment: long, hint: 'pista colada' }, MOVE_REQUEST);
    expect(r.ok).toBe(true);
    expect(r.data.comment.length).toBeLessThanOrEqual(300);
    expect(r.data.comment.endsWith('.')).toBe(true);
    expect(r.data.hint).toBeNull();
    expect(truncateAtSentence('corto')).toBe('corto');
  });
});

describe('system prompt en el navegador', () => {
  it('una voz por coach con las mismas reglas de veracidad', () => {
    const prompts = COACH_IDS.map((id) => systemPrompt(id));
    expect(prompts[0]).toContain('«Alfred»');
    expect(prompts[1]).toContain('«Kairós»');
    expect(prompts[2]).toContain('«Ariadna»');
    for (const p of prompts) expect(p).toContain('REGLAS DE VERACIDAD');
    expect(systemPrompt('desconocido')).toBe(SYSTEM_PROMPT);
    expect(PROMPT_VERSION).toBe('coach-v4');
  });

  it('en inglés con locale "en": mismas reglas de veracidad, misma voz y misma validación', () => {
    const en = { ...MOVE_REQUEST, locale: 'en' };
    const prompts = COACH_IDS.map((id) => systemPrompt(id, en));
    expect(prompts[0]).toContain('"Alfred"');
    expect(prompts[1]).toContain('"Kairós"');
    expect(prompts[2]).toContain('"Ariadna"');
    for (const p of prompts) {
      expect(p).toContain('TRUTHFULNESS RULES');
      expect(p).not.toContain('REGLAS DE VERACIDAD');
      // Las 8 reglas y los tonos exactos del schema.
      for (let i = 1; i <= 8; i++) expect(p).toContain(`\n${i}. `);
      for (const tone of ['"elogio"', '"neutral"', '"advertencia"', '"alerta"']) expect(p).toContain(tone);
      expect(p).toContain('allowedMoves');
      expect(p).toContain('allowedSquares');
      expect(p).toContain('policy.revealBestMove');
    }
    // El prompt en español sigue igual para "es" o sin locale.
    expect(systemPrompt('alfred', MOVE_REQUEST)).toContain('REGLAS DE VERACIDAD');
    expect(systemPrompt('alfred', { ...MOVE_REQUEST, locale: 'es' })).toBe(systemPrompt('alfred', MOVE_REQUEST));
    const msg = userMessage(en);
    expect(msg.startsWith('Facts (requestType=move_feedback):\n')).toBe(true);
    expect(JSON.parse(msg.slice(msg.indexOf('\n') + 1))).toEqual(compactRequest(en));
  });

  it('el mensaje de usuario lleva solo los hechos compactos', () => {
    const msg = userMessage(MOVE_REQUEST);
    expect(msg.startsWith('Hechos (requestType=move_feedback):\n')).toBe(true);
    expect(JSON.parse(msg.slice(msg.indexOf('\n') + 1))).toEqual(compactRequest(MOVE_REQUEST));
    expect(msg.split('\n')).toHaveLength(2); // JSON en una línea, sin sangrías
  });
});
