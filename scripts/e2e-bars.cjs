// Prueba en el navegador: barras de jugador (reloj de cada uno junto a su lado del tablero,
// piezas capturadas y ventaja +N) y tamaño de las piezas.
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-bars.cjs [URL] [carpeta-capturas]
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const { Chess } = require('chess.js');

const URL_BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || null;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

async function checkLayout(browser, viewport, expected) {
  const page = await browser.newPage({ locale: 'es-ES', viewport });
  await skipWelcome(page);
  await page.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.click('[data-testid=start-game]');
  await page.waitForTimeout(400);
  const label = `${viewport.width}×${viewport.height}`;
  const mode = await page.$eval('[data-bars]', (e) => e.dataset.bars);
  check(mode === expected, `${label}: disposición de las barras = ${mode} (esperada ${expected})`);
  const box = (sel) => page.locator(sel).boundingBox();
  const frame = await box('[data-testid=board-frame]');
  const top = await box('[data-testid=player-bar-b]');
  const bottom = await box('[data-testid=player-bar-w]');
  if (mode === 'edges') {
    check(top.y + top.height <= frame.y + 1 && bottom.y >= frame.y + frame.height - 1, `${label}: rival encima del tablero, tú debajo`);
    check(Math.abs(top.width - frame.width) < 2, `${label}: las barras miden lo mismo que el tablero`);
  } else {
    check(top.x >= frame.x + frame.width && bottom.x >= frame.x + frame.width, `${label}: barras a la derecha del tablero`);
    check(Math.abs(top.y - frame.y) < 4 && Math.abs(bottom.y + bottom.height - (frame.y + frame.height)) < 4, `${label}: rival alineado arriba, tú abajo`);
  }
  check(frame.height / viewport.height >= 0.68, `${label}: el tablero ocupa el ${Math.round((frame.height / viewport.height) * 100)}% del alto`);
  if (OUT) await page.screenshot({ path: `${OUT}/barras-${label}.png` });
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  await checkLayout(browser, { width: 1500, height: 950 }, 'edges');
  await checkLayout(browser, { width: 1004, height: 508 }, 'column');

  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1004, height: 508 } });
  await skipWelcome(page);
  await page.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  check(await page.locator('[data-testid=player-bar-w]').getByText('Jugador').isVisible(), 'tu barra muestra tu nombre (por defecto «Jugador»)');
  check(await page.locator('[data-testid=player-bar-b]').getByText('Ícaro').isVisible(), 'la barra del rival muestra a su personaje');

  // Tamaño de las piezas: proporción pieza / casilla.
  const ratio = await page.evaluate(() => {
    const sq = document.querySelector('[data-square="e1"]').getBoundingClientRect();
    const pc = document.querySelector('[data-square="e1"] [data-piece]').getBoundingClientRect();
    return pc.width / sq.width;
  });
  check(ratio > 0.9 && ratio < 0.96, `las piezas ocupan el ${Math.round(ratio * 100)}% de la casilla`);

  // Reloj: el tuyo corre tras tu jugada... del rival; al empezar corre el de quien mueve.
  const clickMove = async (from, to) => {
    await page.click(`[data-square="${from}"]`);
    await page.click(`[data-square="${to}"]`);
  };
  const waitTurn = () => page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });
  await clickMove('e2', 'e4');
  await waitTurn();
  await page.waitForTimeout(1500);
  const active = await page.evaluate(() => ['w', 'b'].filter((c) => document.querySelector(`[data-testid=bar-clock-${c}]`).className.includes('bg-brand-600')));
  check(active.join() === 'w', `en tu turno solo corre tu reloj (activo: ${active.join() || 'ninguno'})`);
  check(!(await page.$('[data-testid=clock-w]')), 'durante la partida no se muestra el reloj suelto de la columna derecha');

  // Capturas y ventaja: busca una captura legal de las blancas y la juega.
  let captured = false;
  for (let i = 0; i < 12 && !captured; i++) {
    const fen = await page.evaluate(() => {
      let rows = [];
      for (let r = 8; r >= 1; r--) {
        let row = '';
        let empty = 0;
        for (const f of 'abcdefgh') {
          const el = document.querySelector(`[data-square="${f}${r}"] [data-piece]`);
          if (!el) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          const k = el.dataset.piece;
          row += k[0] === 'w' ? k[1].toUpperCase() : k[1];
        }
        rows.push(row + (empty || ''));
      }
      return `${rows.join('/')} w - - 0 1`;
    });
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    const cap = moves.find((m) => m.captured && m.captured !== 'k');
    const mv = cap ?? moves.find((m) => m.piece === 'p') ?? moves[0];
    await clickMove(mv.from, mv.to);
    if (cap) {
      await page.waitForTimeout(300);
      const icons = await page.$$eval('[data-testid=captured-w] svg', (els) => els.length);
      check(icons >= 1, `tras capturar (${cap.san}) aparece la pieza en tu barra (${icons})`);
      captured = true;
    }
    await waitTurn();
  }
  check(captured, 'se pudo probar una captura');
  const adv = await page.evaluate(() => ({
    w: document.querySelector('[data-testid=advantage-w]')?.textContent ?? null,
    b: document.querySelector('[data-testid=advantage-b]')?.textContent ?? null,
  }));
  check(!(adv.w && adv.b), `la ventaja +N aparece como mucho en una barra (blancas ${adv.w ?? '—'}, negras ${adv.b ?? '—'})`);
  if (OUT) await page.screenshot({ path: `${OUT}/barras-claro.png` });
  await page.click('[data-testid=theme-toggle]');
  await page.waitForTimeout(300);
  if (OUT) await page.screenshot({ path: `${OUT}/barras-oscuro.png` });

  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
