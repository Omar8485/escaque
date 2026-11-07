// Prueba de punta a punta de Alfred en el navegador (solo plantillas: sin clave de IA).
// Uso: npm run build && npx vite preview --port 4173 (o npm run cf:dev) y en otra terminal
//   node scripts/e2e-alfred.cjs [URL]      (por defecto http://localhost:4173/)
// La IA opcional (clave del usuario) se prueba en scripts/e2e-byok.cjs.
// Juega con blancas contra el nivel 1: pide las 3 pistas, comete un error grave a propósito,
// comprueba que el rival espera, pide "¿Por qué?" (línea de Stockfish y mini tablero), Retrocede, juega la mejor (felicitación) y
// prueba "Seguir". Deja capturas en ALFRED_E2E_OUT (por defecto el directorio temporal).
// Requiere Playwright con Chromium instalado (no es dependencia del proyecto).
const os = require('node:os');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const { Chess } = require('chess.js');
const URL_BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.env.ALFRED_E2E_OUT || os.tmpdir();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1500, height: 950 } });
  await skipWelcome(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const external = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(new URL(URL_BASE).origin) && !r.url().startsWith('data:')) external.push(r.url());
  });

  await page.goto(URL_BASE);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
  console.log('crossOriginIsolated =', await page.evaluate(() => crossOriginIsolated));
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });

  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  await page.waitForSelector('[data-testid=coach-panel]');

  const readFen = async () => {
    const placement = await page.evaluate(() => {
      const rows = [];
      for (let r = 8; r >= 1; r--) {
        let row = '';
        let empty = 0;
        for (const f of 'abcdefgh') {
          const el = document.querySelector(`[data-square="${f}${r}"] [data-piece]`);
          if (!el) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          const k = el.getAttribute('data-piece');
          row += k[0] === 'w' ? k[1].toUpperCase() : k[1];
        }
        if (empty) row += empty;
        rows.push(row);
      }
      return rows.join('/');
    });
    return `${placement} w - - 0 1`;
  };
  const move = async (uci) => {
    await page.click(`[data-square="${uci.slice(0, 2)}"]`);
    await page.click(`[data-square="${uci.slice(2, 4)}"]`);
  };
  const waitTurn = () => page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });
  const state = () => page.$eval('[data-testid=match-state]', (e) => e.textContent);

  // 1. e4: Alfred comenta y el rival responde.
  await move('e2e4');
  await page.waitForSelector('[data-testid=coach-feedback]', { timeout: 30000 });
  console.log('1.e4 →', await page.$eval('[data-testid=coach-feedback]', (e) => e.dataset.label), '|', await page.$eval('[data-testid=coach-text]', (e) => e.textContent));
  await waitTurn();

  // Pista: nivel 1, 2 y 3 (flecha).
  for (let i = 0; i < 3; i++) {
    await page.click('[data-testid=coach-hint-btn]');
    await page.waitForFunction((lvl) => document.querySelector('[data-testid=coach-hint]')?.dataset.level === String(lvl) && !document.querySelector('[data-testid=coach-hint] .animate-spin'), i + 1, { timeout: 20000 });
    console.log(`pista ${i + 1}:`, await page.$eval('[data-testid=coach-hint]', (e) => e.textContent));
  }
  await page.screenshot({ path: `${OUT}/alfred-pista.png` });

  // 2. Busca un error grave: la dama o una pieza a una casilla atacada por un peón rival.
  let blunder = null;
  for (let attempt = 0; attempt < 6 && !blunder; attempt++) {
    const chess = new Chess(await readFen());
    const legal = chess.moves({ verbose: true });
    blunder = legal.find((m) => ['q', 'r', 'n', 'b'].includes(m.piece) && !m.captured && (() => {
      const c = new Chess(chess.fen());
      c.move(m);
      return c.attackers(m.to, 'b').some((sq) => c.get(sq).type === 'p') ;
    })());
    if (!blunder) {
      const dev = legal.find((m) => m.piece === 'p' && !m.captured) ?? legal[0];
      await move(dev.lan);
      await page.waitForFunction(() => ['Tu turno'].includes(document.querySelector('[data-testid=match-state]')?.textContent) || document.querySelector('[data-testid=coach-takeback]'), null, { timeout: 60000 });
      if (await page.$('[data-testid=coach-continue]')) await page.click('[data-testid=coach-continue]');
      await waitTurn();
    }
  }
  console.log('error a propósito:', blunder?.san);
  const fenBeforeBlunder = await readFen();
  await move(blunder.lan);
  await page.waitForSelector('[data-testid=coach-takeback]', { timeout: 30000 });
  console.log('estado:', await state(), '| etiqueta:', await page.$eval('[data-testid=coach-feedback]', (e) => e.dataset.label));
  await page.waitForFunction(() => !document.querySelector('[data-testid=coach-feedback] .animate-spin'), null, { timeout: 10000 });
  console.log('texto:', await page.$eval('[data-testid=coach-text]', (e) => e.textContent));
  // El rival NO mueve mientras Alfred espera.
  await page.waitForTimeout(2500);
  console.log('tras 2,5 s el rival sigue esperando:', (await readFen()) !== fenBeforeBlunder && (await state()) === 'Alfred te detiene');

  await page.click('[data-testid=coach-why-btn]');
  await page.waitForSelector('[data-testid=coach-why-text]', { timeout: 10000 });
  console.log('¿Por qué?:', await page.$eval('[data-testid=coach-why-text]', (e) => e.textContent));
  console.log('línea de Stockfish:', await page.$eval('[data-testid=why-line]', (e) => e.textContent));
  await page.click('[data-testid=mini-next]');
  console.log('mini tablero avanza a la jugada:', await page.getAttribute('[data-testid=mini-board]', 'data-ply'));
  await page.screenshot({ path: `${OUT}/alfred-interrumpe.png` });

  // Retroceder → vuelve a la posición previa; luego la mejor jugada → felicitación.
  await page.click('[data-testid=coach-takeback]');
  await waitTurn();
  console.log('retrocedió a la posición previa:', (await readFen()) === fenBeforeBlunder);
  await page.waitForFunction(() => document.querySelector('[data-testid=best-move]')?.dataset.san, null, { timeout: 30000 });
  const chess = new Chess(fenBeforeBlunder);
  const bestSan = await page.$eval('[data-testid=best-move]', (e) => e.dataset.san);
  const best = chess.moves({ verbose: true }).find((m) => m.san === bestSan);
  await move(best.lan);
  await page.waitForSelector('[data-testid=coach-feedback][data-label]', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-testid=coach-feedback]')?.dataset.label, null);
  console.log('mejor jugada', bestSan, '→', await page.$eval('[data-testid=coach-feedback]', (e) => e.dataset.label), '|', await page.$eval('[data-testid=coach-text]', (e) => e.textContent));
  await page.screenshot({ path: `${OUT}/alfred-felicita.png` });
  await waitTurn();

  // Otro error y "Seguir": el rival responde y se revela la mejor jugada.
  let blunder2 = null;
  {
    const c0 = new Chess(await readFen());
    blunder2 = c0.moves({ verbose: true }).find((m) => ['q', 'r', 'n', 'b'].includes(m.piece) && !m.captured && (() => {
      const c = new Chess(c0.fen()); c.move(m); return c.attackers(m.to, 'b').some((sq) => c.get(sq).type === 'p');
    })());
  }
  if (blunder2) {
    await move(blunder2.lan);
    await page.waitForSelector('[data-testid=coach-continue]', { timeout: 30000 });
    await page.click('[data-testid=coach-continue]');
    await waitTurn();
    console.log('Seguir con', blunder2.san, '→ rival respondió; mejor:', await page.$eval('[data-testid=coach-best]', (e) => e.textContent).catch(() => '(sin dato)'));
  }

  console.log('peticiones a otros orígenes (sin clave debe ser 0):', external.length ? external : 0);
  console.log('errores de consola:', errors.length ? errors : 'ninguno');
  await browser.close();
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
