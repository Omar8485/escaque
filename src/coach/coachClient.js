// Cliente del coach (T9, docs/COACH_DESIGN.md §7.3–§7.5). La IA es OPCIONAL y la pone el usuario:
// este cliente llama directamente, desde el navegador, al proveedor que configuró con su clave
// (src/llm/). Escaque no tiene LLM en su servidor.
//
// - Sin clave configurada no hace NINGUNA petición de red: devuelve {ok:false, kind:'no_key'} y la
//   UI se queda con la plantilla (la experiencia por defecto).
// - Nunca lanza: devuelve {ok:true, data, meta} o {ok:false, kind}. La UI ya mostró la
//   plantilla, así que cualquier fallo solo significa "queda la plantilla".
// - Valida el CoachRequest contra el schema antes de enviarlo y la respuesta con validateOutput
//   (§5.3, anti-alucinación) antes de devolverla: nada sin validar llega a la UI.
// - Caché LRU (200) en memoria + sessionStorage (clave con proveedor y modelo): retroceder y
//   repetir la jugada no vuelve a llamar.
// - Una sola petición en vuelo: una nueva cancela la anterior (salvo game_summary).
// - Timeout de 4,5 s. Clave rechazada / sin saldo / modelo inexistente → deja de llamar hasta que
//   el usuario cambie la configuración. 429/5xx → pausa `retryAfterMs` (mínimo 60 s).
import {
  PROMPT_VERSION,
  llmSchemaFor,
  normalizeLlmOutput,
  systemPrompt,
  userMessage,
  validateOutput,
  validateRequest,
} from '../../shared/coach-contract/index.js';
import { createProvider as defaultCreateProvider } from '../llm/provider.js';
import { LlmError } from '../llm/errors.js';
import { aiSettings } from '../llm/settings.js';
import { UsageLog, estimateTokens, usageType } from '../llm/usage.js';

export const CLIENT_TIMEOUT_MS = 4500;
export const CACHE_SIZE = 200;
export const MIN_BACKOFF_MS = 60_000;
const MAX_OUTPUT_TOKENS = { feedback: 600, summary: 1200 };
const STORAGE_PREFIX = 'escaque:coach:v3:';

/** Errores que no se arreglan reintentando: se deja de llamar hasta cambiar la configuración. */
const DISABLING = new Set(['auth', 'quota', 'model_not_found', 'bad_request']);

/** @typedef {'idle'|'loading'|'online'|'offline'|'paused'|'disabled'} CoachConnection */

/** Clave de caché de una petición (§7.3). El cliente le antepone proveedor y modelo. */
export function cacheKey(request, extra = '') {
  const c = request.classification;
  const p = request.policy;
  return [
    PROMPT_VERSION,
    request.locale ?? 'es',
    request.coach ?? '',
    request.requestType,
    c ? `${c.moveUci}|${c.label}|${c.evalBefore?.type}${c.evalBefore?.value}` : '',
    request.game?.ply,
    p?.hintLevel ?? '',
    p?.revealBestMove ? 'R' : '',
    p?.offerTakeback ? 'T' : '',
    p?.explainWhy ? 'W' : '',
    extra,
  ].join('|');
}

function safeStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const configSignature = (c) => (c ? `${c.provider}|${c.model}|${c.baseUrl ?? ''}|${c.apiKey ?? ''}` : '');

export class CoachClient {
  /**
   * @param {{settings?: {getConfig(): object|null, subscribe(l: () => void): () => void},
   *   fetchImpl?: typeof fetch, createProvider?: typeof defaultCreateProvider, timeoutMs?: number,
   *   storage?: Storage|null, now?: () => number}} [opts]
   */
  constructor({
    settings = aiSettings,
    fetchImpl,
    createProvider = defaultCreateProvider,
    timeoutMs = CLIENT_TIMEOUT_MS,
    storage = safeStorage(),
    now = () => Date.now(),
    usage = new UsageLog({ now }),
  } = {}) {
    this._settings = settings;
    this._fetch = fetchImpl;
    this._createProvider = createProvider;
    this._timeoutMs = timeoutMs;
    this._storage = storage;
    this._now = now;
    /** Consumo por partida (tokens que reporta el proveedor, latencia, tipo). */
    this.usage = usage;
    /** @type {Map<string, object>} */
    this._cache = new Map();
    this._inFlight = null;
    this._pausedUntil = 0;
    this._disabledKind = null;
    this._signature = configSignature(settings.getConfig());
    /** @type {CoachConnection} */
    this._connection = 'idle';
    this._listeners = new Set();
    this.subscribe = this.subscribe.bind(this);
    this.getConnection = this.getConnection.bind(this);
    // Al cambiar la configuración (otra clave, otro modelo, borrar la clave) se olvida el error anterior.
    this._unsubscribe = settings.subscribe?.(() => this._onSettingsChange()) ?? null;
  }

  _onSettingsChange() {
    const sig = configSignature(this._settings.getConfig());
    if (sig === this._signature) return;
    this._signature = sig;
    this.cancel();
    this._disabledKind = null;
    this._pausedUntil = 0;
    this._setConnection('idle', true);
  }

  /** Deja de escuchar la configuración (tests). */
  dispose() {
    this._unsubscribe?.();
    this.cancel();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** @returns {CoachConnection} */
  getConnection() {
    return this._connection;
  }

  /** Motivo por el que el LLM está desactivado (o null). */
  get disabledKind() {
    return this._disabledKind;
  }

  /** ¿Tiene sentido pedir texto al LLM ahora? (hay clave, no está desactivado ni en pausa). */
  get llmEnabled() {
    return Boolean(this._settings.getConfig()) && !this._disabledKind && this._now() >= this._pausedUntil;
  }

  _setConnection(c, force = false) {
    if (c === this._connection && !force) return;
    this._connection = c;
    this._listeners.forEach((l) => l());
  }

  _cacheGet(key) {
    if (this._cache.has(key)) {
      const v = this._cache.get(key);
      this._cache.delete(key);
      this._cache.set(key, v);
      return v;
    }
    try {
      const raw = this._storage?.getItem(STORAGE_PREFIX + key);
      if (raw) {
        const v = JSON.parse(raw);
        this._cache.set(key, v);
        return v;
      }
    } catch {
      // sessionStorage no disponible o lleno: solo memoria.
    }
    return null;
  }

  _cacheSet(key, value) {
    this._cache.set(key, value);
    if (this._cache.size > CACHE_SIZE) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
      try {
        this._storage?.removeItem(STORAGE_PREFIX + oldest);
      } catch {
        // ignorar
      }
    }
    try {
      this._storage?.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch {
      // ignorar
    }
  }

  /** Cancela la petición en vuelo (p. ej. al reiniciar la partida). */
  cancel() {
    this._inFlight?.abort();
    this._inFlight = null;
  }

  /**
   * Pide un comentario al proveedor configurado por el usuario.
   * @param {object} request  CoachRequest
   * @param {{forbiddenSquares?: string[], key?: string, signal?: AbortSignal}} [opts]
   *   forbiddenSquares: casillas que no pueden aparecer en la respuesta (no se envían al LLM).
   * @returns {Promise<{ok: true, data: object, meta: object, cached: boolean} | {ok: false, kind: string}>}
   */
  async request(request, { forbiddenSquares = [], key = cacheKey(request), signal } = {}) {
    const config = this._settings.getConfig();
    // Sin clave: plantillas, sin red.
    if (!config) return { ok: false, kind: 'no_key' };
    const fullKey = `${config.provider}:${config.model}|${key}`;
    const hit = this._cacheGet(fullKey);
    if (hit) {
      this.usage.recordCacheHit();
      return { ok: true, data: hit.data, meta: hit.meta, cached: true };
    }
    if (this._disabledKind) return { ok: false, kind: this._disabledKind };
    if (this._now() < this._pausedUntil) return { ok: false, kind: 'paused' };

    const errors = validateRequest(request);
    if (errors.length) {
      console.warn('CoachRequest inválido, se usa la plantilla:', errors.slice(0, 3));
      return { ok: false, kind: 'invalid_request' };
    }

    const isSummary = request.requestType === 'game_summary';
    if (!isSummary) this.cancel();
    const controller = new AbortController();
    if (!isSummary) this._inFlight = controller;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const signature = this._signature;

    this._setConnection('loading');
    const system = systemPrompt(request.coach, request);
    const user = userMessage(request);
    const type = usageType(request);
    const started = this._now();
    const log = (fields) =>
      this.usage.record({
        type,
        provider: config.provider,
        model: config.model,
        estSystemTokens: estimateTokens(system),
        estUserTokens: estimateTokens(user),
        latencyMs: this._now() - started,
        ...fields,
      });
    try {
      const provider = this._createProvider(config, { fetchImpl: this._fetch });
      const result = await provider.generateStructured({
        system,
        user,
        schema: llmSchemaFor(request),
        maxOutputTokens: isSummary ? MAX_OUTPUT_TOKENS.summary : MAX_OUTPUT_TOKENS.feedback,
        reasoning: 'minimal',
        timeoutMs: this._timeoutMs,
        signal: controller.signal,
      });
      // §5.3: ninguna respuesta del LLM se muestra sin pasar la validación.
      const checked = validateOutput(normalizeLlmOutput(result.data, request), request, { forbiddenSquares });
      log({ ok: checked.ok, kind: checked.ok ? null : 'invalid_output', model: result.model, usage: result.usage, latencyMs: result.latencyMs });
      if (!checked.ok) {
        console.warn('Respuesta del LLM descartada por la validación (§5.3), se usa la plantilla:', checked.errors.slice(0, 3));
        this._setConnection('online');
        return { ok: false, kind: 'invalid_output' };
      }
      const meta = { provider: config.provider, model: result.model, promptVersion: PROMPT_VERSION, latencyMs: result.latencyMs };
      this._cacheSet(fullKey, { data: checked.data, meta });
      this._setConnection('online');
      return { ok: true, data: checked.data, meta, cached: false };
    } catch (err) {
      const kind = err instanceof LlmError ? err.kind : 'network';
      // Abortada (otra petición la reemplazó): el proveedor pudo cobrarla, pero no lo sabemos.
      log({ ok: false, kind, usage: null });
      if (kind === 'aborted') return { ok: false, kind };
      // Si el usuario cambió la configuración mientras tanto, el error ya no aplica.
      if (signature === this._signature) this._handleFailure(kind, err?.retryAfterMs);
      if (kind !== 'invalid_output' && kind !== 'safety_blocked') console.warn(`IA del coach (${config.provider}): ${err?.message ?? err}`);
      return { ok: false, kind };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (this._inFlight === controller) this._inFlight = null;
    }
  }

  _handleFailure(kind, retryAfterMs) {
    if (DISABLING.has(kind)) {
      this._disabledKind = kind;
      this._setConnection('disabled');
      return;
    }
    if (kind === 'rate_limited' || kind === 'unavailable') {
      this._pausedUntil = this._now() + Math.max(MIN_BACKOFF_MS, retryAfterMs ?? 0);
      this._setConnection('paused');
      return;
    }
    if (kind === 'network' || kind === 'timeout') {
      this._setConnection('offline');
      return;
    }
    // invalid_output, safety_blocked…: queda la plantilla, el proveedor sigue vivo.
    this._setConnection('online');
  }
}
