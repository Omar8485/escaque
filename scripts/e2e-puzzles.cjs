// Prueba en el navegador de los puzles generados en el navegador (src/puzzles/generator/).
//
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-puzzles.cjs [URL] [--games archivo.json|archivo.pgn] [--user jugador_demo] [--n 20]
//                                [--dump salida.json] [--shots carpeta]
//
// SEMBRADO SOLO DE PRUEBA: inserta en IndexedDB partidas con el tipo `Game` construidas desde un
// archivo (por defecto src/data/partidas.json si existe; si no, src/puzzles/__fixtures__/games.pgn).
// No forma parte de la app ni del bundle.
//
// Comprueba: estado vacío → sembrar → generar (midiendo tiempos y si la UI de Entrenar responde)
// → puzles válidos (solución legal y primera jugada = mejor jugada de Stockfish en Node)
// → resolver uno → recargar (persisten y no se repiten partidas) → cancelar a mitad, cerrar la
// pestaña a mitad y reanudar → borrar una partida oculta sus puzles → textos en inglés y cambio de
// idioma en vivo → 0 errores de consola.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const { Chess } = require('chess.js');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const URL_BASE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:4173/';
const LEGACY = path.join(ROOT, 'src/data/partidas.json');
const GAMES_FILE = flag('games', fs.existsSync(LEGACY) ? LEGACY : path.join(ROOT, 'src/puzzles/__fixtures__/demo-recent20.json'));
const USER = flag('user', GAMES_FILE.endsWith('games.pgn') ? 'tester' : 'jugador_demo');
const N = Number(flag('n', 20));
const DUMP = flag('dump', null);
const SHOTS = flag('shots', null);

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};
const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;

(async () => {
  const { gamesFromText } = await import(pathToFileURL(path.join(ROOT, 'src/puzzles/generator/sources.js')).href);
  const { NodeEngine } = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/node-engine.mjs')).href);
  const games = gamesFromText(fs.readFileSync(GAMES_FILE, 'utf8'), { user: USER })
    .filter((g) => g.playerColor)
    .slice(0, N);
  console.log(`Sembrado de prueba: ${games.length} partidas de ${USER} desde ${path.relative(ROOT, GAMES_FILE)}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1366, height: 860 } });
  await skipWelcome(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true }));
    window.__longTasks = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push(e.duration))).observe({ type: 'longtask', buffered: true });
    } catch {
      /* sin longtask */
    }
  });

  // ---------- Utilidades ----------
  const ready = async () => {
    await page.mouse.move(600, 300);
    await page.getByText(/^(Listo|Ready)$/).first().waitFor({ timeout: 60000 });
  };
  const go = async (tab) => {
    await page.click('[data-testid=menu-toggle]');
    await page.click(`[data-testid=nav-${tab}]`);
  };
  const idb = (op, store, arg) =>
    page.evaluate(
      async ([op, store, arg]) => {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('escaque');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        try {
          return await new Promise((res, rej) => {
            const t = db.transaction(store, op === 'getAll' || op === 'count' ? 'readonly' : 'readwrite');
            const s = t.objectStore(store);
            let out;
            if (op === 'getAll') s.getAll().onsuccess = (e) => (out = e.target.result);
            else if (op === 'count') s.count().onsuccess = (e) => (out = e.target.result);
            else if (op === 'putMany') arg.forEach((v) => s.put(v));
            else if (op === 'clear') s.clear();
            else if (op === 'delete') s.delete(arg);
            t.oncomplete = () => res(out);
            t.onerror = () => rej(t.error);
          });
        } finally {
          db.close();
        }
      },
      [op, store, arg ?? null],
    );
  const genStatus = () => page.$eval('[data-testid=puzzle-generator]', (e) => e.dataset.status).catch(() => null);
  const genDone = () => page.$eval('[data-testid=puzzle-gen-progress]', (e) => Number(e.dataset.done)).catch(() => -1);
  const waitAnalyses = async (n, timeout) => {
    const t0 = Date.now();
    while ((await idb('count', 'analysis')) < n) {
      if (Date.now() - t0 > timeout) throw new Error(`timeout esperando ${n} análisis`);
      await page.waitForTimeout(1000);
    }
  };
  // Latencia de una jugada en Entrenar medida dentro de la página: clic origen → clic destino →
  // pieza dibujada en la casilla de destino (frames con requestAnimationFrame).
  const moveLatency = (from, to) =>
    page.evaluate(
      async ([from, to]) => {
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        const t0 = performance.now();
        document.querySelector(`[data-square="${from}"]`).click();
        await frame();
        document.querySelector(`[data-square="${to}"]`).click();
        while (!document.querySelector(`[data-square="${to}"] [data-piece]`)) {
          if (performance.now() - t0 > 10000) return null;
          await frame();
        }
        return Math.round(performance.now() - t0);
      },
      [from, to],
    );
  const waitTurn = () => page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 90000 });
  const longTasks = () => page.evaluate(() => window.__longTasks.splice(0));
  const playInPractice = async (label) => {
    await go('practice');
    await page.click('[data-testid=level-1]');
    await page.click('[data-testid=color-w]');
    await page.click('[data-testid=start-game]');
    await longTasks();
    const t0 = Date.now();
    const lat = [];
    for (const [from, to] of [['e2', 'e4'], ['d2', 'd3'], ['g1', 'f3']]) {
      const occupied = await page.$(`[data-square="${to}"] [data-piece]`);
      if (occupied) continue;
      lat.push(await moveLatency(from, to));
      await waitTurn();
    }
    const lt = await longTasks();
    const span = Date.now() - t0;
    console.log(`      ${label}: jugadas ${lat.map((l) => `${l} ms`).join(', ')} · tareas largas (>50 ms) ${lt.length}, la mayor ${Math.round(Math.max(0, ...lt))} ms, en ${fmt(span)}`);
    // La partida de medición no debe abandonarse al salir: desde P1 eso
    // añadiría una partida nueva al snapshot de importaciones que se está probando.
    await page.click('[data-testid=pause]');
    return { lat, lt, span };
  };

  // ---------- 1. Estado vacío ----------
  await page.goto(URL_BASE);
  await ready();
  const cores = await page.evaluate(() => ({ cores: navigator.hardwareConcurrency, isolated: crossOriginIsolated }));
  console.log(`      navegador: ${cores.cores} núcleos, crossOriginIsolated=${cores.isolated}`);
  await go('puzzles');
  await page.waitForSelector('[data-testid=puzzle-empty]');
  check((await page.textContent('[data-testid=puzzle-empty]')).includes('Importa tus partidas en Mis partidas'), 'estado vacío: "Importa tus partidas en Mis partidas…"');
  check(await page.isDisabled('[data-testid=puzzle-gen-start]'), 'sin partidas, Generar está desactivado');

  // ---------- 2. Sembrar (solo prueba) y generar ----------
  await idb('putMany', 'games', games);
  await page.reload();
  await ready();
  await go('puzzles');
  await page.waitForSelector('[data-testid=puzzle-gen-summary]');
  check((await page.textContent('[data-testid=puzzle-gen-summary]')).includes(`0 de ${games.length}`), `resumen: ${await page.textContent('[data-testid=puzzle-gen-summary]')}`);
  await page.click('[data-testid=puzzle-gen-limit-0]');
  const tStart = Date.now();
  await page.click('[data-testid=puzzle-gen-start]');
  await page.waitForSelector('[data-testid=puzzle-gen-progress]');
  if (SHOTS) {
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}/generando.png` });
  }

  // La UI sigue respondiendo mientras genera: jugar en Entrenar.
  const during = await playInPractice('Entrenar mientras genera');
  check((await idb('count', 'analysis')) < games.length, 'la medición en Entrenar fue durante la generación');
  await go('puzzles');
  await waitAnalyses(games.length, 30 * 60000);
  const analyses = (await idb('getAll', 'analysis')).sort((a, b) => a.analyzedAt - b.analyzedAt);
  const total = analyses.at(-1).analyzedAt - tStart;
  const per = analyses.map((a, i) => ({ gameId: a.gameId, plies: a.scores.length, ms: a.analyzedAt - (i ? analyses[i - 1].analyzedAt : tStart) }));
  const msPerPly = per.reduce((s, g) => s + g.ms, 0) / per.reduce((s, g) => s + g.plies, 0);
  console.log(`      tiempo total ${fmt(total)} para ${games.length} partidas · media ${fmt(total / games.length)}/partida · ${msPerPly.toFixed(0)} ms/posición · min ${fmt(Math.min(...per.map((g) => g.ms)))} · max ${fmt(Math.max(...per.map((g) => g.ms)))}`);
  const order = analyses.map((a) => a.gameId);
  check(order.join() === games.map((g) => g.id).join(), 'procesa primero las partidas más recientes');
  await page.waitForSelector('[data-testid=puzzle-gen-result]', { timeout: 20000 });
  console.log(`      panel: ${await page.textContent('[data-testid=puzzle-gen-result]')}`);

  // ---------- 3. Puzles válidos ----------
  const puzzles = await idb('getAll', 'puzzles');
  check(puzzles.length > 0, `${puzzles.length} puzles generados`);
  const byGame = new Map(games.map((g) => [g.id, g]));
  const engine = new NodeEngine({ threads: 1, hash: 64 });
  await engine.init();
  let legal = 0;
  let bestOk = 0;
  for (const p of puzzles) {
    const c = new Chess(p.fen);
    const okLegal = p.solution.every((u) => {
      try {
        return Boolean(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }));
      } catch {
        return false;
      }
    });
    legal += okLegal ? 1 : 0;
    const res = await engine.analyze(p.fen, { depth: 16, multipv: 1 });
    const first = new Chess(p.fen);
    first.move({ from: p.solution[0].slice(0, 2), to: p.solution[0].slice(2, 4), promotion: p.solution[0][4] });
    const ok = res.bestMove === p.solution[0] || (p.mateIn && first.isCheckmate());
    bestOk += ok ? 1 : 0;
    const linked = byGame.has(p.gameId) && p.id.startsWith(`${p.gameId}-`);
    if (!ok || !okLegal || !linked) console.log(`      ${p.id}: legal=${okLegal} enlazado=${linked} solución=${p.solution[0]} motor=${res.bestMove}`);
  }
  engine.quit();
  check(legal === puzzles.length, `soluciones legales: ${legal}/${puzzles.length}`);
  check(bestOk === puzzles.length, `primera jugada = mejor jugada de Stockfish (depth 16, Node): ${bestOk}/${puzzles.length}`);
  check(puzzles.every((p) => byGame.has(p.gameId) && p.generatorVersion >= 1 && typeof p.createdAt === 'number'), 'cada puzle tiene gameId, versión y fecha de creación');
  if (DUMP) fs.writeFileSync(DUMP, JSON.stringify({ games: games.map((g) => g.id), total, per, during, puzzles }, null, 1));

  // ---------- 4. Resolver uno ----------
  await page.waitForSelector('[data-testid=puzzle-trainer]');
  const state = () => page.$eval('[data-testid=puzzle-trainer]', (e) => ({ id: e.dataset.puzzle, status: e.dataset.status }));
  const rating = async () => Number((await page.textContent('[data-testid=puzzle-rating]')).replace(/\D/g, ''));
  const byId = Object.fromEntries(puzzles.map((p) => [p.id, p]));
  let s = await state();
  let p = byId[s.id];
  check(Boolean(p), `carga un puzle de IndexedDB (${s.id})`);
  check((await page.textContent('[data-testid=puzzle-message]')).includes(p.opponent), 'el coach presenta el contexto de tu partida');
  const r0 = await rating();
  for (let i = 0; i < p.solution.length; i += 2) {
    await page.click(`[data-square="${p.solution[i].slice(0, 2)}"]`);
    await page.click(`[data-square="${p.solution[i].slice(2, 4)}"]`);
    if (i + 1 < p.solution.length) await page.waitForTimeout(900);
  }
  await page.waitForFunction(() => document.querySelector('[data-testid=puzzle-trainer]')?.dataset.status === 'solved', null, { timeout: 5000 });
  check((await rating()) > r0, `resolver a la primera sube el Elo (${r0} → ${await rating()})`);
  const link = await page.$eval('[data-testid=puzzle-info] a', (a) => a.href).catch(() => null);
  check(!link || link.startsWith(byGame.get(p.gameId).url ?? 'x'), `enlace a la partida: ${link}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/resuelto.png` });

  // Fallar el siguiente: aviso y baja el Elo.
  await page.click('[data-testid=puzzle-next]');
  await page.waitForTimeout(300);
  s = await state();
  p = byId[s.id];
  if (p) {
    const wrong = new Chess(p.fen).moves({ verbose: true }).find((m) => m.lan !== p.solution[0] && !m.san.endsWith('#') && !m.promotion);
    const r1 = await rating();
    await page.click(`[data-square="${wrong.from}"]`);
    await page.click(`[data-square="${wrong.to}"]`);
    await page.waitForTimeout(200);
    check((await page.getAttribute('[data-testid=puzzle-message]', 'data-tone')) === 'alerta' && (await rating()) < r1, `fallar (${wrong.san}) avisa y baja el Elo`);
  }

  // ---------- 5. Recargar: persisten y no se repiten partidas ----------
  const rFinal = await rating();
  const stamps = JSON.stringify((await idb('getAll', 'analysis')).map((a) => [a.gameId, a.analyzedAt]));
  await page.reload();
  await ready();
  await go('puzzles');
  await page.waitForSelector('[data-testid=puzzle-trainer]');
  check((await rating()) === rFinal, 'el Elo de puzles se recuerda al recargar');
  const solvedText = await page.textContent('[data-testid=puzzle-progress]');
  check(solvedText.includes(`/${puzzles.length}`), `los ${puzzles.length} puzles siguen tras recargar`);
  // La partida de Entrenar jugada en la sección de rendimiento se abandona al salir de la
  // pestaña y, desde P1, se guarda como partida de Escaque: es la única que puede quedar sin analizar.
  {
    const analyzed = new Set((await idb('getAll', 'analysis')).filter((a) => a.generatorVersion).map((a) => a.gameId));
    const pending = (await idb('getAll', 'games')).filter((g) => !analyzed.has(g.id));
    const onlyTraining = pending.every((g) => g.source === 'escaque');
    const upToDate = (await page.textContent('[data-testid=puzzle-gen-start]')).includes('al día') && (await page.isDisabled('[data-testid=puzzle-gen-start]'));
    check(onlyTraining && (pending.length ? !(await page.isDisabled('[data-testid=puzzle-gen-start]')) : upToDate),
      `todas las partidas importadas analizadas${pending.length ? ` (queda ${pending.length} de Entrenar, guardada por P1, y se ofrece generar)` : ': "Puzles al día"'}`);
  }
  await page.waitForTimeout(3000);
  check(JSON.stringify((await idb('getAll', 'analysis')).map((a) => [a.gameId, a.analyzedAt])) === stamps, 'no vuelve a analizar partidas ya analizadas');

  // Filtros
  const filterCount = async () => Number((await page.textContent('[data-testid=puzzle-trainer]')).match(/(\d+) puzles? con este filtro/)[1]);
  const all = await filterCount();
  await page.click('[data-testid=puzzle-type-oportunidad]');
  const opp = await filterCount();
  await page.click('[data-testid=puzzle-type-error]');
  const err = await filterCount();
  check(opp + err === all, `filtros: ${all} = ${opp} oportunidades + ${err} errores`);

  // ---------- 6. Cancelar a mitad, cerrar la pestaña a mitad y reanudar ----------
  await idb('clear', 'analysis');
  await idb('clear', 'puzzles');
  await idb('delete', 'meta', 'puzzleGenerator');
  await page.reload();
  await ready();
  await go('puzzles');
  await page.waitForSelector('[data-testid=puzzle-empty]');
  await page.click('[data-testid=puzzle-gen-limit-0]');
  await page.click('[data-testid=puzzle-gen-start]');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=puzzle-gen-progress]')?.dataset.done) >= 3, null, { timeout: 10 * 60000 });
  await page.click('[data-testid=puzzle-gen-cancel]');
  await page.waitForSelector('[data-testid=puzzle-gen-result][data-status=cancelled]', { timeout: 30000 });
  const k = await idb('count', 'analysis');
  check(k >= 3 && k < games.length, `cancelar a mitad conserva lo analizado (${k}/${games.length})`);
  const before = new Map((await idb('getAll', 'analysis')).map((a) => [a.gameId, a.analyzedAt]));
  await page.reload();
  await ready();
  await go('puzzles');
  await page.waitForSelector('[data-testid=puzzle-generator]');
  await page.waitForTimeout(1500);
  check((await genStatus()) === 'idle', 'tras cancelar, recargar no reanuda solo');
  await page.click('[data-testid=puzzle-gen-limit-0]');
  await page.click('[data-testid=puzzle-gen-start]');
  await page.waitForFunction(() => document.querySelector('[data-testid=puzzle-gen-progress]'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const firstDone = await genDone();
  check(firstDone === k, `al volver a generar sigue donde quedó (${firstDone} de ${games.length} ya hechas)`);
  await page.waitForFunction((n) => Number(document.querySelector('[data-testid=puzzle-gen-progress]')?.dataset.done) >= n, k + 2, { timeout: 10 * 60000 });
  // "Cerrar la pestaña" a mitad: recargar mientras genera.
  const k2 = await idb('count', 'analysis');
  await page.reload();
  await ready();
  await go('puzzles');
  await page.waitForFunction(() => document.querySelector('[data-testid=puzzle-generator]')?.dataset.status === 'running', null, { timeout: 15000 });
  check(true, `tras cerrar la pestaña a mitad (${k2}/${games.length}), al volver a Puzles se reanuda sola`);
  await waitAnalyses(games.length, 30 * 60000);
  const after = await idb('getAll', 'analysis');
  check([...before].every(([id, t]) => after.find((a) => a.gameId === id)?.analyzedAt === t), 'las partidas analizadas antes de cancelar no se repiten');
  await page.waitForSelector('[data-testid=puzzle-gen-result]', { timeout: 20000 });
  const puzzles2 = await idb('getAll', 'puzzles');
  console.log(`      segunda generación (con cortes): ${puzzles2.length} puzles (primera: ${puzzles.length})`);

  // ---------- 7. Borrar una partida oculta sus puzles ----------
  const victim = puzzles2[0]?.gameId;
  if (victim) {
    const n = puzzles2.filter((x) => x.gameId === victim).length;
    await idb('delete', 'games', victim);
    await page.reload();
    await ready();
    await go('puzzles');
    await page.waitForTimeout(1500);
    const left = await idb('getAll', 'puzzles');
    check(left.length === puzzles2.length - n && !left.some((x) => x.gameId === victim), `borrar la partida ${victim} elimina sus ${n} puzle(s)`);
  }

  if (SHOTS) {
    await page.click('[data-testid=theme-toggle]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/oscuro.png` });
  }

  // ---------- 7b. Inglés (i18n) ----------
  // Con el idioma en inglés los textos del puzle, del coach y del generador salen en inglés; al
  // volver a Español desde el selector, el mensaje que se ve se traduce sin recargar.
  await page.evaluate(() => localStorage.setItem('escaque:lang', 'en'));
  await page.reload();
  await ready();
  await go('puzzles');
  await page.waitForSelector('[data-testid=puzzle-message]', { timeout: 15000 });
  const msgEn = await page.textContent('[data-testid=puzzle-message]');
  check(/You play (White|Black)/.test(msgEn) && !/Juegas con/.test(msgEn), `puzle en inglés: «${msgEn}»`);
  check((await page.textContent('[data-testid=puzzle-hint]')).trim() === 'Hint', 'botón "Hint"');
  await page.click('[data-testid=puzzle-hint]');
  const hintEn = await page.textContent('[data-testid=puzzle-message]');
  check(/^Hint 1\/3: (There is mate in \d+|Look for .+)\.$/.test(hintEn.trim()), `pista en inglés: «${hintEn.trim()}»`);
  check(/puzzles? with this filter/.test(await page.textContent('[data-testid=puzzle-trainer]')), 'contador del filtro en inglés');
  check(/games? analyzed/.test(await page.textContent('[data-testid=puzzle-gen-summary]')), `generador en inglés: «${await page.textContent('[data-testid=puzzle-gen-summary]')}»`);
  await page.click('[data-testid=menu-toggle]');
  await page.selectOption('[data-testid=lang-select]', 'es');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const hintEs = (await page.textContent('[data-testid=puzzle-message]')).trim();
  check(/^Pista 1\/3: (Hay mate en \d+|Busca .+)\.$/.test(hintEs), `al cambiar a Español la pista se traduce: «${hintEs}»`);
  await page.evaluate(() => localStorage.removeItem('escaque:lang'));

  // ---------- 8. UI sin generación (referencia) ----------
  await page.reload();
  await ready();
  const idle = await playInPractice('Entrenar sin generar (referencia)');
  if (DUMP) {
    const d = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
    fs.writeFileSync(DUMP, JSON.stringify({ ...d, idle, puzzles2: puzzles2.length }, null, 1));
  }
  const maxDuring = Math.max(...during.lat);
  check(maxDuring < 500, `la UI responde mientras genera (jugada más lenta ${maxDuring} ms; sin generar ${Math.max(...idle.lat)} ms)`);

  check(errors.length === 0, `sin errores de consola${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
