// Metadatos y validación sin cargar los adaptadores HTTP de la IA opcional.
import { getT } from '../i18n/core.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.5-flash-lite';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

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

