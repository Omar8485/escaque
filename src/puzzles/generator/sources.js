// Conversión de partidas de archivos (PGN o JSON) al tipo `Game` de src/storage/db.js.
// Solo lo usan el script de Node (scripts/build-puzzles.mjs), los tests y el sembrado de
// pruebas en el navegador (scripts/e2e-puzzles.cjs). La app no lo importa: no entra en el bundle.

/**
 * @typedef {import('../../storage/db.js').Game} Game
 */

/** Separa un archivo PGN con varias partidas. */
export function splitPgn(text) {
  const parts = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n(?=\s*\[Event\s)/);
  return parts.map((p) => p.trim()).filter((p) => /\S/.test(p.replace(/\[[^\]]*\]/g, '')));
}

/** Cabeceras `[Tag "valor"]` de un PGN. */
export function pgnHeaders(pgn) {
  const out = {};
  for (const m of String(pgn).matchAll(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/gm)) out[m[1]] = m[2];
  return out;
}

const toNum = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** 'YYYY.MM.DD' (+ 'HH:MM:SS' UTC opcional) → ms. Fechas incompletas ('????') → null. */
export function pgnDateToMs(date, time) {
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(String(date ?? ''));
  if (!m) return null;
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(time ?? '')) ?? [null, '12', '00', '00'];
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), Number(t[3]));
}

/** Ritmo según el control de tiempo (estimación de Lichess: base + 40 × incremento). */
export function speedOf(timeControl) {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(String(timeControl ?? ''));
  if (!m) return 'unknown';
  const total = Number(m[1]) + 40 * Number(m[2] ?? 0);
  if (total < 30) return 'ultraBullet';
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const colorOf = (user, white, black) => {
  const u = String(user ?? '').toLowerCase();
  if (!u) return null;
  if (String(white).toLowerCase() === u) return 'w';
  if (String(black).toLowerCase() === u) return 'b';
  return null;
};

/**
 * Una partida PGN → Game.
 * @param {string} pgn
 * @param {{user?:string, importedAt?:number, fallbackEndTime?:number}} [o]
 * @returns {Game}
 */
export function gameFromPgn(pgn, { user = '', importedAt = Date.now(), fallbackEndTime = 0 } = {}) {
  const h = pgnHeaders(pgn);
  const site = h.Site ?? '';
  const lichess = /lichess\.org\/(\w{8})/.exec(site);
  const chesscom = /chess\.com\/game\/(?:live\/|daily\/)?(\d+)/.exec(h.Link ?? site);
  const source = lichess ? 'lichess' : chesscom ? 'chesscom' : 'pgn';
  const externalId = lichess?.[1] ?? chesscom?.[1] ?? hash(pgn);
  const timeControl = h.TimeControl && h.TimeControl !== '-' ? h.TimeControl : null;
  return {
    id: `${source}:${externalId}`,
    source,
    externalId,
    url: lichess ? `https://lichess.org/${lichess[1]}` : chesscom ? (h.Link ?? site) : null,
    white: h.White ?? '?',
    black: h.Black ?? '?',
    whiteElo: toNum(h.WhiteElo),
    blackElo: toNum(h.BlackElo),
    result: ['1-0', '0-1', '1/2-1/2'].includes(h.Result) ? h.Result : '*',
    endTime: pgnDateToMs(h.EndDate ?? h.UTCDate ?? h.Date, h.EndTime ?? h.UTCTime) ?? fallbackEndTime,
    timeControl,
    speed: speedOf(timeControl),
    rated: /rated/i.test(h.Event ?? '') ? !/unrated|casual/i.test(h.Event) : null,
    variant: !h.Variant || /standard|from position/i.test(h.Variant) ? 'standard' : h.Variant.toLowerCase(),
    eco: h.ECO ?? null,
    opening: h.Opening ?? null,
    termination: h.Termination ?? null,
    pgn,
    playerName: user,
    playerColor: colorOf(user, h.White, h.Black),
    importedAt,
  };
}

/**
 * Partida del formato antiguo de src/data/partidas.json (campos en español) → Game.
 * `order` desempata partidas del mismo día (el archivo va de la más reciente a la más antigua).
 */
export function gameFromLegacy(p, { user = 'jugador_demo', importedAt = Date.now(), order = 0 } = {}) {
  const id = String(p.sitio ?? '').split('/').pop() || hash(p.movimientos ?? '');
  const lichess = /lichess\.org/.test(p.sitio ?? '');
  const tags = [
    ['Event', p.evento],
    ['Site', p.sitio],
    ['Date', p.fecha],
    ['White', p.blancas],
    ['Black', p.negras],
    ['Result', p.resultado],
    ['WhiteElo', p.elo_blancas],
    ['BlackElo', p.elo_negras],
    ['TimeControl', p.control_tiempo],
    ['ECO', p.eco],
    ['Opening', p.apertura],
    ['Termination', p.terminacion],
  ]
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`)
    .join('\n');
  const base = pgnDateToMs(p.fecha) ?? 0;
  return {
    id: `${lichess ? 'lichess' : 'pgn'}:${id}`,
    source: lichess ? 'lichess' : 'pgn',
    externalId: id,
    url: lichess ? p.sitio : null,
    white: p.blancas,
    black: p.negras,
    whiteElo: toNum(p.elo_blancas),
    blackElo: toNum(p.elo_negras),
    result: p.resultado ?? '*',
    // Mediodía UTC del día menos `order` minutos: conserva el orden del archivo dentro del día.
    endTime: base - order * 60000,
    timeControl: p.control_tiempo ?? null,
    speed: speedOf(p.control_tiempo),
    rated: /rated/i.test(p.evento ?? '') ? !/casual/i.test(p.evento) : null,
    variant: 'standard',
    eco: p.eco ?? null,
    opening: p.apertura ?? null,
    termination: p.terminacion ?? null,
    pgn: `${tags}\n\n${p.movimientos}`,
    playerName: user,
    playerColor: colorOf(user, p.blancas, p.negras),
    importedAt,
  };
}

/**
 * Lee partidas de un archivo: PGN (varias partidas), JSON con `Game[]` o el formato antiguo
 * (array con `movimientos`). Devuelve de la más reciente a la más antigua.
 * @param {string} text
 * @param {{user?:string, format?:'pgn'|'json'}} [o]
 * @returns {Game[]}
 */
export function gamesFromText(text, { user = '', format } = {}) {
  const fmt = format ?? (/^\s*[[{]/.test(text) && !/^\s*\[\w+\s+"/.test(text) ? 'json' : 'pgn');
  let games;
  if (fmt === 'pgn') {
    games = splitPgn(text).map((pgn, i) => gameFromPgn(pgn, { user, fallbackEndTime: -i }));
  } else {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data.games ?? []);
    games = list.map((g, i) => {
      if (g.movimientos) return gameFromLegacy(g, { user: user || 'jugador_demo', order: i });
      if (g.pgn && g.id) return { ...g, playerColor: g.playerColor ?? colorOf(user || g.playerName, g.white, g.black) };
      throw new Error(`Partida ${i} sin "pgn" ni "movimientos"`);
    });
  }
  const seen = new Set();
  return games
    .filter((g) => (seen.has(g.id) ? false : seen.add(g.id)))
    .sort((a, b) => b.endTime - a.endTime);
}

