// Importación de partidas de Lichess por nombre de usuario, sin login.
//
// API pública: GET https://lichess.org/api/games/user/{username} con `Accept: application/x-ndjson`
// (https://lichess.org/api#tag/games/GET/api/games/user/{username}). La respuesta llega en streaming,
// una partida por línea, y lleva `Access-Control-Allow-Origin: *`, así que se pide desde el navegador.
// Reglas de uso: una petición a la vez; ante 429, esperar (1 minuto suele bastar).
import { normalizeLichessGame } from './normalize.js';
import { ImportError, getWithRetry, isAbort, runSerial } from './net.js';
import { getGameIds, getImportMark, saveNewGames, setImportMark } from './store.js';

export const LICHESS_ORIGIN = 'https://lichess.org';
export const DEFAULT_MAX_GAMES = 200;
/** Solo ritmos de ajedrez estándar (excluye chess960, crazyhouse, etc. en el servidor). */
export const LICHESS_PERF_TYPES = 'ultraBullet,bullet,blitz,rapid,classical,correspondence';

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;
export const isValidLichessUsername = (u) => USERNAME_RE.test(String(u ?? '').trim());

/**
 * URL de exportación.
 * @param {string} username
 * @param {{max?:number|null, since?:number|null, sort?:'dateDesc'|'dateAsc'}} [opts]
 */
export function buildLichessUrl(username, { max = DEFAULT_MAX_GAMES, since = null, sort = 'dateDesc' } = {}) {
  const p = new URLSearchParams({
    perfType: LICHESS_PERF_TYPES,
    finished: 'true',
    ongoing: 'false',
    moves: 'true',
    tags: 'true',
    pgnInJson: 'true',
    clocks: 'true',
    opening: 'true',
    sort,
  });
  if (max) p.set('max', String(max));
  if (since) p.set('since', String(Math.floor(since)));
  return `${LICHESS_ORIGIN}/api/games/user/${encodeURIComponent(username)}?${p}`;
}

/**
 * Lee un cuerpo NDJSON a medida que llega y llama a `onObject` por cada línea.
 * @param {Response} res
 * @param {(obj:any)=>void|Promise<void>} onObject
 */
export async function readNdjson(res, onObject) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = async (line) => {
    const s = line.trim();
    if (!s) return;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      return; // línea corrupta: se ignora
    }
    await onObject(obj);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        await flush(line);
      }
    }
  } catch (e) {
    try {
      await reader.cancel();
    } catch {
      // ya cerrado
    }
    throw e;
  }
  buffer += decoder.decode();
  await flush(buffer);
}

/**
 * @typedef {Object} ImportProgress
 * @property {'lichess'|'chesscom'|'pgn'} source
 * @property {'connecting'|'reading'|'waiting'|'saving'|'done'} phase
 * @property {number} received   partidas leídas (todas)
 * @property {number} added      nuevas guardadas
 * @property {number|null} [total]   máximo esperado, si se sabe
 * @property {number} [waitMs]   en 'waiting': espera pedida por el servicio
 * @property {string} [detail]
 */

/**
 * @typedef {Object} ImportResult
 * @property {number} received   partidas recibidas del servicio
 * @property {number} added      nuevas guardadas
 * @property {number} skipped    descartadas (variantes, sin jugadas…)
 * @property {boolean} incremental
 * @property {boolean} hasMore   se alcanzó el máximo: puede haber más
 * @property {boolean} aborted
 */

/**
 * Importa las partidas estándar de un usuario de Lichess.
 * Primera vez: las últimas `max` (o las jugadas desde `since`). Después, por defecto, solo las
 * nuevas desde la última importación (`since` = última marca, en orden ascendente: sin huecos
 * aunque haya más de `max` nuevas; la siguiente importación continúa donde quedó).
 * @param {string} username
 * @param {{max?:number|null, since?:number|null, incremental?:boolean, signal?:AbortSignal,
 *   onProgress?:(p:ImportProgress)=>void, fetchImpl?:typeof fetch, waitMs?:number, now?:()=>number}} [opts]
 * @returns {Promise<ImportResult>}
 */
export function importLichess(username, opts = {}) {
  return runSerial('lichess', () => doImport(username, opts));
}

async function doImport(rawUsername, { max = DEFAULT_MAX_GAMES, since = null, incremental = true, signal, onProgress, fetchImpl, waitMs, now = Date.now } = {}) {
  const username = String(rawUsername ?? '').trim();
  if (!isValidLichessUsername(username)) throw new ImportError('invalid_user', 'Nombre de usuario de Lichess no válido.', { textKey: 'importErr.invalidUser', vars: { site: 'Lichess' } });
  const report = (p) => onProgress?.({ source: 'lichess', received: 0, added: 0, total: max ?? null, ...p });

  const mark = await getImportMark('lichess', username);
  const useMark = Boolean(incremental && mark?.lastCreatedAt);
  const effectiveSince = useMark ? Math.max(since ?? 0, mark.lastCreatedAt + 1) : since;
  const sort = useMark ? 'dateAsc' : 'dateDesc';
  const url = buildLichessUrl(username, { max, since: effectiveSince, sort });

  report({ phase: 'connecting' });
  let res;
  try {
    res = await getWithRetry(url, {
      fetchImpl,
      signal,
      waitMs,
      headers: { Accept: 'application/x-ndjson' },
      onWait: (ms) => report({ phase: 'waiting', waitMs: ms }),
    });
  } catch (e) {
    if (isAbort(e) || e instanceof ImportError) throw e;
    throw new ImportError('network', 'No se pudo conectar con Lichess. Revisa tu conexión.', { textKey: 'importErr.network', vars: { site: 'Lichess' } });
  }
  if (res.status === 404) throw new ImportError('not_found', `Lichess no tiene el usuario «${username}».`, { textKey: 'importErr.notFound', vars: { site: 'Lichess', username } });
  if (!res.ok || !res.body) throw new ImportError('http', `Lichess respondió ${res.status}.`, { textKey: 'importErr.http', vars: { site: 'Lichess', status: res.status } });

  const known = await getGameIds();
  let received = 0;
  let added = 0;
  let skipped = 0;
  let maxCreatedAt = mark?.lastCreatedAt ?? 0;
  let batch = [];
  const importedAt = now();
  const save = async () => {
    if (!batch.length) return;
    const b = batch;
    batch = [];
    added += await saveNewGames(b, known);
  };

  let aborted = false;
  try {
    await readNdjson(res, async (obj) => {
      if (signal?.aborted) throw new DOMException('Importación cancelada', 'AbortError');
      received++;
      if (Number(obj?.createdAt) > maxCreatedAt) maxCreatedAt = Number(obj.createdAt);
      const game = normalizeLichessGame(obj, username, importedAt);
      if (game) batch.push(game);
      else skipped++;
      if (batch.length >= 50) await save();
      report({ phase: 'reading', received, added: added + batch.length });
    });
  } catch (e) {
    if (!isAbort(e) && !signal?.aborted) {
      await save();
      throw new ImportError('network', 'Se cortó la conexión con Lichess. Lo leído quedó guardado; vuelve a importar.', { textKey: 'importErr.cut', vars: { site: 'Lichess' } });
    }
    aborted = true;
  }
  await save();

  // La marca avanza si la lectura fue completa, o si era ascendente (lo leído no deja huecos).
  if (!aborted || useMark) {
    await setImportMark('lichess', username, {
      lastCreatedAt: maxCreatedAt,
      lastImportAt: importedAt,
      total: (mark?.total ?? 0) + added,
    });
  }
  const result = { received, added, skipped, incremental: useMark, hasMore: Boolean(max && received >= max), aborted };
  report({ phase: 'done', received, added });
  return result;
}
