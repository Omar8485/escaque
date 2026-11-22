// Conversión de cada fuente (Lichess, Chess.com, archivo PGN) al tipo `Game` de src/storage/db.js.
// Solo ajedrez estándar desde la posición inicial: variantes, partidas desde una posición
// (Chess960, odds, "From Position"…) y partidas sin jugadas se descartan (devuelven null).

/** @typedef {import('../storage/db.js').Game} Game */
/** @typedef {Game['speed']} Speed */

export const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Ritmos en el orden de Lichess (de más rápido a más lento). */
export const SPEEDS = /** @type {const} */ (['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence']);

// Nombres visibles de ritmos y fuentes: diccionario (`speed.*`, `myGames.sourceName.*`).

/**
 * Nombre de jugador para mostrar. La importación guarda en español los que faltan ("Anónimo",
 * "Stockfish nivel N", ver lichessName); aquí se traducen con `t`. Los demás, tal cual.
 * @param {string} name @param {(key: string, vars?: object) => string} t
 */
export function displayPlayerName(name, t) {
  if (name === 'Anónimo') return t('myGames.anonymous');
  const m = /^Stockfish nivel (\d+)$/.exec(name ?? '');
  return m ? t('myGames.stockfishLevel', { n: m[1] }) : name;
}

/**
 * Control de tiempo en texto → partes. Formatos: '300+3', '600', '1/86400' (Chess.com diario:
 * una jugada cada N segundos), '-' o '' (sin reloj).
 * @param {string|null|undefined} tc
 * @returns {{base:number, inc:number}|{daily:number}|null}
 */
export function parseTimeControl(tc) {
  if (tc == null) return null;
  const s = String(tc).trim();
  let m = /^(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(s);
  if (m) return { base: Number(m[1]), inc: m[2] ? Number(m[2]) : 0 };
  m = /^1\/(\d+)$/.exec(s);
  if (m) return { daily: Number(m[1]) };
  return null;
}

/**
 * Ritmo con los cortes de Lichess (scalachess `Speed`): duración estimada = base + 40 × incremento.
 * < 30 s UltraBullet · < 180 Bullet · < 480 Blitz · < 1500 Rápidas · < 21600 Clásicas · resto correspondencia.
 * @param {string|null|undefined} tc
 * @returns {Speed}
 */
export function speedFromTimeControl(tc) {
  const p = parseTimeControl(tc);
  if (!p) return 'unknown';
  if ('daily' in p) return 'correspondence';
  return speedFromSeconds(p.base + 40 * p.inc);
}

/** @param {number} seconds @returns {Speed} */
export function speedFromSeconds(seconds) {
  if (seconds < 30) return 'ultraBullet';
  if (seconds < 180) return 'bullet';
  if (seconds < 480) return 'blitz';
  if (seconds < 1500) return 'rapid';
  if (seconds < 21600) return 'classical';
  return 'correspondence';
}

/**
 * Cabeceras de un PGN (`[Tag "valor"]`) como objeto. Respeta comillas escapadas.
 * @param {string} pgn
 * @returns {Record<string,string>}
 */
export function parsePgnHeaders(pgn) {
  /** @type {Record<string,string>} */
  const headers = {};
  const re = /^\s*\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm;
  let m;
  while ((m = re.exec(pgn))) {
    if (!(m[1] in headers)) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  }
  return headers;
}

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);
/** @returns {Game['result']} */
const cleanResult = (r) => (RESULTS.has(r) ? r : '*');

const intOrNull = (v) => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** 'AAAA.MM.DD' + 'HH:MM:SS' (UTC) → ms. Fechas incompletas ('????.??.??') → null. */
export function pgnDateTimeToMs(date, time) {
  const d = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(date ?? '').trim());
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(String(time ?? '').trim());
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 12, t ? +t[2] : 0, t ? +t[3] : 0);
  return Number.isFinite(ms) ? ms : null;
}

/** ¿El PGN tiene jugadas? (algo además de cabeceras, comentarios y el resultado). */
export function pgnHasMoves(pgn) {
  const body = String(pgn)
    .replace(/^\s*\[.*\]\s*$/gm, '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;.*$/gm, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)\s*$/, '');
  return /[a-hKQRBNO][1-8a-hx=+#-]/.test(body);
}

/** ¿Las cabeceras describen ajedrez estándar desde la posición inicial? */
export function isStandardPgn(headers) {
  const variant = (headers.Variant ?? 'Standard').trim().toLowerCase();
  if (variant && variant !== 'standard' && variant !== 'chess') return false;
  if (headers.SetUp === '1' || headers.FEN) return !headers.FEN || headers.FEN.trim() === STANDARD_START_FEN;
  return true;
}

const sameName = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Color del usuario según los nombres de la partida (sin distinguir mayúsculas). */
export function colorOf(white, black, playerName) {
  if (sameName(white, playerName)) return 'w';
  if (sameName(black, playerName)) return 'b';
  return null;
}

// ---------------------------------------------------------------- Lichess

const LICHESS_DONE = new Set([
  'mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'insufficientMaterialClaim', 'unknownFinish',
]);

const lichessName = (side) =>
  side?.user?.name ?? (side?.aiLevel != null ? `Stockfish nivel ${side.aiLevel}` : side?.name ?? 'Anónimo');

/**
 * Partida del NDJSON de `GET /api/games/user/{username}` (con `pgnInJson`, `clocks`, `opening`).
 * @param {any} g
 * @param {string} username cuenta del usuario en Lichess
 * @param {number} [now]
 * @returns {Game|null}
 */
export function normalizeLichessGame(g, username, now = Date.now()) {
  if (!g || typeof g.id !== 'string') return null;
  if (g.variant !== 'standard') return null; // chess960, fromPosition, crazyhouse…
  if (g.initialFen && g.initialFen !== STANDARD_START_FEN) return null;
  if (!LICHESS_DONE.has(g.status)) return null; // abortadas, sin empezar, en juego
  const pgn = typeof g.pgn === 'string' ? g.pgn.trim() : '';
  if (!pgn || !pgnHasMoves(pgn)) return null;

  const headers = parsePgnHeaders(pgn);
  const white = lichessName(g.players?.white);
  const black = lichessName(g.players?.black);
  const timeControl = g.clock ? `${g.clock.initial}+${g.clock.increment}` : null;
  const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : g.status === 'unknownFinish' ? cleanResult(headers.Result) : '1/2-1/2';
  const playerColor = colorOf(white, black, username);
  return {
    id: `lichess:${g.id}`,
    source: 'lichess',
    externalId: g.id,
    url: `https://lichess.org/${g.id}${playerColor === 'b' ? '/black' : ''}`,
    white,
    black,
    whiteElo: intOrNull(g.players?.white?.rating),
    blackElo: intOrNull(g.players?.black?.rating),
    result,
    endTime: Number(g.lastMoveAt ?? g.createdAt) || 0,
    timeControl,
    speed: timeControl ? speedFromTimeControl(timeControl) : SPEEDS.includes(g.speed) ? g.speed : 'unknown',
    rated: typeof g.rated === 'boolean' ? g.rated : null,
    variant: 'standard',
    eco: g.opening?.eco ?? headers.ECO ?? null,
    opening: g.opening?.name ?? headers.Opening ?? null,
    termination: g.status ?? headers.Termination ?? null,
    pgn,
    playerName: playerColor === 'w' ? white : playerColor === 'b' ? black : username,
    playerColor,
    importedAt: now,
  };
}

// ---------------------------------------------------------------- Chess.com

const CHESSCOM_DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

/** Nombre legible de la apertura a partir del enlace ECOUrl (último segmento). */
export function openingFromEcoUrl(url) {
  if (typeof url !== 'string') return null;
  const m = /\/openings\/([^/?#]+)/.exec(url);
  if (!m) return null;
  let name = decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  // Quita la línea de jugadas del final ("… Variation 3...c5" → "… Variation").
  name = name.replace(/\s+\d+\.+.*$/, '').trim();
  return name || null;
}

/**
 * Partida del archivo mensual `GET /pub/player/{username}/games/{YYYY}/{MM}`.
 * @param {any} g
 * @param {string} username
 * @param {number} [now]
 * @returns {Game|null}
 */
export function normalizeChessComGame(g, username, now = Date.now()) {
  if (!g || typeof g.pgn !== 'string') return null;
  if (g.rules !== 'chess') return null; // chess960, oddschess, bughouse, kingofthehill…
  if (g.initial_setup && g.initial_setup !== STANDARD_START_FEN) return null;
  const pgn = g.pgn.trim();
  const headers = parsePgnHeaders(pgn);
  if (!isStandardPgn(headers) || !pgnHasMoves(pgn)) return null;

  const white = g.white?.username ?? headers.White ?? '?';
  const black = g.black?.username ?? headers.Black ?? '?';
  const wr = g.white?.result;
  const br = g.black?.result;
  const result =
    wr === 'win' ? '1-0' : br === 'win' ? '0-1' : CHESSCOM_DRAWS.has(wr) || CHESSCOM_DRAWS.has(br) ? '1/2-1/2' : cleanResult(headers.Result);
  // Preferimos el número de la URL (también viene en el PGN exportado, cabecera Link) para que la
  // misma partida subida como archivo PGN no se duplique (ver platformIdFromUrl).
  const externalId = platformIdFromUrl(g.url)?.externalId ?? platformIdFromUrl(headers.Link)?.externalId ?? g.uuid ?? null;
  if (!externalId) return null;
  const timeControl = g.time_control ?? headers.TimeControl ?? null;
  const endTime =
    (Number(g.end_time) ? Number(g.end_time) * 1000 : null) ??
    pgnDateTimeToMs(headers.EndDate, headers.EndTime) ??
    pgnDateTimeToMs(headers.UTCDate ?? headers.Date, headers.UTCTime) ??
    0;
  const playerColor = colorOf(white, black, username);
  return {
    id: `chesscom:${externalId}`,
    source: 'chesscom',
    externalId: String(externalId),
    url: typeof g.url === 'string' ? g.url : headers.Link ?? null,
    white,
    black,
    whiteElo: intOrNull(g.white?.rating ?? headers.WhiteElo),
    blackElo: intOrNull(g.black?.rating ?? headers.BlackElo),
    result,
    endTime,
    timeControl,
    speed: speedFromTimeControl(timeControl),
    rated: typeof g.rated === 'boolean' ? g.rated : null,
    variant: 'standard',
    eco: headers.ECO ?? null,
    opening: openingFromEcoUrl(g.eco ?? headers.ECOUrl),
    termination: headers.Termination ?? null,
    pgn,
    playerName: playerColor === 'w' ? white : playerColor === 'b' ? black : username,
    playerColor,
    importedAt: now,
  };
}

/**
 * Reconoce el enlace de una partida de Lichess o Chess.com.
 * `https://lichess.org/AbCd1234` (o `/game/AbCd1234`, con /white, /black, #ply) → { source:'lichess', externalId:'AbCd1234' };
 * `https://www.chess.com/game/live/123456` (live/daily, también /game/123456) → { source:'chesscom', externalId:'123456' }.
 * @param {unknown} url
 * @returns {{source:'lichess'|'chesscom', externalId:string}|null}
 */
export function platformIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const li = url.match(/^https?:\/\/(?:www\.)?lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#].*)?$/);
  if (li) return { source: 'lichess', externalId: li[1] };
  const cc = url.match(/^https?:\/\/(?:www\.)?chess\.com\/(?:[a-z]{2}\/)?game\/(?:live\/|daily\/)?(\d+)(?:[/?#].*)?$/);
  if (cc) return { source: 'chesscom', externalId: cc[1] };
  return null;
}

// ---------------------------------------------------------------- Archivo PGN

/**
 * Una partida de un archivo PGN (ya separada) con su hash de contenido.
 * @param {{pgn:string, headers?:Record<string,string>, hash:string}} entry
 * @param {string|null} playerName nombre del usuario en esas partidas (null si no se sabe)
 * @param {number} [now]
 * @returns {Game|null}
 */
export function normalizePgnGame(entry, playerName, now = Date.now()) {
  const pgn = String(entry?.pgn ?? '').trim();
  if (!pgn || !entry.hash) return null;
  const headers = entry.headers ?? parsePgnHeaders(pgn);
  if (!isStandardPgn(headers) || !pgnHasMoves(pgn)) return null;

  const white = headers.White?.trim() || '?';
  const black = headers.Black?.trim() || '?';
  const timeControl = headers.TimeControl && headers.TimeControl !== '-' && headers.TimeControl !== '?' ? headers.TimeControl : null;
  const site = headers.Link || headers.Site || '';
  const playerColor = playerName ? colorOf(white, black, playerName) : null;
  // Si el PGN viene de Lichess o Chess.com, usamos el mismo id que la importación por API:
  // así reimportar la misma partida por otra vía no la duplica (Stats no la cuenta dos veces).
  const platform = platformIdFromUrl(site);
  return {
    id: platform ? `${platform.source}:${platform.externalId}` : `pgn:${entry.hash}`,
    source: platform ? platform.source : 'pgn',
    externalId: platform ? platform.externalId : entry.hash,
    url: /^https?:\/\//.test(site) ? site : null,
    white,
    black,
    whiteElo: intOrNull(headers.WhiteElo),
    blackElo: intOrNull(headers.BlackElo),
    result: cleanResult(headers.Result),
    endTime:
      pgnDateTimeToMs(headers.EndDate, headers.EndTime) ??
      pgnDateTimeToMs(headers.UTCDate, headers.UTCTime) ??
      pgnDateTimeToMs(headers.Date, headers.Time ?? headers.StartTime) ??
      0,
    timeControl,
    speed: speedFromTimeControl(timeControl),
    rated: null,
    variant: 'standard',
    eco: headers.ECO && headers.ECO !== '?' ? headers.ECO : null,
    opening: headers.Opening || openingFromEcoUrl(headers.ECOUrl) || null,
    termination: headers.Termination ?? null,
    pgn,
    playerName: playerColor === 'w' ? white : playerColor === 'b' ? black : playerName ?? '',
    playerColor,
    importedAt: now,
  };
}

// ---------------------------------------------------------------- Consultas sobre partidas

/** Resultado desde el punto de vista del usuario. */
export function outcomeFor(game) {
  if (!game?.playerColor) return null;
  if (game.result === '1/2-1/2') return 'draw';
  if (game.result === '1-0') return game.playerColor === 'w' ? 'win' : 'loss';
  if (game.result === '0-1') return game.playerColor === 'b' ? 'win' : 'loss';
  return null;
}

export const opponentOf = (game) => (game.playerColor === 'b' ? game.white : game.black);
export const userEloOf = (game) => (game.playerColor === 'w' ? game.whiteElo : game.playerColor === 'b' ? game.blackElo : null);

/**
 * Rating del usuario: su último Elo en el ritmo más jugado (solo partidas con Elo y color conocido).
 * @param {Game[]} games
 * @returns {{rating:number, speed:Speed, games:number}|null}
 */
export function userRatingFromGames(games) {
  /** @type {Map<string, {count:number, last:Game}>} */
  const bySpeed = new Map();
  for (const g of games ?? []) {
    if (userEloOf(g) == null || g.speed === 'unknown') continue;
    const cur = bySpeed.get(g.speed) ?? { count: 0, last: g };
    cur.count++;
    if (g.endTime >= cur.last.endTime) cur.last = g;
    bySpeed.set(g.speed, cur);
  }
  let best = null;
  for (const [speed, v] of bySpeed) {
    if (!best || v.count > best.games || (v.count === best.games && v.last.endTime > best.endTime)) {
      best = { rating: userEloOf(v.last), speed, games: v.count, endTime: v.last.endTime };
    }
  }
  return best ? { rating: best.rating, speed: /** @type {Speed} */ (best.speed), games: best.games } : null;
}
