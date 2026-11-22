// Interfaz de proveedor LLM en el navegador (diseño interno del coach §8) y registro de proveedores.
// La IA es opcional: la configura el usuario con SU clave (src/llm/settings.js) y las llamadas
// van directamente del navegador al proveedor. Escaque no tiene LLM ni claves en su servidor.
import { getT } from '../i18n/core.js';
import { effectiveModel, configProblem } from './providerConfig.js';
import { GeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { OpenAICompatibleProvider, DEFAULT_OPENAI_MODEL, DEFAULT_OPENROUTER_MODEL } from './openai.js';
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js';
import { LlmError, userMessageFor } from './errors.js';

/**
 * @typedef {'none'|'minimal'|'low'|'medium'|'high'} ReasoningEffort
 * @typedef {{
 *   system: string, user: string, schema: object, model?: string,
 *   maxOutputTokens: number, reasoning: ReasoningEffort, timeoutMs: number, signal?: AbortSignal,
 * }} StructuredRequest
 * @typedef {{inputTokens:number, cachedTokens?:number, outputTokens:number, reasoningTokens:number}} Usage
 *   inputTokens incluye cachedTokens; outputTokens es solo el texto visible; reasoningTokens se factura como salida.
 * @typedef {{data: unknown, rawText: string, model: string, usage: Usage, latencyMs: number}} StructuredResult
 * @typedef {{id: string, defaultModel: string, generateStructured(req: StructuredRequest): Promise<StructuredResult>}} LlmProvider
 * @typedef {{provider: string, model?: string, apiKey?: string, baseUrl?: string}} AiConfig
 */

export { LlmError, userMessageFor };

export { PROVIDERS, PROVIDER_IDS, effectiveModel, configProblem } from './providerConfig.js';

/**
 * Fábrica: el único lugar que sabe construir cada adaptador.
 * @param {AiConfig} config
 * @param {{fetchImpl?: typeof fetch}} [deps]
 * @returns {LlmProvider}
 */
export function createProvider(config, { fetchImpl } = {}) {
  const apiKey = String(config.apiKey ?? '').trim();
  const model = effectiveModel(config);
  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider({ apiKey, model, fetchImpl });
    case 'anthropic':
      return new AnthropicProvider({ apiKey, model, fetchImpl });
    case 'openai':
    case 'openrouter':
      return new OpenAICompatibleProvider({ id: config.provider, apiKey, model, fetchImpl });
    case 'custom':
      return new OpenAICompatibleProvider({ id: 'custom', apiKey, model, baseUrl: config.baseUrl, fetchImpl });
    default:
      throw new LlmError('bad_request', `Proveedor desconocido: ${config.provider}`);
  }
}

const PING_SCHEMA = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
});

/**
 * "Probar conexión": una llamada mínima con salida estructurada (comprueba clave, modelo, CORS y
 * soporte de JSON a la vez). Cuesta unas decenas de tokens. Nunca lanza.
 * @param {AiConfig} config
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number, signal?: AbortSignal, t?: import('../i18n/core.js').TFunction}} [opts]
 *   `t`: traductor de los mensajes al usuario (por defecto, español)
 * @returns {Promise<{ok: true, model: string, latencyMs: number} | {ok: false, kind: string, message: string}>}
 */
export async function testConnection(config, { fetchImpl, timeoutMs = 15_000, signal, t = getT('es') } = {}) {
  const problem = configProblem(config, t);
  if (problem) return { ok: false, kind: 'config', message: problem };
  try {
    const provider = createProvider(config, { fetchImpl });
    const res = await provider.generateStructured({
      system: 'Eres una prueba de conexión. Responde solo con JSON.',
      user: 'Responde exactamente {"ok": true}.',
      schema: PING_SCHEMA,
      maxOutputTokens: 256,
      reasoning: 'minimal',
      timeoutMs,
      signal,
    });
    if (res.data?.ok !== true) return { ok: false, kind: 'invalid_output', message: userMessageFor({ kind: 'invalid_output' }, t) };
    return { ok: true, model: res.model, latencyMs: res.latencyMs };
  } catch (err) {
    const kind = err instanceof LlmError ? err.kind : 'network';
    let message = userMessageFor({ kind }, t);
    if (kind === 'network' && config.provider === 'custom') {
      message += ` ${t('ai.problem.customNetwork')}`;
    }
    return { ok: false, kind, message, detail: err?.message };
  }
}
