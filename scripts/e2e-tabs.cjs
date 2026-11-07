// Prueba en el navegador: arrastrar piezas, flechas, y partida viva al cambiar de pestaña
// (reloj y rival siguen; Análisis independiente; abandono a los 30 s fuera de Entrenar).
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-tabs.cjs [URL]        (por defecto http://localhost:4173/)
// Requiere Playwright con Chromium. Tarda ~1 min (espera los 30 s del abandono).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

// Análisis necesita partidas importadas: se sube un PGN de prueba desde Mis partidas antes de empezar.
const SAMPLE_PGN = fs.readFileSync(path.join(__dirname, '../src/import/__fixtures__/demo-lichess.pgn'));

const URL_BASE = process.argv[2] || 'http://localhost:4173/';
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};
const secs = (t) => {
  const [m, s] = t.replace(/[^\d:]/g, '').split(':').map(Number);
  return m * 60 + s;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1500, height: 950 } });
  await skipWelcome(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Esta prueba no es de Alfred: sin interrupciones (el rival de nivel 1 es aleatorio y
  // a veces convierte una jugada normal en error, lo que detendría la partida).
  await page.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.click('[data-testid=menu-toggle]');
  await page.click('[data-testid=nav-games]');
  await page.setInputFiles('[data-testid=pgn-input]', [{ name: 'muestra.pgn', mimeType: 'application/x-chess-pgn', buffer: SAMPLE_PGN }]);
  await page.click('[data-testid=pgn-save]');
  await page.waitForSelector('[data-testid=games-list]');
  await page.click('[data-testid=menu-toggle]');
  await page.click('[data-testid=nav-practice]');
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');

  const center = async (sq) => {
    const box = await page.locator(`[data-square="${sq}"]`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const drag = async (from, to, button = 'left') => {
    const a = await center(from);
    const c = await center(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button });
    for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + ((c.x - a.x) * i) / 10, a.y + ((c.y - a.y) * i) / 10);
    await page.mouse.up({ button });
  };
  const pieceAt = (sq) => page.$eval(`[data-square="${sq}"]`, (e) => e.querySelector('[data-piece]')?.dataset.piece ?? null);
  const matchState = () => page.$eval('[data-testid=match-state]', (e) => e.textContent).catch(() => null);
  const waitTurn = () =>
    page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });
  const clockW = async () => secs(await page.$eval('[data-testid=bar-clock-w]', (e) => e.textContent));
  const pieceCount = () => page.$$eval('[data-piece]', (els) => els.length);
  // El menú es tipo hamburguesa: se abre con ☰ y se cierra al elegir una opción.
  const go = async (tab) => {
    await page.click('[data-testid=menu-toggle]');
    await page.click(`[data-testid=nav-${tab}]`);
  };

  // 1. Arrastrar
  await drag('e2', 'e4');
  await page.waitForTimeout(300);
  check((await pieceAt('e4')) === 'wp' && (await pieceAt('e2')) === null, 'arrastrar e2→e4 mueve el peón');
  await waitTurn();

  // 2. Arrastrar una pieza rival o en jugada ilegal no hace nada
  const before = await page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
  await drag('d1', 'd5');
  await page.waitForTimeout(300);
  const after = await page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
  check(before === after, 'arrastre ilegal (Dd1→d5) no cambia el tablero');

  // 3. Flechas con clic derecho siguen funcionando (también desde una pieza)
  const arrowsBefore = await page.$$eval('svg line', (l) => l.length);
  await drag('g1', 'f3', 'right');
  await page.waitForTimeout(200);
  check((await page.$$eval('svg line', (l) => l.length)) === arrowsBefore + 1, 'clic derecho y arrastrar dibuja una flecha');

  // 4. Mover con clics
  await page.click('[data-square="g1"]');
  await page.click('[data-square="f3"]');
  await page.waitForTimeout(300);
  check((await pieceAt('f3')) === 'wn', 'clic-clic mueve el caballo a f3');
  await waitTurn();

  // 5. Fuera de Entrenar el reloj sigue y aparece la cuenta atrás
  const snapshot = () => page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
  const beforeLeaving = await snapshot(); // es tu turno: el rival no puede mover mientras estás fuera
  const w0 = await clockW();
  await go('progress');
  await page.waitForSelector('[data-testid=away-banner]', { timeout: 3000 });
  await page.waitForTimeout(4200);
  const left = Number(await page.$eval('[data-testid=away-seconds]', (e) => e.textContent));
  check(left >= 24 && left <= 27, `cuenta atrás de abandono en marcha (${left} s restantes)`);
  await page.click('[data-testid=back-to-game]');
  await page.waitForSelector('[data-testid=match-panel]');
  const w1 = await clockW();
  check(w0 - w1 >= 4 && w0 - w1 <= 6, `el reloj siguió corriendo fuera de Entrenar (${w0}s → ${w1}s)`);
  check((await snapshot()) === beforeLeaving, 'la partida sigue intacta al volver');
  check(!(await page.$('[data-testid=away-banner]')), 'al volver desaparece el aviso');

  // 6. El rival juega aunque no estés en Entrenar
  const position = () => page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
  await drag('f1', 'c4');
  await page.waitForTimeout(150);
  check((await pieceAt('c4')) === 'wb', 'arrastrar Af1→c4');
  const afterMine = await position();
  await go('progress');
  await page.waitForTimeout(4000);
  await go('practice');
  const onReturn = await position(); // leída al instante: el rival no pudo mover después de volver
  check(onReturn !== afterMine && (await matchState()) === 'Tu turno', 'el rival respondió mientras estabas en otra pestaña');

  // 7. Análisis tiene su propio tablero y no toca la partida
  const practicePos = await page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
  await go('analysis');
  check(!(await page.$('[data-testid=match-panel]')), 'en Análisis no se muestra el panel de la partida');
  await page.locator('text=vs ').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has(svg.lucide-chevron-first)').click().catch(() => {});
  await go('practice');
  await page.waitForSelector('[data-testid=match-panel]');
  const practicePos2 = await page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
  check(practicePos === practicePos2, 'cargar y navegar una partida en Análisis no cambia la de Entrenar');

  // 8. Más de 30 s fuera → abandono
  await go('progress');
  await page.waitForTimeout(31500);
  check(!(await page.$('[data-testid=away-banner]')), 'tras 30 s desaparece la cuenta atrás');
  check(await page.getByText('Partida abandonada').isVisible().catch(() => false), 'aviso de partida abandonada');
  await go('practice');
  const result = await page.$eval('[data-testid=game-result]', (e) => e.textContent).catch(() => '');
  check(result.startsWith('Abandono · Gana el rival'), `resultado: "${result}"`);
  check((await matchState()) === 'Terminada', 'la partida queda terminada');

  check(errors.length === 0, `sin errores de página${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
