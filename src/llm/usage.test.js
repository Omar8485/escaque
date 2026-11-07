// Registro de consumo de la IA: tipos, totales, costo aproximado e integración con CoachClient.
import { getT } from '../i18n/core.js';
import { describe, expect, it, vi } from 'vitest';
import MOVE_FIXTURE from '../../shared/coach-contract/fixtures/01-move-feedback-mistake.json';
import { UsageLog, estimateTokens, formatInt, formatUsageLine, formatUsd, summarizeUsage, usageType } from './usage.js';
import { estimateCostUsd, priceFor } from './pricing.js';
import { CoachClient } from '../coach/coachClient.js';
import { AiSettingsStore } from './settings.js';

const MOVE = MOVE_FIXTURE.request;

describe('precios aproximados', () => {
  it('reconoce modelos con prefijo de OpenRouter y versiones', () => {
    expect(priceFor('gemini-3.5-flash-lite')).toMatchObject({ input: 0.3, output: 2.5 });
    expect(priceFor('google/gemini-3.5-flash-lite-001')).toMatchObject({ input: 0.3 });
    expect(priceFor('modelo-desconocido')).toBeNull();
  });

  it('costo = entrada fresca + entrada en caché + salida (con razonamiento)', () => {
    const c = estimateCostUsd({ inputTokens: 1000, cachedTokens: 400, outputTokens: 100, reasoningTokens: 20 }, 'gemini-3.5-flash-lite');
    expect(c).toBeCloseTo((600 * 0.3 + 400 * 0.03 + 120 * 2.5) / 1e6, 12);
    expect(estimateCostUsd({ inputTokens: 10 }, 'otro')).toBeNull();
  });
});

describe('UsageLog', () => {
  it('tipo de solicitud', () => {
    expect(usageType(MOVE)).toBe('move_feedback');
    expect(usageType({ ...MOVE, coachFacts: { ...MOVE.coachFacts, greatMove: true } })).toBe('great_move');
    expect(usageType({ ...MOVE, policy: { ...MOVE.policy, explainWhy: true } })).toBe('move_feedback+why');
    expect(usageType({ ...MOVE, requestType: 'why' })).toBe('why');
    expect(usageType({ requestType: 'hint' })).toBe('hint');
  });

  it('suma por partida, por tipo, y se reinicia con otra partida', () => {
    const log = new UsageLog({ now: () => 5 });
    log.startGame(1);
    log.record({ type: 'move_feedback', ok: true, model: 'gemini-3.5-flash-lite', usage: { inputTokens: 900, outputTokens: 80, reasoningTokens: 10 }, latencyMs: 812.4 });
    log.record({ type: 'hint', ok: false, kind: 'timeout', model: 'gemini-3.5-flash-lite', usage: null, latencyMs: 4500 });
    log.recordCacheHit();
    const s = log.getSnapshot().summary;
    expect(s).toMatchObject({ requests: 2, failures: 1, cacheHits: 1, inputTokens: 900, outputTokens: 80, reasoningTokens: 10, avgLatencyMs: 2656 });
    expect(s.byType).toEqual({ move_feedback: { requests: 1, inputTokens: 900, outputTokens: 90 }, hint: { requests: 1, inputTokens: 0, outputTokens: 0 } });
    expect(s.costUsd).toBeCloseTo((900 * 0.3 + 90 * 2.5) / 1e6, 12);
    expect(log.getSnapshot().entries[0].latencyMs).toBe(812);
    log.startGame(1); // misma partida: no borra
    expect(log.getSnapshot().summary.requests).toBe(2);
    log.startGame(2);
    expect(log.getSnapshot().summary).toMatchObject({ requests: 0, cacheHits: 0 });
  });

  it('modelo sin precio: el costo se marca como parcial', () => {
    const s = summarizeUsage([{ type: 'hint', ok: true, inputTokens: 10, cachedTokens: 0, outputTokens: 5, reasoningTokens: 0, costUsd: null, latencyMs: 1 }]);
    expect(s.costPartial).toBe(true);
    expect(formatUsageLine(s)).toContain('sin precio');
  });

  it('formato de la línea de resumen', () => {
    expect(formatInt(20123)).toBe('20.123');
    expect(formatUsd(0.00123)).toBe('0,0012 USD');
    expect(formatUsageLine(summarizeUsage([]))).toBe('Esta partida: 0 solicitudes a tu IA');
    const s = summarizeUsage([{ type: 'why', ok: true, inputTokens: 1400, cachedTokens: 0, outputTokens: 100, reasoningTokens: 15, costUsd: 0.0007, latencyMs: 900 }]);
    expect(formatUsageLine(s)).toBe('Esta partida: 1 solicitud · 1.400 tokens de entrada · 115 de salida · ≈ 0,0007 USD (aprox.)');
  });

  it('formato en inglés', () => {
    const en = getT('en');
    expect(formatInt(20123, 'en')).toBe('20,123');
    expect(formatUsd(0.00123, 'en')).toBe('0.0012 USD');
    expect(formatUsageLine(summarizeUsage([]), en)).toBe('This game: 0 requests to your AI');
    const s = summarizeUsage([{ type: 'why', ok: true, inputTokens: 1400, cachedTokens: 0, outputTokens: 100, reasoningTokens: 15, costUsd: 0.0007, latencyMs: 900 }]);
    expect(formatUsageLine(s, en)).toBe('This game: 1 request · 1,400 input tokens · 115 output · ≈ 0.0007 USD (approx.)');
  });

  it('estimación de tokens ≈ caracteres / 3,6', () => {
    expect(estimateTokens('x'.repeat(360))).toBe(100);
  });
});

describe('CoachClient registra cada solicitud', () => {
  const memory = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };
  const settings = () => {
    const s = new AiSettingsStore({ storage: memory() });
    s.save({ provider: 'gemini', apiKey: 'AIza-1' });
    return s;
  };
  const reply = {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ comment: 'Tras [[Nxe5]] el rival responde [[Qg5]].', tone: 'alerta', suggestTakeback: true, hint: null, question: null, concepts: [], factsUsed: [] }) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 812, cachedContentTokenCount: 0, candidatesTokenCount: 41, thoughtsTokenCount: 7 },
    modelVersion: 'gemini-3.5-flash-lite',
  };

  it('tokens del proveedor, tipo y tamaño estimado de system y hechos; la caché no suma', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const c = new CoachClient({ settings: settings(), fetchImpl, storage: null });
    c.usage.startGame(7);
    expect((await c.request(MOVE)).ok).toBe(true);
    expect((await c.request(MOVE)).cached).toBe(true);
    const { entries, summary } = c.usage.getSnapshot();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'move_feedback', ok: true, inputTokens: 812, outputTokens: 41, reasoningTokens: 7 });
    expect(entries[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(entries[0].estSystemTokens).toBeGreaterThan(100);
    expect(entries[0].estUserTokens).toBeGreaterThan(50);
    expect(summary).toMatchObject({ requests: 1, cacheHits: 1 });
  });

  it('un fallo de red también queda registrado (sin tokens)', async () => {
    const c = new CoachClient({ settings: settings(), fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, storage: null });
    await c.request(MOVE);
    expect(c.usage.getSnapshot().entries[0]).toMatchObject({ ok: false, kind: 'network', inputTokens: 0 });
  });
});
