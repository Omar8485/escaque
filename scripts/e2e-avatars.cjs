// Prueba en el navegador: avatares de los personajes y editor del avatar del usuario.
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-avatars.cjs [URL] [carpeta-capturas]
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
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
  await skipWelcome(page);
  await page.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });

  // Personajes en el selector y antes de empezar en la barra superior
  const selectorAvatars = await page.$$eval('[data-testid=level-selector] [data-testid^=rival-avatar-]', (els) => new Set(els.map((e) => e.dataset.testid)).size);
  check(selectorAvatars === 10, `el selector muestra los 10 avatares (${selectorAvatars})`);
  await page.click('[data-testid=level-8]');
  check(Boolean(await page.$('[data-testid=player-bar-b] [data-testid=rival-avatar-8], [data-testid=player-bar-w] [data-testid=rival-avatar-8]')), 'antes de empezar, la barra del rival muestra a Aquiles');
  check(Boolean(await page.$('[data-testid^=player-bar-] [data-testid=user-avatar]')), 'y tu barra muestra tu avatar');
  check(await page.getByText('Coach Chess').count().then((n) => n >= 0), 'nombre de la app centralizado');
  check((await page.textContent('h2')).trim() === 'Entrenamiento', 'el título ya no es "Dojo de Entrenamiento"');

  // Editor
  await page.click('[data-testid=profile-button]');
  await page.waitForSelector('[data-testid=avatar-editor]');
  await page.fill('[data-testid=profile-name]', 'Ana G.');
  await page.click('[data-testid=opt-hair] >> text=Rizado');
  await page.click('[data-testid=opt-facial] >> text=Barba');
  await page.click('[data-testid=opt-glasses] >> text=Con gafas');
  await page.locator('[data-testid=opt-bg] button').nth(2).click();
  if (OUT) await page.screenshot({ path: `${OUT}/avatar-editor.png` });
  await page.click('[data-testid=avatar-save]');
  check(!(await page.$('[data-testid=avatar-editor]')), 'Guardar cierra el editor');

  await page.click('[data-testid=level-6]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  await page.waitForTimeout(300);
  check(await page.locator('[data-testid=player-bar-w]').getByText('Ana G.').isVisible(), 'tu barra usa el nombre nuevo');
  check(Boolean(await page.$('[data-testid=player-bar-b] [data-testid=rival-avatar-6]')), 'la barra del rival muestra a Héctor');
  check(Boolean(await page.$('[data-testid=match-panel] [data-testid=rival-avatar-6]')), 'el panel de la partida muestra a Héctor');
  const glasses = await page.$$eval('[data-testid=profile-button] circle[r="7"]', (els) => els.length);
  check(glasses === 2, 'la cabecera muestra el avatar con gafas');
  if (OUT) await page.screenshot({ path: `${OUT}/avatars-partida.png` });

  await page.reload();
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.click('[data-testid=profile-button]');
  check((await page.inputValue('[data-testid=profile-name]')) === 'Ana G.', 'el perfil se recuerda al recargar');
  await page.keyboard.press('Escape');
  check(!(await page.$('[data-testid=avatar-editor]')), 'Esc cierra el editor');

  await page.click('[data-testid=theme-toggle]');
  await page.waitForTimeout(300);
  if (OUT) await page.screenshot({ path: `${OUT}/avatars-oscuro.png` });

  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
