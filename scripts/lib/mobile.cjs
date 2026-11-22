// Utilidades de scripts/e2e-mobile.cjs (ronda M, diseño móvil interno): abrir la app en un teléfono
// emulado, navegar entre pantallas (con barra inferior o, antes de M2, con el menú ☰), medir si
// algo se ve entero sin desplazarse, sembrar datos de prueba y provocar que el coach se detenga.
const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');
const { skipWelcome } = require('./welcome.cjs');

const SAMPLE_PGN = fs.readFileSync(path.join(__dirname, '../../src/import/__fixtures__/demo-lichess.pgn'));
const sel = (id) => `[data-testid=${id}]`;
// Primera línea del error (E2E_MOBILE_DEBUG=1 para verlo entero, con el registro de Playwright).
const firstLine = (e) => (process.env.E2E_MOBILE_DEBUG ? String(e?.message ?? e) : String(e?.message ?? e).split('\n')[0].slice(0, 220));

// ---------------------------------------------------------------------------------------------
// Abrir la app

/** Páginas táctiles: en ellas se toca (tap) en vez de hacer clic con el ratón. */
const touchPages = new WeakSet();

/** Toca (táctil) o hace clic (escritorio) según la página. */
const press = (locator, opts) => (touchPages.has(locator.page()) ? locator.tap(opts) : locator.click(opts));

// Si la señal «Listo» del motor desaparece (M2 la oculta en móvil), no se esperan 45 s cada vez.
let readySignal = true;
async function waitReady(page) {
  if (!readySignal) return page.waitForTimeout(4000);
  const ok = await page
    .waitForFunction(
      () =>
        document.querySelector('main')?.dataset.enginesReady === 'true' ||
        [...document.querySelectorAll('span')].some((s) => /^(Listo|Ready)$/.test(s.textContent.trim())),
      null,
      { timeout: 45000 },
    )
    .then(() => true, () => false);
  if (!ok) {
    readySignal = false;
    console.log('AVISO no se encontró el texto «Listo/Ready» del motor: se espera un tiempo fijo en adelante');
  }
}

/**
 * Abre la app en un contexto nuevo.
 * @param {import('playwright').Browser} browser
 * @param {{w:number,h:number,lang:string,theme:string}} v  variante (tamaño, idioma, tema)
 * @param {{url:string, desktop?:boolean, welcome?:boolean, alfred?:string|null, route?:(c:any)=>Promise<void>}} o
 */
async function openApp(browser, v, { url, desktop = false, welcome = false, alfred = 'never', route = null }) {
  const context = await browser.newContext({
    locale: v.lang === 'en' ? 'en-US' : 'es-ES',
    viewport: { width: v.w, height: v.h },
    isMobile: !desktop,
    hasTouch: !desktop,
    // Sin service worker: cada contexto carga la versión servida y page.route ve todo /api.
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(5000);
  if (!welcome) await skipWelcome(context);
  await context.addInitScript(({ lang, theme, alfred }) => {
    try {
      localStorage.setItem('escaque:lang', lang);
      localStorage.setItem('coach-chess:theme', theme);
      if (alfred) localStorage.setItem('alfred:prefs', JSON.stringify({ mode: alfred, active: true }));
    } catch {
      /* sin almacenamiento */
    }
  }, { lang: v.lang, theme: v.theme, alfred });
  if (route) await route(context);
  const page = await context.newPage();
  if (!desktop) touchPages.add(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(firstLine(e)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(url);
  // En escritorio el puntero empieza en (0,0), sobre el borde que abre el menú.
  if (desktop) await page.mouse.move(600, 300);
  if (!welcome) await waitReady(page);
  return { context, page, errors };
}

// ---------------------------------------------------------------------------------------------
// Mediciones (en la página)

/**
 * ¿Se ve entero en pantalla, tal como está (sin desplazar nada)? Dentro de 0..innerWidth/innerHeight,
 * sin la barra inferior encima y sin otra cosa tapando su centro.
 * Se ejecuta en la página: no puede usar nada de fuera.
 */
function fitInPage(el) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const f = Math.round;
  const desc = (n) => {
    const t = n.closest('[data-testid]');
    return `<${n.tagName.toLowerCase()}${t ? ` en ${t.dataset.testid}` : ''}>`;
  };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden') return { ok: false, why: 'oculto o sin tamaño' };
  const why = [];
  if (r.top < -1 || r.left < -1 || r.bottom > H + 1 || r.right > W + 1) {
    why.push(`fuera de pantalla: (${f(r.left)},${f(r.top)})→(${f(r.right)},${f(r.bottom)}) en ${W}×${H}`);
  }
  // Barra inferior: solo cuenta si está por encima del elemento en la zona en que se solapan.
  const nav = document.querySelector('[data-testid=bottom-nav]');
  if (nav && !nav.contains(el)) {
    const n = nav.getBoundingClientRect();
    if (n.height > 0 && r.bottom > n.top + 1 && r.top < n.bottom) {
      const y = (Math.max(r.top, n.top) + Math.min(r.bottom, n.bottom, H - 1)) / 2;
      const x = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
      const hit = document.elementFromPoint(x, y);
      if (hit && nav.contains(hit)) why.push(`tapado por la barra inferior (bottom ${f(r.bottom)} > ${f(n.top)})`);
    }
  }
  // Prueba de impacto en el centro de la parte que cae en pantalla.
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, H);
  if (bottom > top) {
    const x = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
    const y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    if (hit && !el.contains(hit) && !hit.contains(el)) why.push(`tapado en el centro por ${desc(hit)}`);
  }
  return { ok: why.length === 0, why: why.join('; '), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } };
}

/** fit() sobre un locator: { ok, why, rect }. No desplaza nada (no usa acciones de Playwright). */
async function fit(locator) {
  if (!(await locator.count())) return { ok: false, why: 'no existe' };
  const vis = locator.filter({ visible: true });
  if (!(await vis.count())) return { ok: false, why: 'existe pero no está visible' };
  return vis.first().evaluate(fitInPage);
}

/** Rectángulo del primer elemento visible, o null. */
async function rectOf(locator) {
  const vis = locator.filter({ visible: true });
  if (!(await vis.count())) return null;
  return vis.first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });
}

/** Sin desplazamiento horizontal: ni el documento ni <main> (ni el contenedor dado) más anchos que la ventana. */
function noHorizontalScroll(page, scopeSelector = null) {
  return page.evaluate((scopeSelector) => {
    const W = window.innerWidth;
    const why = [];
    const d = document.scrollingElement;
    if (d.scrollWidth > W + 1) why.push(`documento ${d.scrollWidth}px > ${W}px`);
    const m = document.querySelector('main');
    if (m && m.scrollWidth > m.clientWidth + 1) why.push(`<main> ${m.scrollWidth}px > ${m.clientWidth}px`);
    const s = scopeSelector && document.querySelector(scopeSelector);
    if (s && s.scrollWidth > s.clientWidth + 1) why.push(`${scopeSelector} ${s.scrollWidth}px > ${s.clientWidth}px`);
    if (why.length) {
      // Los culpables: los elementos más profundos que se salen por la derecha.
      const out = [...document.querySelectorAll('main *, body > div *')].filter((e) => e.getBoundingClientRect().right > W + 1 && e.getBoundingClientRect().width > 0);
      const leaves = out.filter((e) => !out.some((o) => o !== e && e.contains(o))).slice(0, 2);
      const desc = (n) => {
        const t = n.closest('[data-testid]');
        return `<${n.tagName.toLowerCase()}${t ? ` en ${t.dataset.testid}` : ''}> hasta x=${Math.round(n.getBoundingClientRect().right)}`;
      };
      if (leaves.length) why.push(`se sale: ${leaves.map(desc).join(', ')}`);
    }
    return { ok: why.length === 0, why: why.join('; ') };
  }, scopeSelector);
}

/**
 * Objetivos táctiles menores que `min` px dentro de `scope` (botones y roles pulsables visibles; con
 * `inViewport`, solo los que caen en pantalla). Se excluyen las casillas del tablero.
 */
function smallTargets(page, scope, { min = 44, inViewport = true, exclude = null } = {}) {
  return page.evaluate(({ scope, min, inViewport, exclude }) => {
    const roots = scope ? [...document.querySelectorAll(scope)] : [document.body];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const seen = new Set();
    const small = [];
    for (const root of roots) {
      for (const b of root.querySelectorAll('button, [role=button], [role=radio], [role=tab], [role=switch]')) {
        if (seen.has(b) || b.closest('[data-testid=board-frame]') || b.closest('[data-square]') || (exclude && b.closest(exclude))) continue;
        seen.add(b);
        const r = b.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || getComputedStyle(b).visibility === 'hidden') continue;
        if (inViewport && (r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W)) continue;
        const name = (b.dataset.testid || b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        if (r.width < min - 0.5 || r.height < min - 0.5) small.push(`«${name}» ${Math.round(r.width)}×${Math.round(r.height)}`);
        // Icono aplastado: el relleno global de <button> (index.css) se come el ancho si falta p-0.
        for (const svg of b.querySelectorAll('svg')) {
          const ir = svg.getBoundingClientRect();
          if (ir.height >= 8 && ir.width < Math.min(8, ir.height * 0.5)) {
            small.push(`«${name}» icono aplastado ${Math.round(ir.width)}×${Math.round(ir.height)}`);
            break;
          }
        }
      }
    }
    return small;
  }, { scope, min, inViewport, exclude });
}

/** Vuelve al estado «sin desplazar»: documento y <main> arriba del todo. */
async function resetScroll(page) {
  await page.evaluate(() => {
    document.scrollingElement.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo(0, 0);
  });
  await page.waitForTimeout(100);
}

/** Valores de las variables CSS del contrato (§3): texto en :root y alto resuelto en px. */
function cssVars(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const px = (name) => {
      const probe = document.createElement('div');
      probe.style.cssText = `position:absolute;visibility:hidden;height:var(${name}, 0px)`;
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    };
    return {
      bottomNav: root.getPropertyValue('--bottom-nav-h').trim(),
      header: root.getPropertyValue('--app-header-h').trim(),
      bottomNavPx: px('--bottom-nav-h'),
      headerPx: px('--app-header-h'),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Navegación

/** Elemento característico de cada pantalla. */
const SCREEN_MARK = {
  play: `${sel('play-setup')}, ${sel('level-selector')}, ${sel('match-panel')}`,
  puzzles: `${sel('puzzle-trainer')}, ${sel('puzzle-empty')}`,
  progress: sel('progress-screen'),
  games: sel('my-games'),
  analysis: `${sel('board-frame')}`,
  more: `${sel('side-menu')}[data-open=true]`,
};
/** Ids de NAV_ITEMS (src/App.jsx) para el menú ☰ de antes de M2. */
const MENU_ID = { play: 'practice', puzzles: 'puzzles', progress: 'progress', games: 'games' };

const hasBottomNav = (page) => page.locator(sel('bottom-nav')).first().isVisible().catch(() => false);

async function waitMark(page, screen, timeout = 10000) {
  await page.locator(SCREEN_MARK[screen]).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

/**
 * Va a una pantalla: play, puzzles, progress, games, analysis (abre la primera partida de Partidas;
 * hace falta haber sembrado partidas) o more (abre el menú). Con barra inferior (M2) usa
 * bottom-nav-<id>; sin ella, ☰ + nav-<id>.
 */
async function goTo(page, screen) {
  if (screen === 'analysis') {
    await goTo(page, 'games');
    await press(page.locator(sel('game-row')).first());
    await page.locator(sel('board-frame')).filter({ visible: true }).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    return;
  }
  if (await hasBottomNav(page)) {
    await press(page.locator(sel(`bottom-nav-${screen}`)));
  } else if (screen === 'more') {
    await press(page.locator(sel('menu-toggle')));
  } else {
    await press(page.locator(sel('menu-toggle')));
    await page.locator(`${sel('side-menu')}[data-open=true]`).waitFor();
    await press(page.locator(sel(`nav-${MENU_ID[screen]}`)));
  }
  await waitMark(page, screen);
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------------------------
// Datos de prueba (solo para las pruebas: no forman parte de la app)

/** Importa el PGN de prueba desde Partidas (como e2e-layout / e2e-tabs). Deja la app en Partidas. */
async function seedGames(page) {
  await goTo(page, 'games');
  await page.setInputFiles(sel('pgn-input'), [{ name: 'muestra.pgn', mimeType: 'application/x-chess-pgn', buffer: SAMPLE_PGN }]);
  await press(page.locator(sel('pgn-save')));
  await page.locator(sel('games-list')).waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
}

/** Abre la base de la app (espera a que la app la haya creado) y ejecuta `fn(db)` en la página. */
async function idbReady(page) {
  await page.waitForFunction(async () => (await indexedDB.databases()).some((d) => d.name === 'escaque' && d.version > 1), null, { timeout: 10000 });
}

/** Un puzle (mate en 1 con blancas, como e2e-review) y su partida. */
async function seedPuzzle(page) {
  await idbReady(page);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('escaque');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(['games', 'puzzles'], 'readwrite');
    tx.objectStore('games').put({ id: 'test:mobile', white: 'Tester', black: 'Rival', result: '1-0', endTime: Date.now(), variant: 'standard', playerColor: 'w', source: 'pgn' });
    tx.objectStore('puzzles').put({
      id: 'mobile-a', gameId: 'test:mobile', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'],
      color: 'w', type: 'oportunidad', motif: 'mate', phase: 'apertura', moveNumber: 4, played: 'Bc4', opponent: 'Rival', date: '2026.01.01', rating: 1200,
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

/** Partidas con jugadas clasificadas para que Progreso dibuje tarjetas y gráficos (como e2e-progress). */
async function seedProgress(page) {
  await idbReady(page);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('escaque');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(['games', 'moves'], 'readwrite');
    const game = {
      id: 'escaque:mobile-test', source: 'escaque', externalId: 'mobile-test', white: 'Tester', black: 'Rival', whiteElo: null, blackElo: 1500, result: '0-1',
      endTime: Date.now(), importedAt: Date.now(), playerName: 'Tester', playerColor: 'w', timeControl: '600+0', speed: 'rapid', rated: false, variant: 'standard',
      opening: 'Test opening', eco: 'C20', pgn: '[Result "0-1"]\n\n1. e4 {[%clk 0:00:30]} e5 2. Nf3 Nc6 0-1',
    };
    tx.objectStore('games').put(game);
    tx.objectStore('games').put({ ...game, id: 'lichess:mobile-test', source: 'lichess', speed: 'blitz', whiteElo: 1400, opening: 'Second test opening', eco: 'D00', result: '1-0', endTime: Date.now() - 10 * 86400000 });
    tx.objectStore('moves').put({ gameId: game.id, moves: [
      { ply: 1, color: 'w', san: 'e4', uci: 'e2e4', label: 'Blunder', phase: 'apertura', motif: 'ataque_doble', evalBefore: { type: 'cp', value: 600 }, evalAfter: { type: 'cp', value: -300 }, winBefore: 90, winAfter: 25, loss: 65 },
      { ply: 3, color: 'w', san: 'Nf3', uci: 'g1f3', label: 'Mistake', phase: 'apertura', motif: 'captura', evalBefore: { type: 'cp', value: 20 }, evalAfter: { type: 'cp', value: -200 }, winBefore: 52, winAfter: 32, loss: 20 },
    ] });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

/** Servidor de cuentas simulado: sesión iniciada (plan gratuito) y los 3 precios de Polar (como el modo mock del Worker). */
async function mockAccountApi(context) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/me') {
      return json(route, {
        ok: true, accounts: true, providers: ['google'], billing: true,
        user: { id: 'e2e-mobile', email: 'tester@example.com', name: 'Tester', provider: 'google' },
        plan: { premium: false, plan: 'free' }, consent: { version: '1.0', accepted: '1.0', required: false }, csrf: 'e2e', checkedAt: Date.now(),
      });
    }
    if (p === '/api/billing/products') {
      return json(route, {
        ok: true, configured: true, sandbox: false, founder: { limit: 100, remaining: 42, soldOut: false },
        products: [
          { plan: 'monthly', id: 'mock-monthly', name: 'Mensual', recurring: true, interval: 'month', prices: [{ amountType: 'fixed', amount: 299, minimum: null, currency: 'usd', interval: 'month' }] },
          { plan: 'yearly', id: 'mock-yearly', name: 'Anual', recurring: true, interval: 'year', prices: [{ amountType: 'fixed', amount: 1999, minimum: null, currency: 'usd', interval: 'year' }] },
          { plan: 'founder', id: 'mock-founder', name: 'Fundador', recurring: false, interval: null, prices: [{ amountType: 'fixed', amount: 4999, minimum: null, currency: 'usd', interval: null }] },
        ],
      });
    }
    return json(route, { ok: false, error: { kind: 'not_found' } }, 404);
  });
}

// ---------------------------------------------------------------------------------------------
// Partida en Jugar

/** Empieza una partida: `play-start` (M1) o, si no existe, `start-game` (diseño anterior). */
async function startGame(page) {
  const color = page.locator(sel('color-w')).filter({ visible: true });
  if (await color.count()) await press(color.first()).catch(() => {});
  const playStart = page.locator(sel('play-start')).filter({ visible: true });
  const usedFallback = !(await playStart.count());
  await press(usedFallback ? page.locator(sel('start-game')) : playStart.first());
  await page.locator(sel('play-setup')).waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
  return { usedFallback };
}

/** Elige el rival de nivel 1 (rápido y aleatorio), en el selector clásico o en la hoja de rival (M1). */
async function pickLevel1(page) {
  const direct = page.locator(sel('level-1')).filter({ visible: true });
  if (await direct.count()) return press(direct.first());
  const rival = page.locator(sel('play-setup-rival')).filter({ visible: true });
  if (!(await rival.count())) return undefined;
  await press(rival.first());
  const inSheet = page.locator(`${sel('rival-sheet')} ${sel('level-1')}`);
  if (await inSheet.first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) await press(inSheet.first());
  if (await page.locator(sel('rival-sheet')).isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return undefined;
}

/** Posición del tablero leída del DOM (como e2e-alfred), con blancas al turno. */
const readFen = (page) =>
  page.evaluate(() => {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (const f of 'abcdefgh') {
        const el = document.querySelector(`[data-square="${f}${r}"] [data-piece]`);
        if (!el) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        const k = el.getAttribute('data-piece');
        row += k[0] === 'w' ? k[1].toUpperCase() : k[1];
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} w - - 0 1`;
  });

/** Juega una jugada tocando la casilla de origen y la de destino. */
async function playMove(page, from, to) {
  await press(page.locator(`[data-square="${from}"]`));
  await press(page.locator(`[data-square="${to}"]`));
  await page.waitForTimeout(300);
}

const pieceAt = (page, sq) => page.$eval(`[data-square="${sq}"]`, (e) => e.querySelector('[data-piece]')?.dataset.piece ?? null).catch(() => null);

/** Espera a que sea tu turno ('turn'), a que el coach te detenga ('stop') o al final ('over'). */
function waitTurnOrStop(page, timeout = 45000) {
  return page
    .waitForFunction(() => {
      const shown = (s) => {
        const e = document.querySelector(s);
        return e && e.getBoundingClientRect().height > 0;
      };
      if (shown('[data-testid=coach-takeback]')) return 'stop';
      if (shown('[data-testid=game-result]')) return 'over';
      const bar = document.querySelector('[data-testid=player-bar-w]');
      if (bar?.dataset.turn === 'true' && !shown('[data-testid=coach-continue]')) return 'turn';
      return false;
    }, null, { timeout })
    .then((h) => h.jsonValue());
}

/**
 * Provoca que el coach se detenga (técnica de e2e-alfred): con blancas, lleva una pieza a una casilla
 * atacada por un peón negro; si no hay, desarrolla un peón y vuelve a intentarlo.
 * @returns {Promise<boolean>} true si el coach se detuvo
 */
async function provokeCoachStop(page, maxMoves = 8) {
  for (let i = 0; i < maxMoves; i++) {
    const st = await waitTurnOrStop(page);
    if (st === 'stop') return true;
    if (st === 'over') return false;
    const chess = new Chess(await readFen(page));
    const legal = chess.moves({ verbose: true });
    const blunder = legal.find((m) => ['q', 'r', 'n', 'b'].includes(m.piece) && !m.captured && (() => {
      const c = new Chess(chess.fen());
      c.move(m);
      return c.attackers(m.to, 'b').some((sq) => c.get(sq).type === 'p');
    })());
    const mv = blunder ?? legal.find((m) => m.piece === 'p' && !m.captured && !m.promotion) ?? legal[0];
    await playMove(page, mv.from, mv.to);
  }
  return (await waitTurnOrStop(page).catch(() => null)) === 'stop';
}

module.exports = {
  sel, firstLine, press, openApp, fit, rectOf, noHorizontalScroll, smallTargets, resetScroll, cssVars,
  SCREEN_MARK, hasBottomNav, goTo, waitMark, seedGames, seedPuzzle, seedProgress, mockAccountApi,
  startGame, pickLevel1, playMove, pieceAt, provokeCoachStop,
};
