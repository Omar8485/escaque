// Red para la importación: una petición a la vez por servicio y espera ante 429.

export class ImportError extends Error {
  /**
   * `message` queda en español (consola y tests); la interfaz muestra `textKey` + `vars` traducidos
   * con `importErrorText(err, t)`.
   * @param {'not_found'|'rate_limited'|'network'|'http'|'invalid_user'|'aborted'} kind
   * @param {string} message
   * @param {{textKey?: string, vars?: Record<string, unknown>} & Record<string, unknown>} [extra]
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ImportError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** Texto de un error de importación en el idioma de `t` (otros errores: su mensaje tal cual). */
export const importErrorText = (err, t) => (err?.textKey ? t(err.textKey, err.vars) : err?.message ?? String(err));

export const isAbort = (e) => e?.name === 'AbortError' || e?.kind === 'aborted';

const abortError = () => new DOMException('Importación cancelada', 'AbortError');

/** Espera `ms` o hasta que se cancele. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Cola en serie: cada servicio atiende una sola operación a la vez (reglas de Lichess y de
 * Chess.com). Una importación entera ocupa la cola de su servicio hasta terminar.
 */
const queues = new Map();
export function runSerial(key, fn) {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  queues.set(key, run.catch(() => {}));
  return run;
}

/** Segundos de `Retry-After` (número o fecha HTTP); si no hay, `fallbackMs`. */
export function retryAfterMs(res, fallbackMs) {
  const h = res?.headers?.get?.('Retry-After');
  if (!h) return fallbackMs;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.max(1000, n * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(1000, at - Date.now()) : fallbackMs;
}

/**
 * GET con reintento ante 429: espera lo que indique `Retry-After` o `waitMs` (1 min por defecto,
 * lo que piden Lichess y Chess.com) y vuelve a intentarlo hasta `maxRetries` veces.
 * @param {string} url
 * @param {{fetchImpl?:typeof fetch, signal?:AbortSignal, headers?:Record<string,string>,
 *   waitMs?:number, maxRetries?:number, onWait?:(ms:number)=>void}} [opts]
 */
export async function getWithRetry(url, { fetchImpl = globalThis.fetch, signal, headers, waitMs = 60_000, maxRetries = 3, onWait } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { method: 'GET', headers, signal, credentials: 'omit', mode: 'cors' });
    if (res.status !== 429) return res;
    if (attempt >= maxRetries) throw new ImportError('rate_limited', 'El servicio sigue limitando las peticiones; prueba más tarde.', { textKey: 'importErr.rateLimited' });
    const ms = retryAfterMs(res, waitMs);
    try {
      await res.body?.cancel();
    } catch {
      // cuerpo ya consumido
    }
    onWait?.(ms);
    await sleep(ms, signal);
  }
}
