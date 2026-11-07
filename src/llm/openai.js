// Adaptador "Chat Completions" de OpenAI y de las APIs compatibles (OpenRouter, Ollama, LM Studio…).
//
// Verificado en la documentación oficial (2026-11-02):
// - OpenAI: POST https://api.openai.com/v1/chat/completions, `Authorization: Bearer <clave>`.
//   `max_completion_tokens` (max_tokens está obsoleto y no vale para modelos de razonamiento),
//   `reasoning_effort` (none|minimal|low|medium|high|xhigh|max; gpt-6-luna admite none),
//   `response_format: {type: 'json_schema', json_schema: {name, strict, schema}}`.
//   Respuesta: choices[0].message.content / refusal / finish_reason; usage.prompt_tokens,
//   completion_tokens, completion_tokens_details.reasoning_tokens.
// - OpenRouter: POST https://openrouter.ai/api/v1/chat/completions, `Authorization: Bearer`,
//   mismo `response_format` (json_schema strict) y `provider.require_parameters: true` para
//   enrutar solo a proveedores que admiten salida estructurada.
// - "Compatible con OpenAI": misma forma, URL base configurable. Como no sabemos si el servidor
//   respeta el schema, además se describe el JSON en el system prompt y se parsea con tolerancia.
import { LlmError } from './errors.js';
import { kindForStatus, parseJsonText, postJson, retryAfterMs, trimBase } from './http.js';

export const OPENAI_API_BASE = 'https://api.openai.com/v1';
export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.5-flash-lite';

/** reasoning_effort de OpenAI para el modelo (o null si el modelo no razona). */
export function openAiReasoningEffort(model) {
  if (/^gpt-6/.test(model)) return 'none';
  if (/^(gpt-5|o\d)/.test(model)) return 'low';
  return null;
}

/** Texto del mensaje (string o arreglo de partes). */
function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

function makeMapError(provider, label) {
  return (status, { text, json }, res) => {
    const e = json?.error ?? {};
    const detail = String(e.message ?? text ?? '').slice(0, 300);
    const msg = `${label} ${status}: ${detail}`;
    const code = String(e.code ?? e.type ?? '');
    // OpenAI usa 429 + insufficient_quota cuando no hay saldo; OpenRouter, 402.
    if (code === 'insufficient_quota' || /insufficient (credits|quota)|billing/i.test(detail)) {
      return new LlmError('quota', msg, { status, provider });
    }
    if (code === 'invalid_api_key' || status === 401) return new LlmError('auth', msg, { status, provider });
    if (code === 'model_not_found') return new LlmError('model_not_found', msg, { status, provider });
    const kind = kindForStatus(status);
    return new LlmError(kind, msg, { status, provider, retryAfterMs: kind === 'rate_limited' ? retryAfterMs(res) : undefined });
  };
}

export class OpenAICompatibleProvider {
  /**
   * @param {{id?: 'openai'|'openrouter'|'custom', label?: string, apiKey?: string, model?: string,
   *   baseUrl?: string, fetchImpl?: typeof fetch, now?: () => number}} opts
   */
  constructor({ id = 'openai', label, apiKey = '', model, baseUrl, fetchImpl, now = () => Date.now() }) {
    this.id = id;
    this.label = label ?? { openai: 'OpenAI', openrouter: 'OpenRouter', custom: 'Servidor compatible' }[id] ?? id;
    this.apiKey = apiKey;
    this.defaultModel = model || (id === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : id === 'openai' ? DEFAULT_OPENAI_MODEL : '');
    this._base = trimBase(baseUrl || (id === 'openrouter' ? OPENROUTER_API_BASE : OPENAI_API_BASE));
    this._fetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this._now = now;
    this._mapError = makeMapError(id, this.label);
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  /** Cuerpo de la petición (público para los tests). */
  body(req, model = this.defaultModel) {
    let system = req.system;
    if (this.id === 'custom') {
      // Sin garantía de salida estructurada nativa: el schema también va en las instrucciones.
      system += `\n\nResponde SOLO con un objeto JSON (sin texto antes ni después) que cumpla este JSON Schema:\n${JSON.stringify(req.schema)}`;
    }
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'coach_response', strict: true, schema: req.schema } },
    };
    if (this.id === 'openai') {
      body.max_completion_tokens = req.maxOutputTokens;
      const effort = openAiReasoningEffort(model);
      if (effort) body.reasoning_effort = effort;
    } else {
      body.max_tokens = req.maxOutputTokens;
    }
    if (this.id === 'openrouter') body.provider = { require_parameters: true };
    return body;
  }

  /** @param {import('./provider.js').StructuredRequest} req */
  async generateStructured(req) {
    const model = req.model || this.defaultModel;
    if (!model) throw new LlmError('bad_request', `${this.label}: falta el nombre del modelo`, { provider: this.id });
    const started = this._now();
    const payload = await postJson({
      fetchImpl: this._fetch,
      url: `${this._base}/chat/completions`,
      headers: this.headers(),
      body: this.body(req, model),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      provider: this.id,
      model,
      mapError: this._mapError,
    });
    // OpenRouter puede devolver 200 con un objeto `error` si falla el proveedor de destino.
    if (payload.error) {
      const status = Number(payload.error.code) || 502;
      throw this._mapError(status, { text: String(payload.error.message ?? ''), json: payload }, null);
    }
    const respondedModel = payload.model || model;
    const choice = payload.choices?.[0];
    if (!choice) throw new LlmError('invalid_output', `${this.label}: respuesta sin choices`, { provider: this.id, model: respondedModel });
    if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
      throw new LlmError('safety_blocked', `${this.label}: el modelo rechazó responder`, { provider: this.id, model: respondedModel });
    }
    const rawText = messageText(choice.message?.content);
    const data = parseJsonText(rawText, { provider: this.id, model: respondedModel });
    const u = payload.usage ?? {};
    return {
      data,
      rawText,
      model: respondedModel,
      usage: {
        inputTokens: u.prompt_tokens ?? 0,
        cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
        // completion_tokens incluye el razonamiento: se separa para que outputTokens sea solo el visible.
        outputTokens: Math.max(0, (u.completion_tokens ?? 0) - (u.completion_tokens_details?.reasoning_tokens ?? 0)),
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
      },
      latencyMs: this._now() - started,
    };
  }
}
