// Registro del consumo de la IA del usuario, por partida (v1.1).
//
// Cada petición real al proveedor deja una entrada con el tipo (move_feedback, great_move, why,
// hint…), los tokens que REPORTA el proveedor (entrada, de ellos en caché, salida y razonamiento),
// la latencia y el tamaño estimado de cada parte del prompt (system y hechos). Los aciertos de la
// caché del cliente no llegan al proveedor: se cuentan aparte y no suman tokens.
// Es un store externo (subscribe/getSnapshot) para usarlo con useSyncExternalStore.
import { estimateCostUsd } from './pricing.js';
import { getT } from '../i18n/core.js';

/** Máximo de entradas que se guardan por partida (el tope de llamadas es 30). */
export const MAX_USAGE_ENTRIES = 100;

/**
 * Estimación de tokens a partir de caracteres (≈ caracteres / 3,6). Solo para comparar tamaños
 * de prompt antes de llamar; calibrada con la partida del dueño (≈ 1,4k tokens de entrada reales
 * por solicitud con el prompt v2). Lo que se muestra al usuario son los tokens del proveedor.
 * @param {string} text
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 3.6);
}

/**
 * Tipo de solicitud para el registro: separa la gran jugada y el comentario de error que ya trae
 * el "¿Por qué?" del `move_feedback` normal.
 * @param {object} request  CoachRequest
 */
export function usageType(request) {
  const t = request?.requestType ?? 'unknown';
  if (t !== 'move_feedback') return t;
  if (request.coachFacts?.greatMove) return 'great_move';
  if (request.policy?.explainWhy) return 'move_feedback+why';
  return 'move_feedback';
}

/**
 * @typedef {{type:string, ok:boolean, kind?:string|null, provider?:string, model?:string,
 *   inputTokens:number, cachedTokens:number, outputTokens:number, reasoningTokens:number,
 *   latencyMs:number|null, estSystemTokens?:number, estUserTokens?:number, costUsd:number|null,
 *   at:number}} UsageEntry
 */

/**
 * Totales de una lista de entradas.
 * @param {UsageEntry[]} entries
 * @param {number} [cacheHits]
 */
export function summarizeUsage(entries, cacheHits = 0) {
  const sum = {
    requests: entries.length,
    failures: entries.filter((e) => !e.ok).length,
    cacheHits,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    costPartial: false, // algún modelo sin precio en la tabla
    avgLatencyMs: null,
    byType: {},
  };
  let latSum = 0;
  let latN = 0;
  for (const e of entries) {
    sum.inputTokens += e.inputTokens;
    sum.cachedTokens += e.cachedTokens;
    sum.outputTokens += e.outputTokens;
    sum.reasoningTokens += e.reasoningTokens;
    if (e.costUsd == null) {
      if (e.inputTokens || e.outputTokens) sum.costPartial = true;
    } else sum.costUsd += e.costUsd;
    if (Number.isFinite(e.latencyMs)) {
      latSum += e.latencyMs;
      latN += 1;
    }
    const t = (sum.byType[e.type] ??= { requests: 0, inputTokens: 0, outputTokens: 0 });
    t.requests += 1;
    t.inputTokens += e.inputTokens;
    t.outputTokens += e.outputTokens + e.reasoningTokens;
  }
  sum.avgLatencyMs = latN ? Math.round(latSum / latN) : null;
  return sum;
}

/** Entero con separador de miles del idioma (es: 1.234.567; en: 1,234,567), independiente del sistema. */
export function formatInt(n, lang = 'es') {
  return String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '.');
}

/** Costo en USD con el decimal del idioma y las cifras justas ("0,0012 USD" / "0.0012 USD"). */
export function formatUsd(x, lang = 'es') {
  if (!x) return '0 USD';
  const digits = x >= 1 ? 2 : x >= 0.01 ? 3 : 4;
  const fixed = x.toFixed(digits);
  return `${lang === 'en' ? fixed : fixed.replace('.', ',')} USD`;
}

/**
 * Línea de resumen para el panel: "Esta partida: 3 solicitudes · 2.100 tokens de entrada ·
 * 240 de salida · ≈ 0,0009 USD (aprox.)".
 * @param {ReturnType<typeof summarizeUsage>} s
 * @param {import('../i18n/core.js').TFunction} [t]  traductor (por defecto, español)
 * @param {'es'|'en'} [lang]
 */
export function formatUsageLine(s, t = getT('es'), lang = t.lang ?? 'es') {
  if (!s || s.requests === 0) return t('ai.usage.none') + (s?.cacheHits ? ` ${t('ai.usage.fromCache', { n: s.cacheHits })}` : '');
  const out = s.outputTokens + s.reasoningTokens;
  const cost = s.costPartial && !s.costUsd ? t('ai.usage.noPrice') : t('ai.usage.cost', { cost: `${formatUsd(s.costUsd, lang)}${s.costPartial ? '+' : ''}` });
  return t('ai.usage.line', { requests: t('ai.usage.requests', { n: s.requests }), input: formatInt(s.inputTokens, lang), output: formatInt(out, lang), cost });
}

export class UsageLog {
  constructor({ now = () => Date.now() } = {}) {
    this._now = now;
    this._gameId = null;
    /** @type {UsageEntry[]} */
    this._entries = [];
    this._cacheHits = 0;
    this._listeners = new Set();
    this._snap = this._makeSnapshot();
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
  }

  _makeSnapshot() {
    return Object.freeze({ gameId: this._gameId, entries: this._entries, summary: summarizeUsage(this._entries, this._cacheHits) });
  }

  _emit() {
    this._snap = this._makeSnapshot();
    this._listeners.forEach((l) => l());
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getSnapshot() {
    return this._snap;
  }

  /** Empieza el registro de otra partida (no hace nada si ya es esa). */
  startGame(gameId) {
    if (gameId === this._gameId) return;
    this._gameId = gameId;
    this._entries = [];
    this._cacheHits = 0;
    this._emit();
  }

  /** Acierto de la caché del cliente (0 tokens). */
  recordCacheHit() {
    this._cacheHits += 1;
    this._emit();
  }

  /**
   * Registra una petición real al proveedor.
   * @param {{type:string, ok:boolean, kind?:string|null, provider?:string, model?:string,
   *   usage?:{inputTokens?:number, cachedTokens?:number, outputTokens?:number, reasoningTokens?:number}|null,
   *   latencyMs?:number|null, estSystemTokens?:number, estUserTokens?:number}} e
   */
  record({ type, ok, kind = null, provider, model, usage = null, latencyMs = null, estSystemTokens, estUserTokens }) {
    const u = usage ?? {};
    const entry = {
      type,
      ok,
      kind,
      provider,
      model,
      inputTokens: u.inputTokens ?? 0,
      cachedTokens: u.cachedTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      reasoningTokens: u.reasoningTokens ?? 0,
      latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      estSystemTokens,
      estUserTokens,
      costUsd: usage ? estimateCostUsd(u, model) : 0,
      at: this._now(),
    };
    this._entries = [...this._entries, entry].slice(-MAX_USAGE_ENTRIES);
    this._emit();
    return entry;
  }
}
