// Adaptadores LLM del navegador con fetch simulado: forma exacta de la petición, cabeceras,
// parseo de la respuesta y traducción de errores.
import { getT } from '../i18n/core.js';
import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider, geminiThinkingLevel } from './gemini.js';
import { OpenAICompatibleProvider, openAiReasoningEffort } from './openai.js';
import { AnthropicProvider, anthropicSchema } from './anthropic.js';
import { configProblem, createProvider, effectiveModel, testConnection, PROVIDERS } from './provider.js';
import { parseJsonText } from './http.js';
import { LlmError, userMessageFor } from './errors.js';
import { FEEDBACK_SCHEMA, toLlmSchema } from '../../shared/coach-contract/index.js';

const SCHEMA = toLlmSchema(FEEDBACK_SCHEMA);
const REQ = { system: 'SYS', user: 'USER', schema: SCHEMA, maxOutputTokens: 600, reasoning: 'minimal', timeoutMs: 1000 };
const DATA = { comment: 'Hola [[e4]].', tone: 'elogio', suggestTakeback: false, hint: null, question: null, concepts: [], factsUsed: [] };

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const fetchReturning = (res) => vi.fn(async () => (typeof res === 'function' ? res() : res));
const sent = (fetchImpl, i = 0) => {
  const [url, init] = fetchImpl.mock.calls[i];
  return { url, init, body: JSON.parse(init.body) };
};
const kindOf = async (promise) => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return err.kind;
  }
};
const hang = (url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

// ---------- Gemini ----------
describe('GeminiProvider', () => {
  const geminiOk = (text = JSON.stringify(DATA)) =>
    json({
      candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
      modelVersion: 'gemini-3.5-flash-lite',
    });

  it('petición: URL, cabecera x-goog-api-key, systemInstruction y responseJsonSchema', async () => {
    const fetchImpl = fetchReturning(geminiOk());
    const r = await new GeminiProvider({ apiKey: 'AIzaTEST', fetchImpl }).generateStructured(REQ);
    const { url, init, body } = sent(fetchImpl);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'AIzaTEST' });
    expect(url).not.toContain('AIzaTEST'); // la clave no va en la URL
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'USER' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: SCHEMA,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingLevel: 'minimal' },
      },
    });
    expect(r).toMatchObject({ data: DATA, model: 'gemini-3.5-flash-lite', usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 } });
  });

  it('thinkingLevel según el modelo', () => {
    expect(geminiThinkingLevel('gemini-3.5-flash-lite')).toBe('minimal');
    expect(geminiThinkingLevel('gemini-3.8-flash')).toBe('low');
    expect(geminiThinkingLevel('gemini-2.5-flash')).toBeNull();
    expect(new GeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash' }).body(REQ, 'gemini-2.5-flash').generationConfig.thinkingConfig).toBeUndefined();
  });

  it('errores: clave inválida (400 API_KEY_INVALID), 403, 429 con retry-after, 404, 500, bloqueo', async () => {
    const p = (res) => new GeminiProvider({ apiKey: 'k', fetchImpl: fetchReturning(res) }).generateStructured(REQ);
    const invalidKey = json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, 400);
    expect(await kindOf(p(invalidKey))).toBe('auth');
    expect(await kindOf(p(json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403)))).toBe('auth');
    try {
      await p(json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429, { 'retry-after': '7' }));
    } catch (err) {
      expect(err).toMatchObject({ kind: 'rate_limited', retryAfterMs: 7000 });
    }
    expect(await kindOf(p(json({ error: { code: 404 } }, 404)))).toBe('model_not_found');
    expect(await kindOf(p(json({ error: { code: 500 } }, 500)))).toBe('unavailable');
    expect(await kindOf(p(json({ error: { code: 400, message: 'Invalid JSON payload' } }, 400)))).toBe('bad_request');
    expect(await kindOf(p(json({ promptFeedback: { blockReason: 'SAFETY' } })))).toBe('safety_blocked');
    expect(await kindOf(p(json({ candidates: [{ finishReason: 'SAFETY' }] })))).toBe('safety_blocked');
    expect(await kindOf(p(geminiOk('esto no es json')))).toBe('invalid_output');
  });
});

// ---------- OpenAI / OpenRouter / compatible ----------
describe('OpenAICompatibleProvider', () => {
  const chatOk = (content = JSON.stringify(DATA), extra = {}) =>
    json({
      model: 'gpt-6-luna',
      choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 90, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 0 } },
      ...extra,
    });

  it('OpenAI: URL, Bearer, response_format json_schema strict, max_completion_tokens y reasoning_effort', async () => {
    const fetchImpl = fetchReturning(chatOk());
    const r = await createProvider({ provider: 'openai', apiKey: 'sk-test' }, { fetchImpl }).generateStructured(REQ);
    const { url, init, body } = sent(fetchImpl);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' });
    expect(body).toEqual({
      model: 'gpt-6-luna',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'coach_response', strict: true, schema: SCHEMA } },
      max_completion_tokens: 600,
      reasoning_effort: 'none',
    });
    expect(r).toMatchObject({ data: DATA, model: 'gpt-6-luna', usage: { inputTokens: 90, outputTokens: 30, reasoningTokens: 0 } });
  });

  it('reasoning_effort solo en modelos que razonan', () => {
    expect(openAiReasoningEffort('gpt-6-luna')).toBe('none');
    expect(openAiReasoningEffort('gpt-5-mini')).toBe('low');
    expect(openAiReasoningEffort('gpt-4o-mini')).toBeNull();
    const body = new OpenAICompatibleProvider({ id: 'openai', apiKey: 'k', model: 'gpt-4o-mini' }).body(REQ, 'gpt-4o-mini');
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('OpenRouter: su URL, max_tokens y provider.require_parameters', async () => {
    const fetchImpl = fetchReturning(chatOk());
    await createProvider({ provider: 'openrouter', apiKey: 'sk-or-1' }, { fetchImpl }).generateStructured(REQ);
    const { url, init, body } = sent(fetchImpl);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-1');
    expect(body.model).toBe('google/gemini-3.5-flash-lite');
    expect(body.max_tokens).toBe(600);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('compatible (Ollama): URL base propia, sin Authorization sin clave, schema también en el prompt', async () => {
    const fetchImpl = fetchReturning(chatOk('```json\n' + JSON.stringify(DATA) + '\n```'));
    const r = await createProvider({ provider: 'custom', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1/' }, { fetchImpl }).generateStructured(REQ);
    const { url, init, body } = sent(fetchImpl);
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(body.model).toBe('llama3.2');
    expect(body.messages[0].content).toContain('JSON Schema');
    expect(r.data).toEqual(DATA); // parseo robusto de ```json
  });

  it('errores: 401, 429 insufficient_quota, 429 límite, 402 de OpenRouter, 404, 200 con error, rechazo', async () => {
    const p = (res, provider = 'openai') => createProvider({ provider, apiKey: 'k' }, { fetchImpl: fetchReturning(res) }).generateStructured(REQ);
    expect(await kindOf(p(json({ error: { message: 'Incorrect API key', type: 'invalid_request_error', code: 'invalid_api_key' } }, 401)))).toBe('auth');
    expect(await kindOf(p(json({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }, 429)))).toBe('quota');
    expect(await kindOf(p(json({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, 429)))).toBe('rate_limited');
    expect(await kindOf(p(json({ error: { code: 402, message: 'Insufficient credits' } }, 402), 'openrouter'))).toBe('quota');
    expect(await kindOf(p(json({ error: { code: 'model_not_found', message: 'The model does not exist' } }, 404)))).toBe('model_not_found');
    expect(await kindOf(p(json({ error: { code: 502, message: 'Provider returned error' } }), 'openrouter'))).toBe('unavailable');
    expect(await kindOf(p(chatOk(null, { choices: [{ message: { content: null, refusal: 'No puedo' }, finish_reason: 'stop' }] })))).toBe('safety_blocked');
    expect(await kindOf(p(json({ error: { message: 'Invalid schema for response_format' } }, 400)))).toBe('bad_request');
  });
});

// ---------- Anthropic ----------
describe('AnthropicProvider', () => {
  const msgOk = (text = JSON.stringify(DATA)) =>
    json({ id: 'msg_1', type: 'message', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 25 } });

  it('petición: URL, x-api-key, anthropic-version, cabecera de acceso desde navegador y output_config', async () => {
    const fetchImpl = fetchReturning(msgOk());
    const r = await new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl }).generateStructured(REQ);
    const { url, init, body } = sent(fetchImpl);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 600,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      output_config: { format: { type: 'json_schema', schema: anthropicSchema(SCHEMA) }, effort: 'low' },
      thinking: { type: 'disabled' },
    });
    // maxItems no está admitido en la salida estructurada de Anthropic: se quita (lo valida el cliente).
    expect(JSON.stringify(body.output_config.format.schema)).not.toContain('maxItems');
    expect(JSON.stringify(SCHEMA)).toContain('maxItems');
    expect(r).toMatchObject({ data: DATA, model: 'claude-haiku-5-5', usage: { inputTokens: 80, outputTokens: 25 } });
  });

  it('modelos sin effort ni thinking desactivable', () => {
    const body = new AnthropicProvider({ apiKey: 'k' }).body(REQ, 'claude-haiku-4-5-20251001');
    expect(body.output_config.effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(new AnthropicProvider({ apiKey: 'k' }).body(REQ, 'claude-sonnet-5-5').thinking).toBeUndefined();
  });

  it('errores por tipo: auth, billing, permisos, límite, sobrecarga, modelo, saldo, rechazo', async () => {
    const err = (status, type, message = 'x') => json({ type: 'error', error: { type, message }, request_id: 'req_1' }, status);
    const p = (res) => new AnthropicProvider({ apiKey: 'k', fetchImpl: fetchReturning(res) }).generateStructured(REQ);
    expect(await kindOf(p(err(401, 'authentication_error', 'invalid x-api-key')))).toBe('auth');
    expect(await kindOf(p(err(402, 'billing_error')))).toBe('quota');
    expect(await kindOf(p(err(403, 'permission_error')))).toBe('auth');
    expect(await kindOf(p(err(429, 'rate_limit_error')))).toBe('rate_limited');
    expect(await kindOf(p(err(529, 'overloaded_error')))).toBe('unavailable');
    expect(await kindOf(p(err(404, 'not_found_error')))).toBe('model_not_found');
    expect(await kindOf(p(err(400, 'invalid_request_error', 'Your credit balance is too low')))).toBe('quota');
    expect(await kindOf(p(json({ content: [], stop_reason: 'refusal' })))).toBe('safety_blocked');
  });
});

// ---------- Común ----------
describe('red, timeout y cancelación (todos los adaptadores)', () => {
  for (const provider of ['gemini', 'openai', 'anthropic', 'openrouter']) {
    it(`${provider}: red caída/CORS → network; timeout → timeout; señal → aborted`, async () => {
      const down = vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await kindOf(createProvider({ provider, apiKey: 'k' }, { fetchImpl: down }).generateStructured(REQ))).toBe('network');
      expect(await kindOf(createProvider({ provider, apiKey: 'k' }, { fetchImpl: vi.fn(hang) }).generateStructured({ ...REQ, timeoutMs: 5 }))).toBe('timeout');
      const controller = new AbortController();
      const pending = createProvider({ provider, apiKey: 'k' }, { fetchImpl: vi.fn(hang) }).generateStructured({ ...REQ, signal: controller.signal });
      controller.abort();
      expect(await kindOf(pending)).toBe('aborted');
    });
  }
});

describe('parseJsonText', () => {
  it('JSON directo, en bloque ```json``` o rodeado de texto', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonText('Claro, aquí va: {"a":3} ¡suerte!')).toEqual({ a: 3 });
    expect(() => parseJsonText('[1,2]')).toThrow(LlmError);
    expect(() => parseJsonText('')).toThrow(LlmError);
  });
});

describe('configuración y "Probar conexión"', () => {
  it('modelo por defecto vigente por proveedor', () => {
    expect(PROVIDERS.gemini.defaultModel).toBe('gemini-3.5-flash-lite');
    expect(PROVIDERS.openai.defaultModel).toBe('gpt-6-luna');
    expect(PROVIDERS.anthropic.defaultModel).toBe('claude-haiku-5-5');
    expect(PROVIDERS.openrouter.defaultModel).toBe('google/gemini-3.5-flash-lite');
    expect(effectiveModel({ provider: 'openai', model: ' ' })).toBe('gpt-6-luna');
  });

  it('configProblem: clave, modelo y URL base', () => {
    expect(configProblem({ provider: 'gemini', apiKey: '' })).toMatch(/clave/);
    expect(configProblem({ provider: 'gemini', apiKey: 'k' })).toBeNull();
    expect(configProblem({ provider: 'custom', baseUrl: 'http://localhost:11434/v1' })).toMatch(/modelo/);
    expect(configProblem({ provider: 'custom', model: 'm', baseUrl: 'http://localhost:11434/v1' })).toBeNull();
    expect(configProblem({ provider: 'custom', model: 'm', baseUrl: 'http://mi-servidor.lan/v1' })).toMatch(/https/);
    expect(configProblem({ provider: 'custom', model: 'm', baseUrl: 'no es url' })).toMatch(/URL/);
    expect(configProblem({ provider: 'otro' })).toMatch(/proveedor/);
    const en = getT('en');
    expect(configProblem({ provider: 'gemini', apiKey: '' }, en)).toBe('Paste your API key.');
    expect(configProblem({ provider: 'custom', model: 'm', baseUrl: 'http://mi-servidor.lan/v1' }, en)).toMatch(/^Use https/);
    expect(userMessageFor({ kind: 'quota' }, en)).toBe('Your provider account has no credit or quota left.');
    expect(userMessageFor({ kind: 'raro' }, en)).toBe('Unknown error with the AI provider.');
    expect(userMessageFor({ kind: 'quota' })).toMatch(/saldo/);
  });

  it('prueba correcta con una llamada mínima de salida estructurada', async () => {
    const fetchImpl = fetchReturning(json({ model: 'gpt-6-luna', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }));
    const r = await testConnection({ provider: 'openai', apiKey: 'sk-1' }, { fetchImpl });
    expect(r).toMatchObject({ ok: true, model: 'gpt-6-luna' });
    const { body } = sent(fetchImpl);
    expect(body.response_format.json_schema.schema).toEqual({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false });
  });

  it('401 → mensaje claro de clave inválida; sin clave → no hace red', async () => {
    const fetchImpl = fetchReturning(json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401));
    const r = await testConnection({ provider: 'anthropic', apiKey: 'sk-ant-mala' }, { fetchImpl });
    expect(r).toMatchObject({ ok: false, kind: 'auth', message: userMessageFor({ kind: 'auth' }) });
    expect(r.message).toMatch(/clave no es válida/);
    const none = vi.fn();
    expect(await testConnection({ provider: 'anthropic', apiKey: '' }, { fetchImpl: none })).toMatchObject({ ok: false, kind: 'config' });
    expect(none).not.toHaveBeenCalled();
  });

  it('red caída en servidor local → menciona CORS', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await testConnection({ provider: 'custom', model: 'm', baseUrl: 'http://localhost:1234/v1' }, { fetchImpl: down });
    expect(r).toMatchObject({ ok: false, kind: 'network' });
    expect(r.message).toMatch(/CORS/);
  });
});
