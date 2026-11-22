import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove } from '../engine/classify.js';
import { winPercent } from '../engine/uci.js';
import {
  coachFacts,
  evalLabel,
  isGreatMove,
  needsDeepConfirmation,
  playedRank,
  shouldOfferTakeback,
} from './enrich.js';

const cp = (value) => ({ type: 'cp', value });
const mate = (value, winner) => ({ type: 'mate', value, winner });

const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
const applyUci = (fen, uci) => {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
};

/** Análisis sintético; `lines` = [[score, pv], …] en orden de MultiPV. */
const analysis = (fen, lines, depth = 15) => ({
  fen,
  depth,
  bestMove: lines[0]?.[1]?.[0] ?? null,
  lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth, score, pv })),
});

/** Clasifica `moveUci` desde `fenBefore` con MultiPV previo y eval posterior sintéticos. */
const classified = (fenBefore, moveUci, beforeLines, afterScore) => {
  const before = analysis(fenBefore, beforeLines);
  const fenAfter = applyUci(fenBefore, moveUci);
  const after = analysis(fenAfter, [[afterScore, []]]);
  return { before, classification: classifyMove({ fenBefore, moveUci, before, after }) };
};

describe('evalLabel', () => {
  it('aplica los cortes de §4.2 (cota inferior incluida)', () => {
    expect(evalLabel(100)).toBe('ganando');
    expect(evalLabel(90)).toBe('ganando');
    expect(evalLabel(89.9)).toBe('ventaja clara');
    expect(evalLabel(70)).toBe('ventaja clara');
    expect(evalLabel(69.9)).toBe('ligera ventaja');
    expect(evalLabel(57)).toBe('ligera ventaja');
    expect(evalLabel(56.9)).toBe('igualdad');
    expect(evalLabel(50)).toBe('igualdad');
    expect(evalLabel(43)).toBe('igualdad');
    expect(evalLabel(42.9)).toBe('ligera desventaja');
    expect(evalLabel(30)).toBe('ligera desventaja');
    expect(evalLabel(29.9)).toBe('desventaja clara');
    expect(evalLabel(10)).toBe('desventaja clara');
    expect(evalLabel(9.9)).toBe('perdiendo');
    expect(evalLabel(0)).toBe('perdiendo');
  });
});

describe('coachFacts: etiquetas de evaluación en ambos colores', () => {
  const fenW = play(['e4', 'e5']); // juegan blancas

  it('blancas: +3 → ventaja clara para el jugador', () => {
    const { classification } = classified(fenW, 'g1f3', [[cp(300), ['g1f3']]], cp(300));
    const f = coachFacts(classification);
    expect(f.evalLabelBefore).toBe('ventaja clara');
    expect(f.evalLabelAfter).toBe('ventaja clara');
  });

  it('negras: la misma eval (+3 para blancas) es desventaja clara para el jugador', () => {
    const fenB = play(['Nf3'], fenW); // juegan negras
    const { classification } = classified(fenB, 'b8c6', [[cp(300), ['b8c6']]], cp(300));
    expect(classification.color).toBe('b');
    const f = coachFacts(classification);
    expect(f.evalLabelBefore).toBe('desventaja clara');
    expect(f.evalLabelAfter).toBe('desventaja clara');
  });

  it('negras: mate a favor de negras → ganando; mate de blancas → perdiendo', () => {
    const fenB = play(['Nf3'], fenW);
    const { classification } = classified(fenB, 'b8c6', [[mate(-3, 'b'), ['b8c6']]], mate(4, 'w'));
    const f = coachFacts(classification);
    expect(f.evalLabelBefore).toBe('ganando');
    expect(f.evalLabelAfter).toBe('perdiendo');
  });
});

describe('greatMove y playedRank (MultiPV sintético)', () => {
  const fenW = play(['e4', 'e5']);

  it('la mejor con la 2.ª línea ≥ 10 pp peor es gran jugada', () => {
    const { before, classification } = classified(
      fenW,
      'g1f3',
      [
        [cp(250), ['g1f3']],
        [cp(0), ['b1c3']],
        [cp(-50), ['d2d4']],
      ],
      cp(250),
    );
    // Brecha en Win% de blancas: winPercent(250) − winPercent(0) ≈ 21,5 pp.
    expect(winPercent(cp(250)) - winPercent(cp(0))).toBeGreaterThan(10);
    const f = coachFacts(classification, { before });
    expect(classification.label).toBe('Best');
    expect(f.greatMove).toBe(true);
    expect(f.playedRank).toBe(1);
  });

  it('no es gran jugada si la 2.ª línea está cerca', () => {
    const { before, classification } = classified(
      fenW,
      'g1f3',
      [
        [cp(40), ['g1f3']],
        [cp(30), ['b1c3']],
      ],
      cp(40),
    );
    expect(coachFacts(classification, { before }).greatMove).toBe(false);
  });

  it('no es gran jugada si no es la mejor, aunque esté en el MultiPV', () => {
    const { before, classification } = classified(
      fenW,
      'b1c3',
      [
        [cp(250), ['g1f3']],
        [cp(0), ['b1c3']],
        [cp(-50), ['d2d4']],
      ],
      cp(0),
    );
    const f = coachFacts(classification, { before });
    expect(f.greatMove).toBe(false);
    expect(f.playedRank).toBe(2);
  });

  it('sin 2.ª línea (MultiPV 1) no se puede afirmar que sea la única buena', () => {
    const { before, classification } = classified(fenW, 'g1f3', [[cp(250), ['g1f3']]], cp(250));
    expect(isGreatMove(classification, before)).toBe(false);
    expect(isGreatMove(classification, null)).toBe(false);
  });

  it('perspectiva de negras: la brecha se mide en el Win% del jugador', () => {
    const fenB = play(['Nf3'], fenW);
    const { before, classification } = classified(
      fenB,
      'b8c6',
      [
        [cp(-250), ['b8c6']], // bueno para negras
        [cp(0), ['d7d6']],
      ],
      cp(-250),
    );
    expect(coachFacts(classification, { before }).greatMove).toBe(true);
  });

  it('una recaptura en la casilla de la última captura del rival no es gran jugada', () => {
    // 1.e4 d5 2.exd5: negras recapturan en d5.
    const fenB = play(['e4', 'd5', 'exd5']);
    const lines = [
      [cp(30), ['d8d5']],
      [cp(250), ['g8f6']],
    ];
    const { before, classification } = classified(fenB, 'd8d5', lines, cp(30));
    expect(classification.isBest).toBe(true);
    const lastRivalMove = { san: 'exd5', piece: 'p', to: 'd5', capture: 'p' };
    expect(coachFacts(classification, { before, lastRivalMove }).greatMove).toBe(false);
    // Sin la jugada del rival como contexto sí lo sería.
    expect(coachFacts(classification, { before }).greatMove).toBe(true);
    // Si la jugada del rival a esa casilla no fue captura, no es recaptura.
    expect(isGreatMove(classification, before, { to: 'd5', capture: null })).toBe(true);
  });

  it('playedRank es null fuera de las 3 primeras líneas', () => {
    const before = analysis(fenW, [
      [cp(30), ['g1f3']],
      [cp(25), ['b1c3']],
      [cp(20), ['d2d4']],
      [cp(10), ['f1c4']],
    ]);
    expect(playedRank(before, 'd2d4')).toBe(3);
    expect(playedRank(before, 'f1c4')).toBeNull();
    expect(playedRank(before, 'a2a3')).toBeNull();
    expect(playedRank(null, 'g1f3')).toBeNull();
  });
});

describe('stillWinning', () => {
  const fenW = play(['e4', 'e5']);

  it('true si antes y después el jugador está ≥ 90 (aunque pierda un mate)', () => {
    // M3 → +7: Win% 100 → ≈ 92,9; pérdida ≈ 7,1 pp (Inaccuracy). Con ambos ≥ 90 la pérdida
    // nunca supera 10 pp, así que stillWinning no coincide con Mistake/Blunder (ver informe).
    const { classification } = classified(fenW, 'a2a3', [[mate(3, 'w'), ['g1f3']]], cp(700));
    expect(classification.winBefore).toBe(100);
    expect(classification.winAfter).toBeGreaterThanOrEqual(90);
    expect(classification.label).toBe('Inaccuracy');
    const f = coachFacts(classification);
    expect(f.stillWinning).toBe(true);
    expect(f.mateMissed).toBe(true);
  });

  it('false si después baja de 90', () => {
    const { classification } = classified(fenW, 'a2a3', [[cp(900), ['g1f3']]], cp(300));
    expect(coachFacts(classification).stillWinning).toBe(false);
  });

  it('con stillWinning no se ofrece retroceder en Mistake/Blunder, salvo mate concedido', () => {
    const facts = { stillWinning: true, mateAllowed: false };
    expect(shouldOfferTakeback({ label: 'Blunder' }, facts)).toBe(false);
    expect(shouldOfferTakeback({ label: 'Mistake' }, { ...facts, stillWinning: false })).toBe(true);
    expect(shouldOfferTakeback({ label: 'Inaccuracy' }, { ...facts, stillWinning: false })).toBe(false);
    expect(shouldOfferTakeback({ label: 'Good' }, { stillWinning: false, mateAllowed: true })).toBe(true);
  });
});

describe('mateAllowed / mateMissed con Score de mate (winner)', () => {
  it('1.f3 e5 2.g4??: concede mate (evalAfter mate de negras, antes no)', () => {
    const fenB = play(['f3', 'e5']);
    const { classification } = classified(fenB, 'g2g4', [[cp(-90), ['e2e4']]], mate(-1, 'b'));
    const f = coachFacts(classification);
    expect(f.mateAllowed).toBe(true);
    expect(f.mateMissed).toBe(false);
    expect(f.evalLabelAfter).toBe('perdiendo');
    expect(shouldOfferTakeback(classification, f)).toBe(true);
  });

  it('no es mateAllowed si ya se recibía mate antes de mover', () => {
    const f = coachFacts({
      color: 'w',
      moveUci: 'e2e4',
      isBest: false,
      evalBefore: mate(-3, 'b'),
      evalAfter: mate(-2, 'b'),
      winBefore: 0,
      winAfter: 0,
    });
    expect(f.mateAllowed).toBe(false);
    expect(f.mateMissed).toBe(false);
  });

  it('negras: mate de blancas tras la jugada es mateAllowed para negras', () => {
    const f = coachFacts({
      color: 'b',
      moveUci: 'e7e5',
      isBest: false,
      evalBefore: cp(50),
      evalAfter: mate(2, 'w'),
      winBefore: 100 - winPercent(cp(50)),
      winAfter: 0,
    });
    expect(f.mateAllowed).toBe(true);
    // Un mate a favor del rival antes de mover es lo contrario de mateMissed.
    expect(f.mateMissed).toBe(false);
  });

  it('mateMissed: tenía mate y la jugada lo deja escapar', () => {
    const f = coachFacts({
      color: 'b',
      moveUci: 'e7e5',
      isBest: false,
      evalBefore: mate(-2, 'b'),
      evalAfter: cp(-600),
      winBefore: 100,
      winAfter: 100 - winPercent(cp(-600)),
    });
    expect(f.mateMissed).toBe(true);
    expect(f.mateAllowed).toBe(false);
    expect(f.stillWinning).toBe(true);
  });

  it('dar mate (mate 0 a favor) o alargarlo no es mateMissed', () => {
    const fenB = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1';
    const { classification } = classified(fenB, 'a1a8', [[mate(1, 'w'), ['d1d8']]], mate(0, 'w'));
    expect(coachFacts(classification).mateMissed).toBe(false);
    const longer = coachFacts({ ...classification, evalAfter: mate(5, 'w') });
    expect(longer.mateMissed).toBe(false);
  });

  it('pasar de tener mate a recibirlo marca ambas banderas', () => {
    const f = coachFacts({
      color: 'w',
      moveUci: 'e2e4',
      isBest: false,
      evalBefore: mate(2, 'w'),
      evalAfter: mate(-1, 'b'),
      winBefore: 100,
      winAfter: 0,
    });
    expect(f.mateAllowed).toBe(true);
    expect(f.mateMissed).toBe(true);
  });
});

describe('fixture §4.4 / §6.2 (1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5?)', () => {
  it('produce los coachFacts del contrato de ejemplo', () => {
    const fenBefore = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
    const { before, classification } = classified(
      fenBefore,
      'f3e5',
      [
        [cp(104), ['f3d4']],
        [cp(96), ['e1g1']],
        [cp(54), ['b1c3']],
      ],
      cp(-64),
    );
    expect(classification.label).toBe('Mistake');
    expect(classification.moveSan).toBe('Nxe5');
    expect(classification.winBefore).toBeCloseTo(59.5, 1);
    expect(classification.winAfter).toBeCloseTo(44.1, 1);
    const lastRivalMove = { san: 'Nd4', piece: 'n', to: 'd4', capture: null };
    const f = coachFacts(classification, { before, lastRivalMove });
    expect(f).toEqual({
      greatMove: false,
      playedRank: null,
      stillWinning: false,
      mateAllowed: false,
      mateMissed: false,
      evalLabelBefore: 'ligera ventaja',
      evalLabelAfter: 'igualdad',
    });
    expect(shouldOfferTakeback(classification, f)).toBe(true);
    expect(needsDeepConfirmation(classification)).toBe(false); // 15,3 ≥ 10 + 3
  });
});

describe('needsDeepConfirmation', () => {
  it('solo Mistake/Blunder a menos de 3 pp de su umbral inferior', () => {
    expect(needsDeepConfirmation({ label: 'Mistake', loss: 10.5 })).toBe(true);
    expect(needsDeepConfirmation({ label: 'Mistake', loss: 12.99 })).toBe(true);
    expect(needsDeepConfirmation({ label: 'Mistake', loss: 13 })).toBe(false);
    expect(needsDeepConfirmation({ label: 'Blunder', loss: 21 })).toBe(true);
    expect(needsDeepConfirmation({ label: 'Blunder', loss: 23.5 })).toBe(false);
    expect(needsDeepConfirmation({ label: 'Inaccuracy', loss: 6 })).toBe(false);
    expect(needsDeepConfirmation({ label: 'Best', loss: 0 })).toBe(false);
  });
});
