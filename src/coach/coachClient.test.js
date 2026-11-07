// CoachClient con la IA del usuario (BYOK): sin clave no hay red; con clave llama al proveedor,
// valida la respuesta (§5.3) antes de devolverla, cachea y gestiona errores.
import { describe, expect, it, vi } from 'vitest';
import MOVE_FIXTURE from '../../shared/coach-contract/fixtures/01-move-feedback-mistake.json';
import HINT_FIXTURE from '../../shared/coach-contract/fixtures/02-hint-level2.json';
import { CoachClient, MIN_BACKOFF_MS, cacheKey } from './coachClient.js';
import { AiSettingsStore } from '../llm/settings.js';

const MOVE = MOVE_FIXTURE.request;
const WHY = { ...MOVE, requestType: 'why' };
const HINT = HINT_FIXTURE.request;
const GOOD = {
  comment: 'Tras [[Nxe5]] el rival responde [[Qg5]] y ataca tu caballo de e5 y el peón de g2. ¿Quieres reconsiderar la jugada?',
  tone: 'alerta',
  suggestTakeback: true,
  hint: null,
  question: null,
  concepts: ['ataque_doble'],
  factsUsed: ['refutation.motif'],
};

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
};
const settingsWith = (config) => {
  const store = new AiSettingsStore({ storage: memoryStorage() });
  if (config) store.save(config);
  return store;
};
const geminiResponse = (data, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { candidates: [{ content: { parts: [{ text: typeof data === 'string' ? data : JSON.stringify(data) }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.5-flash-lite' }
        : data,
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
const client = (opts) => new CoachClient({ storage: null, ...opts });
const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))));

describe('CoachClient sin clave (por defecto)', () => {
  it('no hace ninguna petición de red: plantillas', async () => {
    const fetchImpl = vi.fn();
    const c = client({ settings: settingsWith(null), fetchImpl });
    expect(c.llmEnabled).toBe(false);
    expect(await c.request(MOVE)).toEqual({ ok: false, kind: 'no_key' });
    expect(await c.request(HINT, { forbiddenSquares: ['g5'] })).toEqual({ ok: false, kind: 'no_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(c.getConnection()).toBe('idle');
  });

  it('tampoco usa fetch global', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await client({ settings: settingsWith(null) }).request(MOVE);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('CoachClient con la clave del usuario', () => {
  const config = { provider: 'gemini', apiKey: 'AIza-1' };

  it('llama al proveedor con el system prompt del coach y los hechos; cachea', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(GOOD));
    const c = client({ settings: settingsWith(config), fetchImpl });
    expect(c.llmEnabled).toBe(true);
    const r1 = await c.request(MOVE);
    const r2 = await c.request(MOVE);
    expect(r1).toMatchObject({ ok: true, cached: false, data: { comment: GOOD.comment, suggestTakeback: true }, meta: { provider: 'gemini', model: 'gemini-3.5-flash-lite', promptVersion: 'coach-v4' } });
    expect(r2).toMatchObject({ ok: true, cached: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toContain('«Alfred»');
    expect(body.contents[0].parts[0].text).toContain('"requestType":"move_feedback"');
    expect(c.getConnection()).toBe('online');
  });

  it('valida la respuesta (§5.3): jugada no permitida → invalid_output (queda la plantilla)', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse({ ...GOOD, comment: 'Mejor era [[Nxd4]].' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await client({ settings: settingsWith(config), fetchImpl }).request(MOVE);
    expect(r).toEqual({ ok: false, kind: 'invalid_output' });
    warn.mockRestore();
  });

  it('las casillas prohibidas no se envían al LLM pero se aplican a la respuesta', async () => {
    const leaky = { comment: '', tone: 'neutral', suggestTakeback: false, hint: 'Lleva la dama a e5.', question: null, concepts: [], factsUsed: [] };
    const fetchImpl = vi.fn(async () => geminiResponse(leaky));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await client({ settings: settingsWith(config), fetchImpl }).request(HINT, { forbiddenSquares: ['e5'] });
    expect(r).toEqual({ ok: false, kind: 'invalid_output' });
    expect(fetchImpl.mock.calls[0][1].body).not.toContain('forbidden');
    warn.mockRestore();
  });

  it('no envía peticiones que no cumplen el schema', async () => {
    const fetchImpl = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await client({ settings: settingsWith(config), fetchImpl }).request({ ...MOVE, locale: 'fr' })).toEqual({ ok: false, kind: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('clave rechazada → deja de llamar hasta que cambie la configuración', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse({ error: { code: 400, message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } }, 400));
    const settings = settingsWith(config);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = client({ settings, fetchImpl });
    expect(await c.request(MOVE)).toEqual({ ok: false, kind: 'auth' });
    expect(await c.request(WHY)).toEqual({ ok: false, kind: 'auth' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(c.getConnection()).toBe('disabled');
    expect(c.llmEnabled).toBe(false);
    // Nueva clave: se olvida el error.
    fetchImpl.mockImplementation(async () => geminiResponse(GOOD));
    settings.save({ apiKey: 'AIza-2' });
    expect(c.disabledKind).toBeNull();
    expect(c.getConnection()).toBe('idle');
    expect((await c.request(MOVE)).ok).toBe(true);
    warn.mockRestore();
  });

  it('borrar la clave → vuelve a plantillas sin red', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(GOOD));
    const settings = settingsWith(config);
    const c = client({ settings, fetchImpl });
    settings.clearKey();
    expect(await c.request(MOVE)).toEqual({ ok: false, kind: 'no_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('429 → pausa al menos 60 s', async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => geminiResponse({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = client({ settings: settingsWith(config), fetchImpl, now: () => t });
    await c.request(MOVE);
    expect(c.getConnection()).toBe('paused');
    expect(await c.request(WHY)).toEqual({ ok: false, kind: 'paused' });
    t = MIN_BACKOFF_MS + 1;
    await c.request(WHY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('red caída / CORS → offline; timeout de 4,5 s; una sola petición en vuelo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = client({ settings: settingsWith(config), fetchImpl: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    expect(await down.request(MOVE)).toEqual({ ok: false, kind: 'network' });
    expect(down.getConnection()).toBe('offline');

    const slow = client({ settings: settingsWith(config), fetchImpl: vi.fn(hang), timeoutMs: 10 });
    expect(await slow.request(MOVE)).toEqual({ ok: false, kind: 'timeout' });

    const c = client({ settings: settingsWith(config), fetchImpl: vi.fn(hang), timeoutMs: 1000 });
    const first = c.request(MOVE);
    const second = c.request(WHY); // cancela la primera
    expect(await first).toEqual({ ok: false, kind: 'aborted' });
    c.cancel();
    expect(await second).toEqual({ ok: false, kind: 'aborted' });
    warn.mockRestore();
  });

  it('la caché distingue proveedor y modelo', async () => {
    const fetchImpl = vi.fn(async () => geminiResponse(GOOD));
    const storage = memoryStorage();
    const settings = settingsWith(config);
    const c = client({ settings, fetchImpl, storage });
    await c.request(MOVE);
    settings.save({ model: 'gemini-3.1-flash-lite' });
    await c.request(MOVE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // sessionStorage: una recarga con la misma configuración no vuelve a llamar.
    const again = client({ settings, fetchImpl, storage });
    expect((await again.request(MOVE)).cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('la clave de caché distingue tipo, jugada, pista y revelación', () => {
    const k = cacheKey(MOVE);
    expect(cacheKey(WHY)).not.toBe(k);
    expect(cacheKey(HINT)).not.toBe(k);
    expect(cacheKey({ ...MOVE, policy: { ...MOVE.policy, revealBestMove: true } })).not.toBe(k);
    // Mismo hecho en otro idioma: otra entrada (no se sirve un comentario en español a quien juega en inglés).
    expect(cacheKey({ ...MOVE, locale: 'en' })).not.toBe(k);
  });
});
