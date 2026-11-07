// Prueba en el navegador: personajes del rival, ritmo, un solo juego de relojes, sin chat,
// animación y resaltado de la jugada del rival, y sonido de las piezas.
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-feel.cjs [URL] [carpeta-capturas]
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

const URL_BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || null;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1280, height: 760 } });
  await skipWelcome(page);
  await page.addInitScript(() => {
    localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true }));
    // Cuenta los golpes de madera sintetizados (cada golpe crea un oscilador).
    window.__knocks = 0;
    const orig = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...a) {
      window.__knocks += 1;
      return orig.apply(this, a);
    };
  });
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });

  // Personajes y ritmo
  const names = await page.$$eval('button[data-testid^=level-] span:last-child', (els) => els.map((e) => e.textContent));
  check(names.join() === 'Ícaro,Narciso,Perseo,Jasón,Teseo,Héctor,Odiseo,Aquiles,Heracles,Atenea', `10 personajes: ${names.join(', ')}`);
  check((await page.textContent('[data-testid=level-label]')).includes('Héctor'), 'por defecto, Héctor (≈1500)');
  check((await page.textContent('[data-testid=start-game]')).includes('Héctor'), 'botón "Jugar contra Héctor"');
  check(!(await page.$('[data-testid=clock-w]')), 'no hay reloj suelto en la columna derecha');
  await page.click('[data-testid=time-5]');
  check((await page.textContent('[data-testid=bar-clock-w]')) === '5:00', 'elegir 5 min cambia los relojes del tablero');

  // Sin chat
  await page.click('[data-testid=menu-toggle]');
  check(!(await page.$('[data-testid=nav-coach]')), 'el menú ya no tiene la sección Coach');
  await page.keyboard.press('Escape');

  // Partida contra Ícaro
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  check(await page.locator('[data-testid=player-bar-b]').getByText('Ícaro').isVisible(), 'la barra del rival dice "Ícaro"');

  const before = await page.evaluate(() => window.__knocks);
  await page.click('[data-square="e2"]');
  await page.click('[data-square="e4"]');
  await page.waitForTimeout(150);
  const afterMine = await page.evaluate(() => window.__knocks);
  check(afterMine > before, `suena al mover (${afterMine - before} golpe)`);

  // La jugada del rival se anima: se captura el estilo justo cuando aparece.
  const anim = await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-animating="true"]');
      if (!el) return null;
      return { transform: getComputedStyle(el).transform, square: el.closest('[data-square]').dataset.square };
    },
    null,
    { timeout: 60000, polling: 'raf' },
  );
  const a = await anim.jsonValue();
  check(a.transform && a.transform !== 'none', `la pieza del rival se desliza hasta ${a.square} (transform ${a.transform.slice(0, 30)}…)`);
  await page.waitForTimeout(500);
  const end = await page.$eval('[data-animating="true"]', (e) => getComputedStyle(e).transform).catch(() => 'none');
  check(end === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(end), 'al terminar queda en su casilla');
  const lit = await page.$$eval('[data-last-move="true"]', (els) => els.map((e) => e.closest('[data-square]').dataset.square));
  check(lit.length === 2 && lit.includes(a.square), `se resaltan las casillas de su jugada (${lit.join(', ')})`);
  check((await page.evaluate(() => window.__knocks)) > afterMine, 'también suena la jugada del rival');
  if (OUT) await page.screenshot({ path: `${OUT}/feel-ultima-jugada.png` });

  // Silenciar
  await page.click('[data-testid=sound-toggle]');
  check((await page.getAttribute('[data-testid=sound-toggle]', 'data-sound')) === 'off', 'el botón de altavoz silencia');
  await page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });
  const muted0 = await page.evaluate(() => window.__knocks);
  await page.click('[data-square="d2"]');
  await page.click('[data-square="d3"]');
  await page.waitForTimeout(200);
  check((await page.evaluate(() => window.__knocks)) === muted0, 'silenciado no suena');
  await page.reload();
  await page.waitForTimeout(400);
  check((await page.getAttribute('[data-testid=sound-toggle]', 'data-sound')) === 'off', 'la preferencia se recuerda al recargar');

  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
