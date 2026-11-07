// Adaptador de Anthropic (Messages API, llamada directa desde el navegador).
//
// Verificado en la documentación oficial (2026-11-02) y con una petición real desde la sesión:
// - POST https://api.anthropic.com/v1/messages, cabeceras `x-api-key`, `anthropic-version: 2023-06-01`.
// - CORS: solo si se envía `anthropic-dangerous-direct-browser-access: true`. Comprobado: con esa
//   cabecera la API responde `access-control-allow-origin: *` (también en un 401); sin ella, no.
// - Salida estructurada: `output_config.format = {type: 'json_schema', schema}` (sin cabecera beta;
//   `output_format` está obsoleto). No admite maxItems/maxLength/minimum (400): se quitan y los
//   valida validateOutput. `additionalProperties: false` obligatorio en objetos (ya lo cumplimos).
// - Esfuerzo: `output_config.effort` (low…max). Claude Haiku 5.5 admite `thinking: {type: 'disabled'}`.
// - Errores: {type: 'error', error: {type, message}}; 401 authentication_error, 402 billing_error,
//   403 permission_error, 404 not_found_error, 429 rate_limit_error, 529 overloaded_error.
import { LlmError } from './errors.js';
import { kindForStatus, parseJsonText, postJson, retryAfterMs, trimBase } from './http.js';

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
const PROVIDER = 'anthropic';

/** Quita palabras clave que la salida estructurada de Anthropic rechaza (copia). */
export function anthropicSchema(schema) {
  const DROP = new Set(['maxItems', 'maxLength', 'minLength', 'minimum', 'maximum']);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP.has(k)) continue;
      out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, walk(s)])) : walk(v);
    }
    return out;
  };
  return walk(schema);
}

/** ¿El modelo admite `output_config.effort`? (lista de modelos de la página "Effort"). */
export function supportsEffort(model) {
  return /^claude-(fable|mythos|opus|sonnet|haiku)-5/.test(model) || /^claude-(opus-4-[5-8]|sonnet-4-6)/.test(model);
}

const ERROR_KINDS = {
  authentication_error: 'auth',
  permission_error: 'auth',
  billing_error: 'quota',
  not_found_error: 'model_not_found',
  rate_limit_error: 'rate_limited',
  overloaded_error: 'unavailable',
  api_error: 'unavailable',
  timeout_error: 'timeout',
};

function mapError(status, { text, json }, res) {
  const type = json?.error?.type;
  const detail = String(json?.error?.message ?? text).slice(0, 300);
  const msg = `Anthropic ${status}: ${detail}`;
  // Límite de gasto propio alcanzado: 400 invalid_request_error con mensaje de saldo/límite.
  let kind = ERROR_KINDS[type] ?? kindForStatus(status);
  if (kind === 'bad_request' && /credit balance|spend limit|billing/i.test(detail)) kind = 'quota';
  return new LlmError(kind, msg, { status, provider: PROVIDER, retryAfterMs: kind === 'rate_limited' || kind === 'unavailable' ? retryAfterMs(res) : undefined });
}

/** Uso normalizado: input_tokens no incluye lo leído o escrito en la caché de prompts. */
function anthropicUsage(u = {}) {
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    inputTokens: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0),
    cachedTokens: cached,
    outputTokens: u.output_tokens ?? 0,
    reasoningTokens: 0,
  };
}

export class AnthropicProvider {
  /** @param {{apiKey: string, model?: string, fetchImpl?: typeof fetch, baseUrl?: string, now?: () => number}} opts */
  constructor({ apiKey, model, fetchImpl, baseUrl = ANTHROPIC_API_BASE, now = () => Date.now() }) {
    this.id = PROVIDER;
    this.apiKey = apiKey;
    this.defaultModel = model || DEFAULT_ANTHROPIC_MODEL;
    this._fetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this._base = trimBase(baseUrl);
    this._now = now;
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Necesaria para que la API acepte la llamada desde un navegador (CORS).
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  /** Cuerpo de la petición (público para los tests). */
  body(req, model = this.defaultModel) {
    const outputConfig = { format: { type: 'json_schema', schema: anthropicSchema(req.schema) } };
    if (supportsEffort(model)) outputConfig.effort = 'low';
    return {
      model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: outputConfig,
      // Haiku 5.5 permite apagar el razonamiento: menos latencia para un comentario corto.
      ...(/^claude-haiku-5/.test(model) ? { thinking: { type: 'disabled' } } : {}),
    };
  }

  /** @param {import('./provider.js').StructuredRequest} req */
  async generateStructured(req) {
    const model = req.model || this.defaultModel;
    const started = this._now();
    const payload = await postJson({
      fetchImpl: this._fetch,
      url: `${this._base}/v1/messages`,
      headers: this.headers(),
      body: this.body(req, model),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      provider: PROVIDER,
      model,
      mapError,
    });
    const respondedModel = payload.model || model;
    if (payload.stop_reason === 'refusal') {
      throw new LlmError('safety_blocked', 'Anthropic: el modelo rechazó responder', { provider: PROVIDER, model: respondedModel });
    }
    const rawText = (payload.content ?? [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('');
    const data = parseJsonText(rawText, { provider: PROVIDER, model: respondedModel });
    return {
      data,
      rawText,
      model: respondedModel,
      usage: anthropicUsage(payload.usage),
      latencyMs: this._now() - started,
    };
  }
}
