import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { materialSummary } from './material.js';
import { boardLayout, MIN_SIDE } from './boardLayout.js';

const play = (sans) => {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
};

describe('materialSummary', () => {
  it('posición inicial: nada capturado, sin ventaja', () => {
    expect(materialSummary(new Chess().fen())).toEqual({ w: { captured: [], advantage: 0 }, b: { captured: [], advantage: 0 } });
  });

  it('blancas capturan un peón: +1', () => {
    const s = materialSummary(play(['e4', 'd5', 'exd5']));
    expect(s.w).toEqual({ captured: ['p'], advantage: 1 });
    expect(s.b).toEqual({ captured: [], advantage: 0 });
  });

  it('cambio desigual: ambas capturas visibles, ventaja neta del que va por delante', () => {
    // Negras perdieron 2 peones y 2 torres (12); blancas, un caballo (3) → blancas +9.
    const s = materialSummary('1nbqkbn1/2pppppp/8/8/8/8/PPPPPPPP/R1BQKBNR w KQ - 0 1');
    expect(s.w).toEqual({ captured: ['p', 'p', 'r', 'r'], advantage: 9 });
    expect(s.b).toEqual({ captured: ['n'], advantage: 0 });
  });

  it('promoción: la dama extra se compensa en la ventaja', () => {
    // Blancas: 7 P, 2 C, 2 A, 1 T, 2 D = 42. Negras: 7 P, 2 C, 2 A, 2 T, 1 D = 38 → blancas +4.
    // La dama coronada no figura como "capturada" por negras (no puede ser negativo).
    const s = materialSummary('rnbqkbnr/ppppppp1/8/8/8/8/PPPPPPP1/RNBQKBNQ w Qkq - 0 1');
    expect(s.w).toEqual({ captured: ['p'], advantage: 4 });
    expect(s.b.captured).toEqual(['p', 'r']);
  });
});

describe('boardLayout', () => {
  const base = { fitHeight: true, hasAside: true, viewportHeight: 800 };
  it('sin barras: controles al lado en pantallas apaisadas, debajo en verticales', () => {
    expect(boardLayout({ ...base, width: 900, height: 500 })).toMatchObject({ controls: 'side', bars: 'edges' });
    expect(boardLayout({ ...base, width: 500, height: 900 })).toMatchObject({ controls: 'below', bars: 'edges' });
  });
  it('pantalla holgada: barras encima y debajo (restan alto)', () => {
    const a = boardLayout({ ...base, width: 1056, height: 846 });
    const b = boardLayout({ ...base, width: 1056, height: 846, barsHeight: 76 });
    expect(b).toMatchObject({ bars: 'edges' });
    expect(b.side).toBe(a.side - 76);
  });
  it('pantalla baja y ancha (portátil al 125 %): barras en la columna lateral', () => {
    const b = boardLayout({ ...base, width: 622, height: 402, barsHeight: 76 });
    expect(b).toMatchObject({ bars: 'column', controls: 'column' });
    expect(b.side).toBe(394); // limita el ancho: 622 − 32 (barra de evaluación) − 184 − 12
  });
  it('nunca menos del mínimo', () => {
    expect(boardLayout({ ...base, width: 100, height: 100 }).side).toBe(MIN_SIDE);
  });
});
