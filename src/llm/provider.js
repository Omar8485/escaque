// Interfaz de proveedor LLM en el navegador (docs/COACH_DESIGN.md §8) y registro de proveedores.
// La IA es opcional: la configura el usuario con SU clave (src/llm/settings.js) y las llamadas
// van directamente del navegador al proveedor. Escaque no tiene LLM ni claves en su servidor.
import { getT } from '../i18n/core.js';
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

/** Proveedores disponibles. `models`: sugerencias (el usuario puede escribir otro). */
export const PROVIDERS = Object.freeze({
  gemini: Object.freeze({
    id: 'gemini',
    shortLabel: 'Gemini',
    label: 'Google Gemini',
    defaultModel: DEFAULT_GEMINI_MODEL,
    models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    needsKey: true,
    note: 'Tiene nivel gratuito; en él Google puede usar los datos para mejorar sus productos.',
  }),
  openai: Object.freeze({
    id: 'openai',
    shortLabel: 'OpenAI',
    label: 'OpenAI',
    defaultModel: DEFAULT_OPENAI_MODEL,
    models: ['gpt-6-luna', 'gpt-6.1-terra'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    needsKey: true,
  }),
  anthropic: Object.freeze({
    id: 'anthropic',
    shortLabel: 'Claude',
    label: 'Anthropic (Claude)',
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    keyUrl: 'https://platform.claude.com/',
    keyPlaceholder: 'sk-ant-…',
    needsKey: true,
  }),
  openrouter: Object.freeze({
    id: 'openrouter',
    shortLabel: 'OpenRouter',
    label: 'OpenRouter',
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    models: ['google/gemini-3.5-flash-lite', 'openai/gpt-6-luna', 'anthropic/claude-haiku-5-5'],
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPlaceholder: 'sk-or-…',
    needsKey: true,
  }),
  custom: Object.freeze({
    id: 'custom',
    shortLabel: 'Compatible',
    label: 'Compatible con OpenAI (Ollama, LM Studio…)',
    defaultModel: '',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: [],
    keyUrl: null,
    keyPlaceholder: 'opcional',
    needsKey: false,
    note: 'El servidor debe permitir CORS desde esta página (Ollama: OLLAMA_ORIGINS; LM Studio: "Enable CORS").',
  }),
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDERS));

/** Modelo efectivo de una configuración (el elegido o el de por defecto del proveedor). */
export function effectiveModel(config) {
  return (config?.model || '').trim() || PROVIDERS[config?.provider]?.defaultModel || '';
}

/**
 * Problema de una configuración, o null si se puede usar. No hace red.
 * @param {AiConfig|null} config
 */
export function configProblem(config, t = getT('es')) {
  const meta = PROVIDERS[config?.provider];
  if (!meta) return t('ai.problem.provider');
  if (meta.needsKey && !String(config.apiKey ?? '').trim()) return t('ai.problem.key');
  if (!effectiveModel(config)) return t('ai.problem.model');
  if (config.provider === 'custom') {
    let url;
    try {
      url = new URL(String(config.baseUrl ?? '').trim());
    } catch {
      return t('ai.problem.baseUrl');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      return t('ai.problem.https');
    }
  }
  return null;
}

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
