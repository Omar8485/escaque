import { describe, it, expect } from 'vitest';
import { PERSONALITIES, REQUIRED_EVENTS, RIVAL_EVENTS, MAX_LINE_LENGTH, getPersonality } from './personalities.js';
import { RIVAL_LEVELS } from '../engine/rivalLevels.js';
import { fillTemplate, speechText } from './voice.js';
import { PERSONALITIES_EN } from './personalities.en.js';

// Una jugada SAN larga para medir el peor caso de `{move}`.
const LONG_SAN = 'Nbxd7+';

describe('personalidades de los rivales', () => {
  it('hay una personalidad por cada rival, con su mismo nivel y nombre', () => {
    expect(PERSONALITIES.map((p) => [p.level, p.name])).toEqual(RIVAL_LEVELS.map((l) => [l.level, l.name]));
    for (const p of PERSONALITIES) expect(p.trait.length).toBeGreaterThan(10);
  });

  it('cada rival tiene al menos 4 frases por evento obligatorio (y por player_good_move si lo define)', () => {
    for (const p of PERSONALITIES) {
      for (const e of REQUIRED_EVENTS) expect(p.lines[e]?.length ?? 0, `${p.name} · ${e}`).toBeGreaterThanOrEqual(4);
      for (const e of Object.keys(p.lines)) expect(RIVAL_EVENTS, `${p.name}: evento desconocido ${e}`).toContain(e);
      if (p.lines.player_good_move) expect(p.lines.player_good_move.length).toBeGreaterThanOrEqual(4);
    }
  });

  it(`frases breves (≤ ${MAX_LINE_LENGTH} caracteres con {move} sustituido) y no vacías`, () => {
    for (const p of PERSONALITIES) {
      for (const [e, lines] of Object.entries(p.lines)) {
        for (const line of lines) {
          const text = fillTemplate(line, { move: LONG_SAN });
          expect(text, `${p.name} · ${e}: ${line}`).not.toBeNull();
          expect(text.trim().length).toBeGreaterThan(5);
          expect(text.length, `${p.name} · ${e}: ${line}`).toBeLessThanOrEqual(MAX_LINE_LENGTH);
          expect(text, 'sin espacios sobrantes').toBe(text.trim());
        }
      }
    }
  });

  it('ninguna frase se repite (ni dentro de un rival ni entre rivales)', () => {
    const seen = new Map();
    for (const p of PERSONALITIES) {
      for (const [e, lines] of Object.entries(p.lines)) {
        for (const line of lines) {
          const k = line.toLowerCase();
          expect(seen.has(k), `"${line}" repetida (${seen.get(k)} y ${p.name} · ${e})`).toBe(false);
          seen.set(k, `${p.name} · ${e}`);
        }
      }
    }
  });

  it('solo usa la variable {move}, y solo en eventos con jugada', () => {
    for (const p of PERSONALITIES) {
      for (const [e, lines] of Object.entries(p.lines)) {
        for (const line of lines) {
          const vars = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
          for (const v of vars) expect(v).toBe('move');
          if (vars.length) expect(['rival_good_move', 'player_mistake', 'player_blunder', 'player_good_move']).toContain(e);
        }
      }
    }
  });

  it('cada evento tiene al menos una frase sin {move} (por si no hay jugada)', () => {
    for (const p of PERSONALITIES) {
      for (const [e, lines] of Object.entries(p.lines)) {
        expect(lines.some((l) => !l.includes('{')), `${p.name} · ${e}`).toBe(true);
      }
    }
  });

  it('sin palabras ofensivas', () => {
    const banned = /\b(idiota|estúpid|tont[oa]|imbécil|inútil|patétic|ridícul|perdedor|burr[oa]|torpe|malísim)/i;
    for (const p of PERSONALITIES) for (const lines of Object.values(p.lines)) for (const l of lines) expect(l).not.toMatch(banned);
  });

  it('las personalidades son inmutables y getPersonality valida el nivel', () => {
    expect(Object.isFrozen(getPersonality(1).lines.game_start)).toBe(true);
    expect(getPersonality(10).name).toBe('Atenea');
    expect(() => getPersonality(11)).toThrow(RangeError);
  });
});

describe('personalidades en inglés (paridad con el español)', () => {
  const EN = PERSONALITIES.map((p) => getPersonality(p.level, 'en'));

  it('mismo nivel y nombre (nombre propio, sin traducir) y rasgo en inglés', () => {
    expect(Object.keys(PERSONALITIES_EN).map(Number)).toEqual(PERSONALITIES.map((p) => p.level));
    for (const [i, p] of EN.entries()) {
      expect([p.level, p.name]).toEqual([PERSONALITIES[i].level, PERSONALITIES[i].name]);
      expect(p.trait.length).toBeGreaterThan(10);
      expect(p.trait).not.toBe(PERSONALITIES[i].trait);
    }
  });

  it('mismos eventos, mismo número de frases y {move} en los mismos índices', () => {
    for (const [i, en] of EN.entries()) {
      const es = PERSONALITIES[i];
      expect(Object.keys(en.lines).sort(), es.name).toEqual(Object.keys(es.lines).sort());
      for (const [e, lines] of Object.entries(es.lines)) {
        expect(en.lines[e].length, `${es.name} · ${e}`).toBe(lines.length);
        const movesEs = lines.map((l) => l.includes('{move}'));
        const movesEn = en.lines[e].map((l) => l.includes('{move}'));
        expect(movesEn, `${es.name} · ${e}`).toEqual(movesEs);
      }
    }
  });

  it(`frases breves (≤ ${MAX_LINE_LENGTH}), solo {move}, sin repetir y distintas del español`, () => {
    const seen = new Set();
    for (const [i, p] of EN.entries()) {
      for (const [e, lines] of Object.entries(p.lines)) {
        for (const [j, line] of lines.entries()) {
          const text = fillTemplate(line, { move: LONG_SAN });
          expect(text, `${p.name} · ${e}: ${line}`).not.toBeNull();
          expect(text.length, `${p.name} · ${e}: ${line}`).toBeLessThanOrEqual(MAX_LINE_LENGTH);
          expect(text).toBe(text.trim());
          for (const m of line.matchAll(/\{(\w+)\}/g)) expect(m[1]).toBe('move');
          expect(seen.has(line.toLowerCase()), `"${line}" repetida`).toBe(false);
          seen.add(line.toLowerCase());
          expect(line, 'no quedó en español').not.toBe(PERSONALITIES[i].lines[e][j]);
          expect(line, `${p.name} · ${e}: sin signos de apertura españoles`).not.toMatch(/[¿¡ñ]/);
        }
      }
    }
  });

  it('sin palabras ofensivas', () => {
    const banned = /\b(idiot|stupid|dumb|moron|loser|pathetic|useless|hopeless|suck|shut up|hate|kill|damn)\b/i;
    for (const p of EN) for (const lines of Object.values(p.lines)) for (const l of lines) expect(l).not.toMatch(banned);
  });

  it('inmutables; un idioma desconocido vuelve al español', () => {
    expect(Object.isFrozen(getPersonality(3, 'en').lines.draw)).toBe(true);
    expect(getPersonality(3, 'fr')).toBe(getPersonality(3));
    expect(() => getPersonality(0, 'en')).toThrow(RangeError);
  });

  it('speechText muestra la misma frase en el otro idioma (con su jugada)', () => {
    const speech = { level: 1, event: 'rival_good_move', index: 0, move: 'Nc6', text: '¡Nc6! ¿Viste qué alto vuelo?' };
    expect(speechText(speech, 'en')).toBe('Nc6! Did you see how high I flew?');
    expect(speechText(speech, 'es')).toBe('¡Nc6! ¿Viste qué alto vuelo?');
    expect(speechText({ text: 'antigua' }, 'en'), 'sin índice: texto original').toBe('antigua');
  });
});
