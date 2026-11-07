// Presupuesto de tokens por tipo de petición (v1.1, docs/COACH_DESIGN.md §7.8).
// Estimación ≈ caracteres / 3,6 (src/llm/usage.js). Con TOKEN_REPORT=1 imprime la tabla antes/después:
//   TOKEN_REPORT=1 npx vitest run shared/coach-contract/tokenBudget.test.js
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import MOVE_FIXTURE from './fixtures/01-move-feedback-mistake.json';
import HINT_FIXTURE from './fixtures/02-hint-level2.json';
import FEEDBACK_SCHEMA from './feedback.schema.json';
import { llmSchemaFor, systemPrompt, toLlmSchema, userMessage } from './index.js';
import { estimateTokens } from '../../src/llm/usage.js';
import { classifyMove } from '../../src/engine/classify.js';
import { buildMoveRequest } from '../../src/coach/buildRequest.js';
import { buildRefutationLine } from '../../src/coach/refutationLine.js';

// Medido con el prompt v2 (commit 086b198): system de Alfred = 4184 caracteres; el mensaje de
// usuario era "Hechos de la partida (requestType=…):\n" + JSON.stringify(request completo).
const V2_SYSTEM_CHARS = 4184;
const v2User = (r) => `Hechos de la partida (requestType=${r.requestType}):\n${JSON.stringify(r)}`;
const V2_SCHEMA_CHARS = JSON.stringify(toLlmSchema(FEEDBACK_SCHEMA)).length;

const play = (sans, fen) => {
  const c = new Chess(fen);
  for (const san of sans) c.move(san);
  return c.fen();
};
const analysis = (fen, lines, depth = 15) => ({ fen, depth, bestMove: lines[0][1][0], lines: lines.map(([score, pv], i) => ({ multipv: i + 1, depth, score, pv })) });
const fenBefore = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4']);
const cp = (value) => ({ type: 'cp', value });
const before = analysis(fenBefore, [[cp(104), ['f3d4', 'e5d4']], [cp(96), ['e1g1']], [cp(54), ['b1c3']]]);
const common = { lastRivalMove: { san: 'Nd4', piece: 'n', to: 'd4', capture: null }, player: { color: 'w', rating: 1495 }, rival: { level: 6, label: 'Héctor' }, opening: { name: 'Italian Game: Blackburne-Kostić Gambit', inBook: false } };
const req = (uci, san, afterLines, opts = {}) => {
  const fa = play([san], fenBefore);
  const after = analysis(fa, afterLines);
  const classification = classifyMove({ fenBefore, moveUci: uci, before, after });
  const line = buildRefutationLine({ fenAfter: fa, pv: afterLines[0][1] });
  return buildMoveRequest({ classification, before, after, ...common, line, ...opts });
};
const PV = ['d8g5', 'e5f7', 'g5g2', 'h1f1', 'g2e4', 'c4e2', 'd4f3'];

const CASES = {
  'error (move_feedback, v1.1 + ¿por qué?)': { v2: req('f3e5', 'Nxe5', [[cp(-64), PV]], { line: null }), v3: req('f3e5', 'Nxe5', [[cp(-64), PV]]) },
  '¿por qué? (imprecisión)': { v2: req('b1c3', 'Nc3', [[cp(20), ['d4f3', 'd1f3']]], { requestType: 'why', line: null }), v3: req('b1c3', 'Nc3', [[cp(20), ['d4f3', 'd1f3', 'g8f6', 'd2d3']]], { requestType: 'why' }) },
  'pista nivel 2': { v2: HINT_FIXTURE.request, v3: HINT_FIXTURE.request },
  'fixture §6.2 (error)': { v2: MOVE_FIXTURE.request, v3: MOVE_FIXTURE.request },
};

describe('presupuesto de tokens', () => {
  const rows = Object.entries(CASES).map(([name, { v2, v3 }]) => {
    const sys3 = systemPrompt('alfred', v3);
    const before2 = estimateTokens('x'.repeat(V2_SYSTEM_CHARS)) + estimateTokens(v2User(v2));
    const after3 = estimateTokens(sys3) + estimateTokens(userMessage(v3));
    return {
      caso: name,
      'system v2': estimateTokens('x'.repeat(V2_SYSTEM_CHARS)),
      'hechos v2': estimateTokens(v2User(v2)),
      'total v2': before2,
      'system v3': estimateTokens(sys3),
      'hechos v3': estimateTokens(userMessage(v3)),
      'total v3': after3,
      ahorro: `${Math.round((1 - after3 / before2) * 100)} %`,
      'schema v2→v3': `${estimateTokens('x'.repeat(V2_SCHEMA_CHARS))}→${estimateTokens(JSON.stringify(llmSchemaFor(v3)))}`,
    };
  });
  if (globalThis.process?.env?.TOKEN_REPORT) console.table(rows);

  it('el system prompt v3 es al menos un 35 % más corto que el v2', () => {
    for (const id of ['alfred', 'kairos', 'ariadna']) expect(systemPrompt(id).length).toBeLessThan(V2_SYSTEM_CHARS * 0.65);
  });

  it('cada petición cuesta al menos un 35 % menos de entrada (estimado)', () => {
    for (const r of rows) {
      if (r.caso.startsWith('error')) continue; // este añade la línea y el "¿Por qué?"
      expect(r['total v3']).toBeLessThan(r['total v2'] * 0.65);
    }
    // El error con "¿Por qué?" incluido sigue costando menos que el v2 sin él.
    expect(rows[0]['total v3']).toBeLessThan(rows[0]['total v2'] * 0.75);
  });
});
