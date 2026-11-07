// Importación de partidas de Chess.com por nombre de usuario (Published-Data API, sin login).
// https://www.chess.com/news/view/published-data-api
//   GET https://api.chess.com/pub/player/{username}/games/archives   → { archives: [url de cada mes] }
//   GET https://api.chess.com/pub/player/{username}/games/{YYYY}/{MM} → { games: [{ pgn, rules, … }] }
// Se usa el JSON mensual (cada partida trae su PGN completo con relojes) porque además dice si es
// ajedrez estándar (`rules: 'chess'`) y trae un id estable (`uuid`). Peticiones en serie, nunca en
// paralelo (en paralelo Chess.com puede responder 429). Escaque no está afiliado a Chess.com.
//
// CORS: la documentación no lo menciona y en su foro hay reportes de fallos de CORS intermitentes
// desde el navegador. Por eso se intenta directo y, si el navegador bloquea la respuesta, se reintenta
// por el reenvío del Worker (`/api/proxy/chesscom/…`, ver worker/proxy.js).
import { normalizeChessComGame } from './normalize.js';
import { ImportError, getWithRetry, isAbort, runSerial } from './net.js';
import { getGameIds, getImportMark, saveNewGames, setImportMark } from './store.js';
import { DEFAULT_MAX_GAMES } from './lichess.js';

export const CHESSCOM_API = 'https://api.chess.com';
export const CHESSCOM_PROXY = '/api/proxy/chesscom';
// Aviso de no afiliación (obligatorio junto al importador): `myGames.chesscomDisclaimer`.

const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
export const isValidChessComUsername = (u) => USERNAME_RE.test(String(u ?? '').trim());

/** 'https://api.chess.com/pub/player/x/games/2026/10' → '2026/10' (o null si no es un archivo mensual). */
export function archiveMonth(url) {
  const m = /^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/(\d{4})\/(\d{2})\/?$/.exec(String(url ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Último instante (ms, UTC) del mes 'AAAA/MM'. */
const monthEndMs = (month) => {
  const [y, m] = month.split('/').map(Number);
  return Date.UTC(y, m, 1) - 1;
};

/**
 * GET JSON a la API; si el navegador bloquea la respuesta (CORS o red), reintenta por el Worker.
 * @returns {Promise<Response>}
 */
async function getJson(path, { fetchImpl = globalThis.fetch, signal, waitMs, onWait, proxyBase = CHESSCOM_PROXY }) {
  const opts = { fetchImpl, signal, waitMs, onWait, headers: { Accept: 'application/json' } };
  try {
    return await getWithRetry(`${CHESSCOM_API}${path}`, opts);
  } catch (e) {
    if (isAbort(e) || e instanceof ImportError || !proxyBase) throw e;
  }
  let res;
  try {
    res = await getWithRetry(`${proxyBase}${path}`, opts);
  } catch (e) {
    if (isAbort(e) || e instanceof ImportError) throw e;
    throw new ImportError('network', 'No se pudo conectar con Chess.com. Revisa tu conexión.', { textKey: 'importErr.network', vars: { site: 'Chess.com' } });
  }
  // Sin Worker (p. ej. `vite preview`), la ruta del reenvío no existe o devuelve el HTML de la app.
  if (res.status === 502 || (res.status !== 404 && !/json/i.test(res.headers.get('Content-Type') ?? ''))) {
    throw new ImportError('network', 'No se pudo conectar con Chess.com. Revisa tu conexión.', { textKey: 'importErr.network', vars: { site: 'Chess.com' } });
  }
  return res;
}

/**
 * Importa las partidas de ajedrez estándar de un usuario de Chess.com.
 * Primera vez: de la más reciente hacia atrás hasta `max` partidas (o desde `since`). Después, por
 * defecto, solo los meses desde la última importación (el último se vuelve a leer: pudo crecer).
 * @param {string} username
 * @param {{max?:number|null, since?:number|null, incremental?:boolean, signal?:AbortSignal,
 *   onProgress?:(p:import('./lichess.js').ImportProgress)=>void, fetchImpl?:typeof fetch,
 *   waitMs?:number, proxyBase?:string|null, now?:()=>number}} [opts]
 * @returns {Promise<import('./lichess.js').ImportResult>}
 */
export function importChessCom(username, opts = {}) {
  return runSerial('chesscom', () => doImport(username, opts));
}

async function doImport(rawUsername, { max = DEFAULT_MAX_GAMES, since = null, incremental = true, signal, onProgress, fetchImpl, waitMs, proxyBase, now = Date.now } = {}) {
  const username = String(rawUsername ?? '').trim();
  if (!isValidChessComUsername(username)) throw new ImportError('invalid_user', 'Nombre de usuario de Chess.com no válido.', { textKey: 'importErr.invalidUser', vars: { site: 'Chess.com' } });
  const user = encodeURIComponent(username.toLowerCase());
  let received = 0;
  let added = 0;
  let skipped = 0;
  const report = (p) => onProgress?.({ source: 'chesscom', received, added, total: null, ...p });
  const net = (extra = {}) => ({ fetchImpl, signal, waitMs, proxyBase, onWait: (ms) => report({ phase: 'waiting', waitMs: ms, ...extra }) });

  report({ phase: 'connecting' });
  const resArchives = await getJson(`/pub/player/${user}/games/archives`, net());
  if (resArchives.status === 404) throw new ImportError('not_found', `Chess.com no tiene el usuario «${username}».`, { textKey: 'importErr.notFound', vars: { site: 'Chess.com', username } });
  if (!resArchives.ok) throw new ImportError('http', `Chess.com respondió ${resArchives.status}.`, { textKey: 'importErr.http', vars: { site: 'Chess.com', status: resArchives.status } });
  const archives = ((await resArchives.json())?.archives ?? []).map(archiveMonth).filter(Boolean).sort();

  const mark = await getImportMark('chesscom', username);
  const useMark = Boolean(incremental && mark?.lastArchive);
  const sinceMonth = since ? new Date(since).toISOString().slice(0, 7).replace('-', '/') : null;
  // Con marca: desde el último mes leído (se repite si no había terminado: pudo crecer).
  const fromMark = (m) => !useMark || (mark.monthClosed ? m > mark.lastArchive : m >= mark.lastArchive);
  let months = archives.filter((m) => (!sinceMonth || m >= sinceMonth) && fromMark(m));
  // Incremental: del más antiguo pendiente al más nuevo. Primera vez: del más nuevo hacia atrás.
  if (!useMark) months = months.reverse();
  const limit = useMark ? null : max;

  const known = await getGameIds();
  const importedAt = now();
  let lastDone = mark?.lastArchive ?? null;
  let aborted = false;
  let hasMore = false;
  try {
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      if (limit && received >= limit) {
        hasMore = true;
        break;
      }
      const detail = `${month} (${i + 1} de ${months.length})`;
      report({ phase: 'reading', detail });
      const res = await getJson(`/pub/player/${user}/games/${month}`, net({ detail }));
      if (res.status === 404) continue; // mes sin partidas
      if (!res.ok) throw new ImportError('http', `Chess.com respondió ${res.status} para ${month}.`, { textKey: 'importErr.httpMonth', vars: { site: 'Chess.com', status: res.status, month } });
      let games = ((await res.json())?.games ?? []).filter((g) => !since || Number(g?.end_time) * 1000 >= since);
      games.sort((a, b) => (useMark ? a.end_time - b.end_time : b.end_time - a.end_time));
      if (limit) {
        if (games.length > limit - received) hasMore = true;
        games = games.slice(0, limit - received);
      }
      const normalized = [];
      for (const g of games) {
        const n = normalizeChessComGame(g, username, importedAt);
        if (n) normalized.push(n);
        else skipped++;
      }
      received += games.length;
      added += await saveNewGames(normalized, known);
      if (!lastDone || month > lastDone) lastDone = month;
      report({ phase: 'reading', detail });
    }
  } catch (e) {
    if (!isAbort(e) && !signal?.aborted) throw e;
    aborted = true;
  }

  // Un mes ya terminado y leído entero no se vuelve a pedir (`monthClosed`); el mes en curso sí.
  if (lastDone && (!aborted || useMark)) {
    await setImportMark('chesscom', username, {
      lastArchive: lastDone,
      monthClosed: monthEndMs(lastDone) < importedAt,
      lastImportAt: importedAt,
      total: (mark?.total ?? 0) + added,
    });
  }
  report({ phase: 'done' });
  return { received, added, skipped, incremental: useMark, hasMore, aborted };
}
