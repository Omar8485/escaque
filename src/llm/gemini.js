// Adaptador de Google Gemini (API REST `generateContent`, llamada directa desde el navegador).
//
// Verificado en la documentación oficial (2026-11-02):
// - POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   (ai.google.dev/api/generate-content). Google recomienda la Interactions API para proyectos
//   nuevos, pero indica que "generateContent remains fully supported" (migrate-to-interactions).
// - Autenticación: cabecera `x-goog-api-key`.
// - Salida estructurada: generationConfig.responseMimeType = application/json +
//   responseJsonSchema (JSON Schema; "alternative to response_schema"). Admite type con null,
//   enum, required, additionalProperties y maxItems; quita maxLength (lo validamos nosotros).
// - Razonamiento: thinkingConfig.thinkingLevel. gemini-3.5-flash-lite admite minimal|low|medium|high
//   (por defecto minimal); 3.8 Flash y 4 Argon, solo low|medium|high.
// - Uso: usageMetadata.promptTokenCount (incluye cachedContentTokenCount) / candidatesTokenCount /
//   thoughtsTokenCount (se factura como salida).
import { LlmError } from './errors.js';
import { kindForStatus, parseJsonText, postJson, retryAfterMs, trimBase } from './http.js';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const PROVIDER = 'gemini';
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

/** thinkingLevel para el modelo (o null para no enviar thinkingConfig). */
export function geminiThinkingLevel(model) {
  if (/^gemini-(3\.5-flash-lite|3\.1-flash-lite|3\.6-flash|3-flash)/.test(model)) return 'minimal';
  if (/^gemini-(3|4)/.test(model)) return 'low';
  return null; // 2.5 y otros: valores por defecto del modelo
}

function mapError(status, { text, json }, res) {
  const msg = `Gemini ${status}: ${(json?.error?.message ?? text).slice(0, 300)}`;
  const reasons = JSON.stringify(json?.error?.details ?? []);
  // Clave inválida: Gemini responde 400 INVALID_ARGUMENT con reason API_KEY_INVALID.
  if (/API_KEY_INVALID|API key not valid|API_KEY_EXPIRED/i.test(`${reasons} ${text}`)) {
    return new LlmError('auth', msg, { status, provider: PROVIDER });
  }
  if (status === 429) return new LlmError('rate_limited', msg, { status, provider: PROVIDER, retryAfterMs: retryAfterMs(res) });
  return new LlmError(kindForStatus(status), msg, { status, provider: PROVIDER });
}

export class GeminiProvider {
  /** @param {{apiKey: string, model?: string, fetchImpl?: typeof fetch, baseUrl?: string, now?: () => number}} opts */
  constructor({ apiKey, model, fetchImpl, baseUrl = GEMINI_API_BASE, now = () => Date.now() }) {
    this.id = PROVIDER;
    this.apiKey = apiKey;
    this.defaultModel = model || DEFAULT_GEMINI_MODEL;
    this._fetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this._base = trimBase(baseUrl);
    this._now = now;
  }

  /** Cuerpo de la petición (público para los tests). */
  body(req, model = this.defaultModel) {
    const level = geminiThinkingLevel(model);
    return {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        maxOutputTokens: req.maxOutputTokens,
        ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
      },
    };
  }

  /** @param {import('./provider.js').StructuredRequest} req */
  async generateStructured(req) {
    const model = req.model || this.defaultModel;
    const started = this._now();
    const payload = await postJson({
      fetchImpl: this._fetch,
      url: `${this._base}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: this.body(req, model),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      provider: PROVIDER,
      model,
      mapError,
    });
    const meta = payload.usageMetadata ?? {};
    const usage = {
      inputTokens: meta.promptTokenCount ?? 0,
      // Parte del prompt servida desde la caché (implícita o explícita); ya incluida en inputTokens.
      cachedTokens: meta.cachedContentTokenCount ?? 0,
      outputTokens: meta.candidatesTokenCount ?? 0,
      reasoningTokens: meta.thoughtsTokenCount ?? 0,
    };
    const respondedModel = payload.modelVersion || model;
    if (payload.promptFeedback?.blockReason) {
      throw new LlmError('safety_blocked', `Gemini bloqueó la petición: ${payload.promptFeedback.blockReason}`, { provider: PROVIDER, model: respondedModel });
    }
    const candidate = payload.candidates?.[0];
    if (!candidate || BLOCKED.has(candidate.finishReason)) {
      throw new LlmError('safety_blocked', `Gemini sin respuesta (${candidate?.finishReason ?? 'sin candidatos'})`, { provider: PROVIDER, model: respondedModel });
    }
    // Las partes de razonamiento (thought: true) no son la respuesta.
    const rawText = (candidate.content?.parts ?? [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('');
    const data = parseJsonText(rawText, { provider: PROVIDER, model: respondedModel });
    return { data, rawText, model: respondedModel, usage, latencyMs: this._now() - started };
  }
}
