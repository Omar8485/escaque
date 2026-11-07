// Comprueba que el tablero encaja (no se corta) a distintos niveles de zoom del navegador.
// El zoom del navegador equivale a una ventana más pequeña en píxeles CSS: 150 % en una
// pantalla de 1500×950 = ventana de 1000×633. Se prueban Entrenar (con partida) y Análisis.
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-layout.cjs [URL] [carpeta-capturas]
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

// Análisis necesita partidas importadas: se sube un PGN de prueba desde Mis partidas.
const SAMPLE_PGN = fs.readFileSync(path.join(__dirname, '../src/import/__fixtures__/demo-lichess.pgn'));
async function seedGames(page) {
  await page.click('[data-testid=menu-toggle]');
  await page.click('[data-testid=nav-games]');
  await page.setInputFiles('[data-testid=pgn-input]', [{ name: 'muestra.pgn', mimeType: 'application/x-chess-pgn', buffer: SAMPLE_PGN }]);
  await page.click('[data-testid=pgn-save]');
  await page.waitForSelector('[data-testid=games-list]');
}

const URL_BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || null;
const SCREEN = { width: 1500, height: 950 };
const ZOOMS = [1, 1.25, 1.5, 1.75, 2];
const MOBILE = { width: 390, height: 844, label: 'móvil 390×844' };
// Portátil con ventana baja al 125 % (caso reportado): ~1004×508 píxeles CSS.
const LAPTOP = { width: 1004, height: 508, label: 'portátil 125% 1004×508' };

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

async function measure(page) {
  // En el diseño apilado la página se desplaza: se lleva el tablero a la vista, como haría el usuario.
  await page.evaluate(() => document.querySelector('[data-testid=board-frame]').scrollIntoView({ block: 'nearest' }));
  return page.evaluate(() => {
    const r = (el) => el && el.getBoundingClientRect();
    const a8 = r(document.querySelector('[data-square="a8"]'));
    const h1 = r(document.querySelector('[data-square="h1"]'));
    const grid = document.querySelector('[data-square="a8"]').parentElement;
    const g = r(grid);
    // Contenedor que recorta: el primer ancestro con overflow distinto de visible.
    let clip = grid.parentElement;
    const clips = [];
    while (clip && clip !== document.body) {
      const s = getComputedStyle(clip);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clips.push(r(clip));
      clip = clip.parentElement;
    }
    const nav = [...document.querySelectorAll('button')].find((b) => b.querySelector('.lucide-chevron-first'));
    nav?.scrollIntoView({ block: 'nearest' });
    const navR = r(nav);
    const inside = (a, b) => a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.left >= b.left - 1 && a.right <= b.right + 1;
    const vis = (a) => clips.every((c) => inside(a, c));
    const boardOk = vis(a8) && vis(h1);
    const frameFits = g.height <= document.querySelector('main').clientHeight;
    return {
      frameFits,
      square: Math.round(g.width),
      squareH: Math.round(g.height),
      boardVisible: boardOk,
      navVisible: navR ? vis(r(nav)) : false,
      sameSize: Math.abs(a8.width - h1.width) < 1 && Math.abs(a8.width - a8.height) < 1.5,
      pageScrollable: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    ...ZOOMS.map((z) => ({ width: Math.round(SCREEN.width / z), height: Math.round(SCREEN.height / z), label: `zoom ${z * 100}%` })),
    LAPTOP,
    MOBILE,
  ];
  for (const size of sizes) {
    const page = await browser.newPage({ locale: 'es-ES', viewport: { width: size.width, height: size.height } });
    await skipWelcome(page);
    await page.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
    await page.goto(URL_BASE);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
    await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
    await page.click('[data-testid=start-game]');
    await page.waitForTimeout(400);

    const m = await measure(page);
    check(m.boardVisible && m.frameFits && m.sameSize && m.square >= 200, `${size.label} · Entrenar: tablero ${m.square}px entero y cuadrado${m.pageScrollable ? ' (la página se desplaza)' : ''}`);
    check(m.navVisible, `${size.label} · Entrenar: controles del tablero visibles`);
    if (size.width >= 960) {
      const share = m.square / size.height;
      check(share >= 0.65, `${size.label} · Entrenar: el tablero ocupa ${Math.round(share * 100)}% del alto (mín. 65%)`);
    }
    if (OUT) await page.screenshot({ path: `${OUT}/layout-${size.width}x${size.height}-entrenar.png` });

    await seedGames(page);
    await page.click('[data-testid=menu-toggle]');
    await page.click('[data-testid=nav-analysis]');
    await page.locator('[data-testid=analysis-game]').first().click();
    await page.waitForTimeout(400);
    const a = await measure(page);
    check(a.boardVisible && a.frameFits && a.sameSize && a.square >= 200, `${size.label} · Análisis: tablero ${a.square}px entero y cuadrado${a.pageScrollable ? ' (la página se desplaza)' : ''}`);
    if (OUT) await page.screenshot({ path: `${OUT}/layout-${size.width}x${size.height}-analisis.png` });
    await page.close();
  }
  // Menú hamburguesa y tema oscuro (tamaño del portátil)
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: LAPTOP.width, height: LAPTOP.height } });
  await skipWelcome(page);
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  const menuOpen = () => page.$eval('[data-testid=side-menu]', (e) => e.dataset.open === 'true');
  check(!(await menuOpen()), 'menú oculto al cargar');
  await page.mouse.move(400, 300);
  await page.mouse.move(1, 250);
  await page.waitForTimeout(400);
  check(await menuOpen(), 'acercar el ratón al borde izquierdo (y esperar un instante) abre el menú');
  await page.mouse.move(700, 250);
  await page.waitForTimeout(300);
  check(!(await menuOpen()), 'al alejar el ratón se cierra');
  await page.click('[data-testid=menu-toggle]');
  await page.waitForTimeout(250);
  check(await menuOpen(), 'el botón ☰ abre el menú');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check(!(await menuOpen()), 'Esc lo cierra');
  await page.click('[data-testid=menu-toggle]');
  await page.click('[data-testid=nav-progress]');
  // Progreso se carga bajo demanda (src/screens.js): se espera a que llegue, no un tiempo fijo.
  const progressHeading = page.locator('[data-testid=progress-screen]').getByRole('heading', { name: 'Progreso', exact: true });
  await progressHeading.waitFor({ timeout: 10000 }).catch(() => {});
  check(!(await menuOpen()) && (await progressHeading.isVisible()), 'elegir una opción navega y cierra el menú');
  await page.click('[data-testid=menu-toggle]');
  await page.click('[data-testid=nav-practice]');

  await page.click('[data-testid=theme-toggle]');
  await page.waitForTimeout(300);
  const light = await page.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/[\d.]+/g);
      if (!m) return 0;
      const [r, g, b, a = 1] = m.map(Number);
      return a < 0.05 ? 0 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const els = [...document.querySelectorAll('[data-testid=board-controls] *, [data-testid=board-controls]')];
    return els.map((e) => ({ t: e.textContent.trim().slice(0, 12), l: lum(getComputedStyle(e).backgroundColor) })).filter((x) => x.l > 0.5);
  });
  check(light.length === 0, `tema oscuro: sin fondos claros en los controles del tablero${light.length ? ' → ' + JSON.stringify(light) : ''}`);
  const frameBorder = await page.$eval('[data-testid=board-frame]', (e) => getComputedStyle(e).borderTopColor);
  const [fr, fg, fb] = frameBorder.match(/\d+/g).map(Number);
  check((0.2126 * fr + 0.7152 * fg + 0.0722 * fb) / 255 < 0.35, `tema oscuro: marco del tablero oscuro (${frameBorder})`);
  if (OUT) await page.screenshot({ path: `${OUT}/layout-portatil-oscuro.png` });
  await page.close();

  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
