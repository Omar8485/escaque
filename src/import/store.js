// Partidas importadas y datos de importación sobre el contrato de src/storage/db.js.
// Claves en `meta`:
//   accounts                       { lichess?: string, chesscom?: string }  cuentas vinculadas
//   import:lichess:<usuario>       { lastCreatedAt, lastImportAt, total }    marca incremental
//   import:chesscom:<usuario>      { lastArchive: 'AAAA/MM', lastImportAt, total }
import { STORES, clearGameData, saveTrainingGame, removeTrainingGame, getMeta, listGamesNewestFirst, openDb, putMany, removeMetaByPrefix, setMeta } from '../storage/db.js';

/** @typedef {import('../storage/db.js').Game} Game */

const listeners = new Set();
/** Avisa a quien muestre partidas (App, Mis partidas) de que cambiaron. */
export function onGamesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());
/** Para quien cambia partidas por otra vía (p. ej. la sincronización entre dispositivos). */
export const notifyGamesChanged = notify;

/** Ids de todas las partidas guardadas (sin leer los PGN). */
export async function getGameIds() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.games, 'readonly').objectStore(STORES.games).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result));
    req.onerror = () => reject(req.error);
  });
}

/**
 * Guarda solo las partidas que no estaban (una partida terminada no cambia: no se reescribe,
 * así se conserva su `importedAt` y lo que otros módulos hayan calculado con ella).
 * @param {Game[]} games
 * @param {Set<string>} [knownIds] ids ya guardados (se actualiza con los nuevos)
 * @returns {Promise<number>} cuántas eran nuevas
 */
export async function saveNewGames(games, knownIds) {
  const known = knownIds ?? (await getGameIds());
  const fresh = [];
  for (const g of games) {
    if (!g || known.has(g.id)) continue;
    known.add(g.id);
    fresh.push(g);
  }
  if (fresh.length) {
    await putMany(STORES.games, fresh);
    notify();
  }
  return fresh.length;
}

/** Guarda la partida local y notifica también a Análisis y Mis partidas. */
let writeQueue = Promise.resolve();
let gamesEpoch = 0;
export function savePlayedGame(record) {
  const epoch = gamesEpoch;
  const writing = writeQueue.catch(() => {}).then(async () => {
    if (epoch !== gamesEpoch) return;
    await saveTrainingGame(record);
    notify();
  });
  writeQueue = writing;
  return writing;
}

/** Un mate o tablas deshechos vuelven a ser una partida en curso. */
export function removePlayedGame(id) {
  const writing = writeQueue.catch(() => {}).then(async () => {
    await removeTrainingGame(id);
    notify();
  });
  writeQueue = writing;
  return writing;
}

export const listGames = () => listGamesNewestFirst();

/** Borra todas las partidas, sus análisis y las marcas de importación (las cuentas se mantienen). */
export async function clearAllGames() {
  gamesEpoch += 1;
  await writeQueue.catch(() => {});
  await clearGameData();
  await removeMetaByPrefix('import:');
  notify();
}

/** @returns {Promise<{lichess?:string, chesscom?:string}>} */
export const getAccounts = async () => (await getMeta('accounts')) ?? {};
export async function setAccount(source, username) {
  const accounts = { ...(await getAccounts()) };
  if (username) accounts[source] = username;
  else delete accounts[source];
  await setMeta('accounts', accounts);
  return accounts;
}

const markKey = (source, username) => `import:${source}:${String(username).toLowerCase()}`;
export const getImportMark = (source, username) => getMeta(markKey(source, username));
export const setImportMark = (source, username, value) => setMeta(markKey(source, username), value);
