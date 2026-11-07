// Prueba en el navegador: la voz de los rivales en inglés y el cambio de idioma en vivo.
// Uso: npm run build && npx vite preview --port 4623   y en otra terminal
//   node scripts/e2e-rival-voice-en.cjs [URL] [carpeta-capturas]
// Comprueba: con el navegador en inglés el saludo de Ícaro sale de personalities.en.js; al cambiar
// a Español con el globo abierto, el mismo globo muestra la misma frase (mismo índice) en español;
// y 0 errores de consola.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

const URL_BASE = process.argv[2] || 'http://localhost:4623/';
const OUT = process.argv[3] || null;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

(async () => {
  const { getPersonality } = await import(pathToFileURL(path.join(__dirname, '../src/rivals/personalities.js')).href);
  const en = getPersonality(1, 'en').lines.game_start;
  const es = getPersonality(1, 'es').lines.game_start;

  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
  await skipWelcome(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await page.getByText('Ready', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  const bubble = '[data-testid=player-bar-b] [data-testid=rival-speech] span.relative';
  await page.waitForSelector(bubble, { timeout: 5000 });
  const hello = (await page.textContent(bubble)).trim();
  const idx = en.indexOf(hello);
  check(idx >= 0, `saludo de Ícaro en inglés: «${hello}»`);
  if (OUT) await page.screenshot({ path: `${OUT}/rival-saludo-en.png` });

  await page.click('[data-testid=menu-toggle]');
  await page.selectOption('[data-testid=lang-select]', 'es');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const hola = (await page.textContent(bubble).catch(() => '')).trim();
  check(idx >= 0 && hola === es[idx], `misma frase en español al cambiar de idioma: «${hola}»`);
  if (OUT) await page.screenshot({ path: `${OUT}/rival-saludo-es.png` });

  check(errors.length === 0, `sin errores de consola${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FALLO(S)` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
})();
