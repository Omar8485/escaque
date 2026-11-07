// Prueba en el navegador de "Mis partidas" (importación) y de Análisis/Stats con partidas importadas.
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-import.cjs [URL] [--real] [--worker]
// Lichess y Chess.com se simulan con page.route (respuestas con el formato real, a partir de los
// fixtures de src/import/__fixtures__). Con --real no se simula nada: importación real pequeña
// (Lichess jugador_demo, máx. 20 partidas; Chess.com, máx. 20 de su último mes) si la red lo permite.
// Con --worker (contra `npx wrangler dev`) se simula además que el navegador bloquea Chess.com
// por CORS y se comprueba que la app pasa al reenvío del Worker (/api/proxy/chesscom/…).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

const URL_BASE = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:4173/';
const REAL = process.argv.includes('--real');
const WORKER = process.argv.includes('--worker');
const FIX = path.join(__dirname, '../src/import/__fixtures__');
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

// --- Respuestas simuladas con el formato real ---------------------------------------------
const headersOf = (pgn) => Object.fromEntries([...pgn.matchAll(/^\[(\w+) "(.*)"\]$/gm)].map((m) => [m[1], m[2]]));
const ownPgns = fs.readFileSync(path.join(FIX, 'demo-lichess.pgn'), 'utf8').split(/\n(?=\[Event )/).map((s) => s.trim());
const official = JSON.parse(fs.readFileSync(path.join(FIX, 'lichess-user.ndjson'), 'utf8').trim());
/** Partida de Lichess en NDJSON (como GET /api/games/user con pgnInJson) a partir de un PGN real. */
function lichessJson(pgn, i) {
  const h = headersOf(pgn);
  const [base, inc] = h.TimeControl.split('+').map(Number);
  const t = Date.parse(`${h.Date.replace(/\./g, '-')}T12:00:00Z`) + i * 60_000;
  const id = h.Site.split('/').pop();
  const user = (name, rating) => ({ user: { name, id: name.toLowerCase() }, rating: Number(rating) });
  return {
    id, rated: true, variant: 'standard', speed: 'blitz', perf: 'blitz', createdAt: t, lastMoveAt: t + 600_000,
    status: 'resign', source: 'pool', players: { white: user(h.White, h.WhiteElo), black: user(h.Black, h.BlackElo) },
    winner: h.Result === '1-0' ? 'white' : h.Result === '0-1' ? 'black' : undefined,
    opening: { eco: h.ECO, name: h.Opening, ply: 4 }, clock: { initial: base, increment: inc, totalTime: base + 40 * inc },
    pgn: `${pgn}\n`,
  };
}
const lichessLines = [
  ...ownPgns.map(lichessJson),
  { ...official, variant: 'chess960', id: 'x960abcd' }, // se descarta
].sort((a, b) => b.createdAt - a.createdAt);
const LICHESS_NDJSON = lichessLines.map((g) => JSON.stringify(g)).join('\n') + '\n';
const CC = {
  archives: JSON.parse(fs.readFileSync(path.join(FIX, 'chesscom-archives.json'), 'utf8')),
  '2024/12': fs.readFileSync(path.join(FIX, 'chesscom-2024-12.json'), 'utf8'),
  '2025/01': fs.readFileSync(path.join(FIX, 'chesscom-2025-01.json'), 'utf8'),
};
const cors = { 'Access-Control-Allow-Origin': '*' };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'es-ES', viewport: { width: 1366, height: 860 } });
  await skipWelcome(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const requests = [];

  if (!REAL) {
    await context.route('https://lichess.org/api/games/user/**', async (route) => {
      requests.push(route.request().url());
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/x-ndjson' }, body: LICHESS_NDJSON });
    });
    await context.route('https://api.chess.com/pub/player/**', async (route) => {
      const u = route.request().url();
      requests.push(u);
      const m = /games\/(\d{4}\/\d{2})$/.exec(u);
      const body = u.endsWith('/archives') ? JSON.stringify(CC.archives) : m && CC[m[1]];
      await route.fulfill({ status: body ? 200 : 404, headers: { ...cors, 'Content-Type': 'application/json' }, body: body || '{"code":0}' });
    });
  }

  const nav = async (id) => {
    await page.click('[data-testid=menu-toggle]');
    await page.click(`[data-testid=nav-${id}]`);
  };
  const count = async () => Number((await page.textContent('[data-testid=games-count]')).replace(/\D/g, ''));

  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);

  // 1. Estado vacío
  await nav('analysis');
  check(await page.isVisible('[data-testid=analysis-empty]'), 'Análisis sin partidas muestra el estado vacío');
  await nav('progress');
  // Progreso es una pantalla diferida (src/screens.js): se espera a que cargue antes de mirar.
  check(await page.waitForSelector('[data-testid=progress-empty]', { timeout: 20000 }).then(() => true, () => false), 'Stats sin partidas muestra el estado vacío');
  await nav('games');
  await page.waitForSelector('[data-testid=games-empty]');
  check(/Importa tus partidas para generar puzles de tus errores/.test(await page.textContent('[data-testid=games-empty]')), 'Mis partidas: estado vacío');
  const disclaimer = await page.textContent('[data-testid=chesscom-disclaimer]');
  check(disclaimer.includes('Escaque no está afiliado a Chess.com'), `aviso de no afiliación: "${disclaimer.trim()}"`);

  // 2. Lichess
  await page.fill('[data-testid=username-lichess]', 'jugador_demo');
  await page.fill('[data-testid=max-lichess]', REAL ? '20' : '200');
  await page.click('[data-testid=import-btn-lichess]');
  const sawProgress = await page.waitForSelector('[data-testid=progress-lichess]', { timeout: 3000 }).then(() => true, () => false);
  await page.waitForSelector('[data-testid=message-lichess]', { timeout: REAL ? 120000 : 15000 });
  const msgL = (await page.textContent('[data-testid=message-lichess]')).trim();
  console.log(`      Lichess: "${msgL}" · peticiones: ${requests.filter((u) => u.includes('lichess')).length}`);
  check(sawProgress, 'Lichess: se ve la barra de progreso');
  if (!REAL) {
    const u = new URL(requests.find((r) => r.includes('lichess')));
    // Sin cuenta (plan gratuito, src/premium/limits.js) cada importación trae como mucho 50 partidas.
    check(u.searchParams.get('max') === '50' && u.searchParams.get('pgnInJson') === 'true' && u.searchParams.get('clocks') === 'true', `Lichess URL: ${u.pathname}?${u.searchParams}`);
    check(/Listo: 3 partidas nuevas\. 1 descartada /.test(msgL), 'Lichess: 3 nuevas, 1 descartada (Chess960)');
  }
  const afterLichess = await count();
  check(afterLichess >= 1, `partidas tras Lichess: ${afterLichess}`);

  // 2b. Segunda importación: solo nuevas (since en la URL)
  if (!REAL) {
    await page.click('[data-testid=import-btn-lichess]');
    await page.waitForFunction(() => /No hay partidas nuevas/.test(document.querySelector('[data-testid=message-lichess]')?.textContent ?? ''), null, { timeout: 15000 });
    const u2 = new URL(requests.filter((r) => r.includes('lichess')).at(-1));
    check(Boolean(u2.searchParams.get('since')) && u2.searchParams.get('sort') === 'dateAsc', `incremental: since=${u2.searchParams.get('since')} sort=${u2.searchParams.get('sort')}`);
  }

  // 3. Chess.com
  await page.fill('[data-testid=username-chesscom]', REAL ? process.env.CHESSCOM_USER || 'hikaru' : 'MrEKO0');
  if (REAL) await page.fill('[data-testid=max-chesscom]', '20');
  await page.click('[data-testid=import-btn-chesscom]');
  await page.waitForSelector('[data-testid=message-chesscom]', { timeout: REAL ? 120000 : 15000 });
  const msgC = (await page.textContent('[data-testid=message-chesscom]')).trim();
  console.log(`      Chess.com: "${msgC}" · peticiones: ${requests.filter((u) => u.includes('chess.com')).join(' , ')}`);
  if (!REAL) check(/Listo: 7 partidas nuevas\. 1 descartada /.test(msgC), 'Chess.com: 7 nuevas, 1 descartada (oddschess), meses en serie');
  const afterCc = await count();
  console.log(`      total tras Chess.com: ${afterCc}`);

  // 4. PGN de varias partidas
  // Las 3 partidas de jugador_demo llevan su enlace de Lichess y ya se importaron por la API: no deben
  // duplicarse. La 4.ª es de un torneo local (sin enlace a ninguna plataforma): es la única nueva.
  const localGame = official.pgn.replace(/\[Site "[^"]*"\]/, '[Site "Torneo local"]');
  const multi = `${ownPgns.join('\n\n')}\n\n${localGame}`;
  await page.setInputFiles('[data-testid=pgn-input]', [
    { name: 'mis-partidas.pgn', mimeType: 'application/x-chess-pgn', buffer: Buffer.from(multi.replace(/\n/g, '\r\n')) },
  ]);
  await page.waitForSelector('[data-testid=pgn-confirm]');
  const selected = await page.$eval('[data-testid=pgn-player]', (s) => s.value);
  console.log(`      PGN: ${(await page.textContent('[data-testid=pgn-confirm] p')).trim()} · sugerido: ${selected}`);
  check(selected === 'jugador_demo', 'PGN: detecta al usuario (jugador_demo)');
  await page.click('[data-testid=pgn-save]');
  await page.waitForSelector('[data-testid=message-pgn]');
  const msgP = (await page.textContent('[data-testid=message-pgn]')).trim();
  check(/Listo: 1 partida nueva/.test(msgP), `PGN (3 ya importadas por la API, 1 nueva): "${msgP}"`);
  const total = await count();
  check(total === afterCc + 1, `total sin duplicados: ${total}`);

  // 5. Filtros
  await page.selectOption('[data-testid=filter-source]', 'pgn');
  const fPgn = (await page.textContent('[data-testid=games-filtered]')).trim();
  check(fPgn === 'Mostrando 1 de 1', `filtro fuente PGN: ${fPgn}`);
  await page.selectOption('[data-testid=filter-source]', 'all');
  await page.selectOption('[data-testid=filter-outcome]', 'win');
  console.log(`      filtro victorias: ${(await page.textContent('[data-testid=games-filtered]')).trim()}`);
  await page.selectOption('[data-testid=filter-outcome]', 'all');

  // 6. Abrir una partida en Análisis
  const firstId = await page.getAttribute('[data-testid=game-row] >> nth=0', 'data-game-id');
  await page.click('[data-testid=game-row] >> nth=0');
  await page.waitForSelector('[data-testid=analysis-games]');
  const analysisCount = await page.locator('[data-testid=analysis-game]').count();
  check(analysisCount > 0, `Análisis lista ${analysisCount} partidas (página 1)`);
  const status = await page.textContent('[data-testid=game-status]').catch(() => null);
  check(Boolean(status), `partida ${firstId} abierta: estado "${status}"`);
  const analysisBars = await page.locator('[data-testid^=player-bar-]').allTextContents();
  console.log(`      barras en Análisis: ${JSON.stringify(analysisBars)}`);

  // 7. Persistencia tras recargar
  await page.reload();
  await page.mouse.move(600, 300);
  await nav('games');
  await page.waitForSelector('[data-testid=games-list]');
  const afterReload = await count();
  check(afterReload === total, `tras recargar siguen ${afterReload} partidas`);
  const lichessUser = await page.inputValue('[data-testid=username-lichess]');
  check(lichessUser === 'jugador_demo', `cuenta de Lichess vinculada recordada: ${lichessUser}`);
  await nav('progress');
  await page.waitForSelector('[data-testid=progress-to-puzzles]');
  const statsText = await page.textContent('main');
  const m = /(\d+)Victorias(\d+)Derrotas(\d+)Tablas/.exec(statsText.replace(/\s+/g, ''));
  console.log(`      Stats: victorias ${m?.[1]} · derrotas ${m?.[2]} · tablas ${m?.[3]}`);
  check(Boolean(m), 'Stats usa las partidas importadas');
  await nav('practice');
  const bars = await page.locator('[data-testid^=player-bar-]').allTextContents().catch(() => []);
  console.log(`      barras en Entrenar: ${JSON.stringify(bars)}`);

  // 8. Borrar todas
  await nav('games');
  await page.click('[data-testid=clear-games]');
  await page.click('[data-testid=clear-confirm]');
  await page.waitForSelector('[data-testid=games-empty]');
  check((await count()) === 0, 'borrar todas deja 0 partidas');
  await nav('analysis');
  check(await page.isVisible('[data-testid=analysis-empty]'), 'Análisis vuelve al estado vacío');

  // 8b. Inglés (i18n): textos, aviso de no afiliación y mensaje de importación; al volver a
  // Español desde el selector, el mensaje que se ve se traduce sin recargar.
  if (!REAL) {
    await page.evaluate(() => localStorage.setItem('escaque:lang', 'en'));
    await page.reload();
    await page.mouse.move(600, 300);
    await nav('games');
    await page.waitForSelector('[data-testid=games-empty]');
    check(/Import your games/.test(await page.textContent('[data-testid=games-empty]')), 'Mis partidas en inglés: estado vacío');
    const discEn = (await page.textContent('[data-testid=chesscom-disclaimer]')).trim();
    check(discEn.includes('Escaque is not affiliated with Chess.com'), `aviso de no afiliación en inglés: "${discEn}"`);
    await page.fill('[data-testid=username-lichess]', 'jugador_demo');
    await page.click('[data-testid=import-btn-lichess]');
    await page.waitForSelector('[data-testid=message-lichess]', { timeout: 15000 });
    const msgEn = (await page.textContent('[data-testid=message-lichess]')).trim();
    check(/^(Done: \d+ new games?|No new games)\./.test(msgEn), `mensaje de importación en inglés: "${msgEn}"`);
    if (/^Done/.test(msgEn)) check(/^Showing \d+ of \d+$/.test((await page.textContent('[data-testid=games-filtered]')).trim()), 'contador de la lista en inglés');
    await page.click('[data-testid=menu-toggle]');
    await page.selectOption('[data-testid=lang-select]', 'es');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const msgEs = (await page.textContent('[data-testid=message-lichess]')).trim();
    check(/^(Listo: \d+ partidas? nuevas?|No hay partidas nuevas)\./.test(msgEs), `al cambiar a Español el mensaje se traduce: "${msgEs}"`);
    if (/^Done/.test(msgEn)) {
      // De vuelta a English: Stats y Análisis en inglés.
      await page.click('[data-testid=menu-toggle]');
      await page.selectOption('[data-testid=lang-select]', 'en');
      await page.click(`[data-testid=nav-progress]`);
      await page.waitForSelector('[data-testid=progress-to-puzzles]');
      const statsEn = (await page.textContent('main')).replace(/\s+/g, '');
      check(/\d+Wins\d+Losses\d+Draws/.test(statsEn), 'Stats en inglés (Wins/Losses/Draws)');
      await nav('analysis');
      await page.waitForSelector('[data-testid=analysis-games]');
      check(/Page 1 of \d+/.test(await page.textContent('main')), 'Análisis en inglés (paginación)');
      await nav('games');
      await page.waitForSelector('[data-testid=my-games]');
    }
    await page.evaluate(() => localStorage.removeItem('escaque:lang'));
    if (await page.$('[data-testid=clear-games]')) {
      await page.click('[data-testid=clear-games]');
      await page.click('[data-testid=clear-confirm]');
      await page.waitForSelector('[data-testid=games-empty]');
    }
  }

  if (WORKER && !REAL) {
    // El navegador "bloquea" la respuesta directa: la app debe reintentar por el Worker.
    await context.unroute('https://api.chess.com/pub/player/**');
    await context.route('https://api.chess.com/pub/player/**', (route) => route.abort('failed'));
    const proxied = [];
    page.on('response', (r) => r.url().includes('/api/proxy/chesscom/') && proxied.push(`${r.status()} ${new URL(r.url()).pathname}`));
    const before = errors.length;
    await nav('games');
    await page.fill('[data-testid=username-chesscom]', 'MrEKO0');
    await page.click('[data-testid=import-btn-chesscom]');
    await page.waitForSelector('[data-testid=message-chesscom]', { timeout: 30000 });
    const msg = (await page.textContent('[data-testid=message-chesscom]')).trim();
    console.log(`      reenvío: ${proxied.join(' , ')} · mensaje: "${msg}"`);
    check(proxied.length > 0, 'Chess.com bloqueado por CORS → la app usa el reenvío del Worker');
    // Errores esperados en este paso (petición bloqueada y 502 del reenvío sin red): no cuentan.
    errors.splice(before);
  }

  check(errors.length === 0, `errores de consola: ${errors.length}${errors.length ? ` → ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} fallos` : '\nTodo bien');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
