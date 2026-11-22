// Utilidades compartidas por los adaptadores: POST JSON con timeout y cancelación, traducción de
// errores HTTP y parseo robusto del JSON que devuelve el modelo.
import { LlmError } from './errors.js';

/** Segundos de `retry-after` → ms (mínimo razonable si no viene). */
export function retryAfterMs(res, fallback = 60_000) {
  const s = Number(res?.headers?.get?.('retry-after'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : fallback;
}

/** Mapeo genérico de un estado HTTP a LlmErrorKind (los adaptadores lo afinan). */
export function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 404) return 'model_not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
}

/** Lee el cuerpo de un error sin lanzar: {text, json}. */
async function readErrorBody(res) {
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { text, json };
}

/**
 * POST JSON con timeout y cancelación. Devuelve el JSON de la respuesta o lanza LlmError.
 * @param {object} p
 * @param {typeof fetch} p.fetchImpl
 * @param {string} p.url
 * @param {Record<string,string>} p.headers
 * @param {object} p.body
 * @param {number} p.timeoutMs
 * @param {AbortSignal} [p.signal]
 * @param {string} p.provider
 * @param {string} p.model
 * @param {(status: number, body: {text: string, json: any}, res: Response) => LlmError} [p.mapError]
 */
export async function postJson({ fetchImpl, url, headers, body, timeoutMs, signal, provider, model, mapError }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const errBody = await readErrorBody(res);
      const err = mapError?.(res.status, errBody, res);
      if (err) throw err;
      const kind = kindForStatus(res.status);
      throw new LlmError(kind, `${provider} ${res.status}: ${errBody.text.slice(0, 300)}`, {
        status: res.status,
        provider,
        model,
        retryAfterMs: kind === 'rate_limited' || kind === 'unavailable' ? retryAfterMs(res) : undefined,
      });
    }
    try {
      return await res.json();
    } catch {
      throw new LlmError('invalid_output', `${provider}: la respuesta HTTP no es JSON`, { provider, model, status: res.status });
    }
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (timedOut) throw new LlmError('timeout', `${provider} no respondió en ${timeoutMs} ms`, { provider, model });
    if (controller.signal.aborted) throw new LlmError('aborted', `${provider}: petición cancelada`, { provider, model });
    // fetch rechaza con TypeError tanto sin red como con un bloqueo CORS: el navegador no deja distinguirlos.
    throw new LlmError('network', `${provider}: ${err?.message ?? err}`, { provider, model });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Parseo robusto del texto del modelo: JSON directo, dentro de ```json … ``` o el primer objeto
 * {…} del texto (para proveedores sin salida estructurada nativa). Lanza LlmError si no hay JSON.
 * @param {string} text
 * @param {{provider?: string, model?: string}} [ctx]
 */
export function parseJsonText(text, { provider = 'unknown', model } = {}) {
  const raw = String(text ?? '').trim();
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // siguiente candidato
    }
  }
  throw new LlmError('invalid_output', `${provider}: el modelo no devolvió JSON (${raw.slice(0, 120)})`, { provider, model });
}

/** Quita la barra final de una URL base. */
export function trimBase(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}
