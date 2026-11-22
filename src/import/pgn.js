// Importación de archivos .pgn (de cualquier plataforma), con varias partidas por archivo.
// Paso 1 `readPgnFiles`: separa las partidas, calcula su hash y propone quién es el usuario
// (el nombre que más se repite en White/Black). Paso 2 `importPgnGames`: guarda con ese nombre.
import { normalizePgnGame, parsePgnHeaders } from './normalize.js';
import { getGameIds, saveNewGames } from './store.js';

/**
 * Separa un texto PGN en partidas. Una partida empieza en una línea `[Tag "…"]` que viene después
 * de jugadas (o al principio). Tolera BOM, CRLF y líneas en blanco de más.
 * @param {string} text
 * @returns {string[]}
 */
export function splitPgn(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const games = [];
  let cur = [];
  let inMoves = false;
  let inComment = false;
  const push = () => {
    const g = cur.join('\n').trim();
    if (g) games.push(g);
    cur = [];
  };
  for (const line of lines) {
    const t = line.trim();
    const isTag = !inComment && /^\[[A-Za-z0-9_]+\s+".*"\s*\]$/.test(t);
    if (isTag && inMoves) {
      push();
      inMoves = false;
    }
    if (!isTag && t && !t.startsWith('%')) inMoves = true;
    // Comentarios { … } de varias líneas: dentro, una línea con corchetes no es una cabecera.
    for (const ch of isTag ? '' : line) {
      if (ch === '{') inComment = true;
      else if (ch === '}') inComment = false;
    }
    cur.push(line);
  }
  push();
  return games;
}

/** Texto canónico de una partida para el hash: mismo contenido → mismo id. */
export const canonicalPgn = (pgn) => String(pgn).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n\n').trim();

/** SHA-256 (hex, 24 caracteres) del texto canónico. */
export async function hashPgn(pgn) {
  const data = new TextEncoder().encode(canonicalPgn(pgn));
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Nombres que aparecen como White/Black, del más frecuente al menos frecuente.
 * @param {{headers:Record<string,string>}[]} entries
 * @returns {{name:string, count:number}[]}
 */
export function detectPlayer(entries) {
  /** @type {Map<string, {name:string, count:number}>} */
  const counts = new Map();
  for (const e of entries) {
    for (const raw of [e.headers.White, e.headers.Black]) {
      const name = raw?.trim();
      if (!name || name === '?') continue;
      const key = name.toLowerCase();
      const cur = counts.get(key) ?? { name, count: 0 };
      cur.count++;
      counts.set(key, cur);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * @typedef {{pgn:string, headers:Record<string,string>, hash:string, file:string}} PgnEntry
 * @typedef {{entries:PgnEntry[], candidates:{name:string,count:number}[], suggested:string|null,
 *   files:number, duplicates:number}} PgnReadResult
 */

/**
 * Lee uno o varios archivos (File o {name, text()}) y separa sus partidas.
 * @param {Iterable<{name:string, text:()=>Promise<string>}>} files
 * @returns {Promise<PgnReadResult>}
 */
export async function readPgnFiles(files) {
  /** @type {PgnEntry[]} */
  const entries = [];
  const seen = new Set();
  let duplicates = 0;
  let count = 0;
  for (const file of files) {
    count++;
    const text = await file.text();
    for (const pgn of splitPgn(text)) {
      const hash = await hashPgn(pgn);
      if (seen.has(hash)) {
        duplicates++;
        continue;
      }
      seen.add(hash);
      entries.push({ pgn, headers: parsePgnHeaders(pgn), hash, file: file.name });
    }
  }
  const candidates = detectPlayer(entries);
  // Se sugiere el más frecuente si aparece en al menos la mitad de las partidas.
  const top = candidates[0];
  const suggested = top && (top.count >= entries.length / 2 || entries.length === 1) && top.count > (candidates[1]?.count ?? 0) ? top.name : null;
  return { entries, candidates, suggested, files: count, duplicates };
}

/**
 * Normaliza y guarda las partidas leídas.
 * @param {PgnEntry[]} entries
 * @param {string|null} playerName quién es el usuario en esas partidas (null: desconocido)
 * @param {{now?:number}} [opts]
 * @returns {Promise<{received:number, added:number, skipped:number}>}
 */
export async function importPgnGames(entries, playerName, { now = Date.now() } = {}) {
  const games = [];
  let skipped = 0;
  for (const e of entries) {
    const g = normalizePgnGame(e, playerName, now);
    if (g) games.push(g);
    else skipped++;
  }
  const added = await saveNewGames(games, await getGameIds());
  return { received: entries.length, added, skipped };
}
