// Línea de refutación de "¿Por qué?": PV de Stockfish → SAN numerada, corte y hechos.
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  buildRefutationLine,
  cutPoint,
  extendLine,
  formatLine,
  lineContract,
  lineFens,
  lineSquares,
  needsExtension,
  netLoss,
  numberedMoves,
} from './refutationLine.js';
import { lossText, whyTemplate } from './templates.js';

const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5? Qg5! (trampa de Blackburne-Kostić)
const fenAfter = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5']);
const MATE_PV = ['d8g5', 'e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3'];

describe('línea de refutación', () => {
  it('SAN numerada desde la jugada del rival y hasta el mate', () => {
    const line = buildRefutationLine({ fenAfter, pv: MATE_PV, score: { type: 'mate', value: -4, winner: 'b' } });
    expect(formatLine(line)).toBe('4…Qg5 5.Nxf7 Qxg2 6.Rf1 Qxe4+ 7.Be2 Nf3#');
    expect(line).toMatchObject({ startColor: 'b', startMoveNumber: 4, mate: true, mateIn: 4 });
    expect(numberedMoves(line).map((m) => m.prefix)).toEqual(['4…', '5.', '', '6.', '', '7.', '']);
    expect(lineFens(line)).toHaveLength(8);
    expect(lineFens(line)[0]).toBe(fenAfter);
  });

  it('material: lo que te capturan y lo que capturas', () => {
    const line = buildRefutationLine({ fenAfter, pv: ['d8g5', 'e5f7', 'g5g2', 'h1f1'] });
    expect(line.moves).toHaveLength(4);
    expect(line.playerLost).toEqual(['p']); // Qxg2
    expect(line.rivalLost).toEqual(['p']); // Nxf7
    expect(line.materialSwing).toBe(0);
    expect(netLoss(line)).toEqual([]);
    expect(lineContract(line)).toEqual({ san: ['Qg5', 'Nxf7', 'Qxg2', 'Rf1'], startMoveNumber: 4, mate: false, mateIn: null, materialSwing: 0, playerLost: ['p'], rivalLost: ['p'] });
    expect(lineSquares(line)).toEqual(['d8', 'g5', 'e5', 'f7', 'g5', 'g2', 'h1', 'f1']);
  });

  it('se detiene en la primera jugada ilegal de la PV', () => {
    const line = buildRefutationLine({ fenAfter, pv: ['d8g5', 'a1a8', 'g5g2'] });
    expect(line.moves.map((m) => m.san)).toEqual(['Qg5']);
    expect(buildRefutationLine({ fenAfter, pv: ['a1a8'] })).toBeNull();
  });

  it('corta en un punto tranquilo entre 4 y 8 plies (no a mitad de un cambio)', () => {
    const mk = (caps) => caps.map((c) => ({ captured: c ? 'p' : null, mate: false }));
    expect(cutPoint(mk([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(8);
    expect(cutPoint(mk([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]))).toBe(7); // la 9.ª captura: corta antes de la 8.ª
    expect(cutPoint(mk([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]))).toBe(4);
    expect(cutPoint(mk([0, 0, 0, 0, 1, 1, 1, 1, 1, 0]))).toBe(8); // sin punto tranquilo: el máximo
    expect(cutPoint(mk([0, 0]))).toBe(2);
    expect(cutPoint([{ captured: null, mate: false }, { captured: null, mate: true }, { captured: null, mate: false }])).toBe(2);
  });

  it('PV corta → hay que alargarla con el motor; extendLine la une', () => {
    const short = buildRefutationLine({ fenAfter, pv: ['d8g5', 'e5f7'] });
    expect(needsExtension(short)).toBe(true);
    const long = extendLine(short, ['g5g2', 'h1f1', 'g2e4']);
    expect(long.moves.map((m) => m.san)).toEqual(['Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+']);
    expect(needsExtension(long)).toBe(false);
  });
});

describe('plantilla de "¿Por qué?"', () => {
  const base = {
    classification: { label: 'Mistake', moveSan: 'Nxe5' },
    coachFacts: { evalLabelBefore: 'ligera ventaja', evalLabelAfter: 'igualdad', stillWinning: false },
    refutation: { san: 'Qg5', to: 'g5', motif: 'ataque_doble', captures: null, targets: [{ square: 'e5', piece: 'n', defended: false }, { square: 'g2', piece: 'p', defended: false }] },
    hanging: [],
  };

  it('explica el mecanismo, el resultado de la línea y una idea; no repite "es un error"', () => {
    const line = buildRefutationLine({ fenAfter, pv: MATE_PV, score: { type: 'mate', value: -4, winner: 'b' } });
    const t = whyTemplate({ ...base, refutationLine: lineContract(line) }, { netLoss: netLoss(line) });
    expect(t.text).toBe('[[Qg5]] ataca dos cosas a la vez (tu caballo de e5 y peón de g2) y no puedes salvar ambas. Si sigues esa línea, el rival da mate en 4. Antes de mover, mira qué piezas tuyas quedan sin defensa y si una sola jugada rival puede atacar dos.');
    expect(t.text).not.toContain('es un error');
    expect(t.tone).toBe('alerta');
  });

  it('pérdida de material en palabras', () => {
    expect(lossText({ materialSwing: -3 }, ['n'])).toBe('un caballo');
    expect(lossText({ materialSwing: -4 }, ['n', 'p'])).toBe('un caballo y un peón');
    expect(lossText({ materialSwing: -2 }, ['n'])).toBe('≈ 2 peones de material');
    expect(lossText({ materialSwing: 0 }, [])).toBeNull();
    const t = whyTemplate({ ...base, refutationLine: { san: ['Qg5'], mate: false, materialSwing: -3, playerLost: ['n'], rivalLost: [] } }, { netLoss: ['n'] });
    expect(t.text).toContain('Al final de la línea pierdes un caballo.');
  });

  it('sin pérdida de material: cuenta el cambio de evaluación', () => {
    const t = whyTemplate({ ...base, refutationLine: { san: ['Qg5'], mate: false, materialSwing: 0, playerLost: [], rivalLost: [] } });
    expect(t.text).toContain('No pierdes material, pero la posición pasa de ligera ventaja a igualdad.');
  });
});
