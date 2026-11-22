import { describe, it, expect } from 'vitest';
import { mobilePlayLayout, coachLine, coachAwaitsDecision, LANDSCAPE_COLUMN_MIN } from './playLayout.js';

describe('mobilePlayLayout', () => {
  it('vertical a 360 px: tablero ≥ 94 % del ancho de la pantalla (A2)', () => {
    // Contenedor: 360 − 2×12 de relleno + 2×8 de margen negativo = 352; alto libre ≈ 740 − 64 − 12 − 56.
    const l = mobilePlayLayout({ width: 352, height: 608, landscape: false });
    expect(l.mode).toBe('portrait');
    expect(l.side).toBe(344);
    expect(l.side / 360).toBeGreaterThanOrEqual(0.94);
  });

  it('vertical bajo: el alto limita el tablero (barras, coach y controles caben)', () => {
    const l = mobilePlayLayout({ width: 400, height: 500, landscape: false });
    // 500 − (2×38) − (8+56) − (8+44) = 308
    expect(l.side).toBe(308);
  });

  it('horizontal 740×360: el tablero cabe en el alto y deja la columna derecha (A6)', () => {
    const l = mobilePlayLayout({ width: 732, height: 228, landscape: true });
    expect(l.mode).toBe('landscape');
    expect(l.side).toBe(228);
    expect(l.columnWidth).toBeGreaterThanOrEqual(LANDSCAPE_COLUMN_MIN);
  });

  it('horizontal estrecho: el ancho manda y la columna conserva su mínimo', () => {
    const l = mobilePlayLayout({ width: 500, height: 400, landscape: true });
    expect(l.side).toBe(500 - LANDSCAPE_COLUMN_MIN - 8);
    expect(l.columnWidth).toBe(LANDSCAPE_COLUMN_MIN);
  });
});

const coachWith = (view, extra = {}) => ({ active: true, interrupting: false, hint: null, view, ...extra });

describe('coachLine', () => {
  it('interrupción: pide decidir (Retroceder / ¿Por qué? / Seguir)', () => {
    const c = coachWith({ state: 'feedback', moveSan: 'Qh5', label: 'Blunder', text: 'Cuelgas la dama.' }, { interrupting: true });
    expect(coachAwaitsDecision(c)).toBe(true);
    expect(coachLine({ coach: c, isPlayerTurn: false })).toEqual({ kind: 'decide', san: 'Qh5', label: 'Blunder', text: 'Cuelgas la dama.' });
    // Mientras piensa el texto, también espera la decisión.
    expect(coachLine({ coach: coachWith({ state: 'thinking', moveSan: 'Qh5' }, { interrupting: true }), isPlayerTurn: false }).kind).toBe('decide');
  });

  it('la pista manda en tu turno; fuera de tu turno no', () => {
    const c = coachWith({ state: 'feedback', text: 'Bien.' }, { hint: { level: 1, text: 'Mira el centro.' } });
    expect(coachLine({ coach: c, isPlayerTurn: true })).toEqual({ kind: 'hint', text: 'Mira el centro.' });
    expect(coachLine({ coach: c, isPlayerTurn: false }).kind).toBe('feedback');
    expect(coachLine({ coach: coachWith({ state: 'idle' }, { hint: { level: 2, thinking: true } }), isPlayerTurn: true })).toEqual({ kind: 'hint', text: undefined });
  });

  it('comentario, análisis, error, reposo y apagado', () => {
    expect(coachLine({ coach: coachWith({ state: 'feedback', text: 'T', moveSan: 'e4', label: 'Best', greatMove: true, tone: 'elogio' }), isPlayerTurn: true })).toEqual({
      kind: 'feedback', text: 'T', san: 'e4', label: 'Best', greatMove: true, tone: 'elogio',
    });
    expect(coachLine({ coach: coachWith({ state: 'analyzing', moveSan: 'Nf3' }), isPlayerTurn: false })).toEqual({ kind: 'analyzing', san: 'Nf3' });
    expect(coachLine({ coach: coachWith({ state: 'error', text: 'x' }), isPlayerTurn: true })).toEqual({ kind: 'error', text: 'x' });
    expect(coachLine({ coach: coachWith({ state: 'idle' }), isPlayerTurn: true })).toEqual({ kind: 'idle' });
    expect(coachLine({ coach: coachWith({ state: 'off' }, { active: false }), isPlayerTurn: true })).toEqual({ kind: 'off' });
    expect(coachLine({ coach: null, isPlayerTurn: true })).toEqual({ kind: 'off' });
  });
});
