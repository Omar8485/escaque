// Motor en teléfonos (src/engine/deviceProfile.js): stockfish-movil.js (tope de memoria de 512 MB),
// rival diferido, reintento si el motor falla al arrancar y diagnóstico. Y que el escritorio no cambie.
// Uso: npm run build && npx vite preview --port 4400   y   node scripts/e2e-engine-phone.cjs [URL]
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
let fails = 0; const check = (ok, msg) => { console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`); if (!ok) fails++; };
const URL = process.argv[2] || 'http://localhost:4400/';
async function open(b, phone, { breakFirst = false, notice = false, welcome = false } = {}) {
  const ctx = await b.newContext(phone ? { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: 'es-ES', serviceWorkers: 'block' } : { viewport: { width: 1280, height: 800 }, locale: 'es-ES', serviceWorkers: 'block' });
  await skipWelcome(ctx);
  if (notice) await ctx.addInitScript(() => localStorage.removeItem('escaque:pcNoticeSeen'));
  if (welcome) await ctx.addInitScript(() => localStorage.removeItem('escaque:welcomeSeen'));
  const workers = []; let broken = 0;
  if (breakFirst) await ctx.route('**/stockfish/stockfish-movil.js', (route) => (broken++ < 1 ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }, body: 'throw new RangeError("WebAssembly.Memory(): could not allocate memory (simulado)")' }) : route.continue()));
  const p = await ctx.newPage();
  p.on('worker', (w) => workers.push({ url: w.url(), t: Date.now() }));
  const t0 = Date.now(); await p.goto(URL); await p.mouse.move(600, 300).catch(() => {});
  return { ctx, p, workers, t0 };
}
(async () => {
  const b = await chromium.launch();
  // Aviso de compatibilidad: teléfono, persistencia y orden tras la bienvenida.
  {
    const { ctx, p } = await open(b, true, { notice: true, welcome: true });
    await p.locator('[data-testid=welcome]').waitFor();
    check(await p.locator('[data-testid=welcome-pc-note]').isVisible(), 'bienvenida: nota para PC visible');
    check(await p.locator('[data-testid=pc-notice]').count() === 0, 'aviso espera a cerrar la bienvenida');
    await p.tap('[data-testid=welcome-start]');
    await p.locator('[data-testid=pc-notice]').waitFor();
    check(true, 'teléfono: aviso para PC visible después de la bienvenida');
    await p.tap('[data-testid=pc-notice-ok]');
    check(await p.locator('[data-testid=pc-notice]').count() === 0, 'Entendido cierra el aviso');
    await p.reload();
    await p.locator('main[data-engines-ready=true]').waitFor({ timeout: 60000 });
    check(await p.locator('[data-testid=pc-notice]').count() === 0, 'el aviso no vuelve al recargar');
    await ctx.close();
  }
  // 1) Teléfono normal
  {
    const { ctx, p, workers, t0 } = await open(b, true);
    await p.locator('main[data-engines-ready=true]').waitFor({ timeout: 60000 });
    const sf = workers.filter((w) => w.url.includes('/stockfish/') && !decodeURIComponent(w.url).endsWith(',worker'));
    check(sf.length === 2 && sf.every((w) => w.url.includes('stockfish-movil.js#%2Fstockfish%2Fstockfish.wasm')), `teléfono: los 2 motores usan stockfish-movil.js (${sf.map((w) => w.url.split('/').pop()).join(', ')})`);
    check(sf.length === 2 && sf[1].t - sf[0].t >= 150, `teléfono: el rival arranca después del analista (+${sf.length === 2 ? sf[1].t - sf[0].t : '?'} ms)`);
    await p.tap('[data-testid=play-start]'); await p.waitForTimeout(1500);
    await p.tap('[data-square=e2]'); await p.tap('[data-square=e4]');
    await p.locator('[data-testid=coach-line][data-kind=feedback]').waitFor({ timeout: 60000 });
    check(true, 'teléfono: el coach comenta la jugada');
    await p.tap('[data-testid=play-more]'); await p.tap('[data-testid=play-engine-diag]');
    await p.locator('[data-testid=engine-diag]').waitFor();
    const last = await p.textContent('[data-testid=engine-diag-last]');
    check(/profundidad 15/.test(last), `diagnóstico: último análisis «${last}»`);
    await ctx.close();
  }
  // 2) Teléfono: el primer arranque del motor falla → reintento automático
  {
    const { ctx, p } = await open(b, true, { breakFirst: true });
    await p.waitForTimeout(800);
    const during = await p.evaluate(() => document.querySelector('header')?.innerText || '');
    check(!/Error de worker/.test(during), 'fallo al arrancar: no muestra «Error de worker» mientras reintenta');
    await p.locator('main[data-engines-ready=true]').waitFor({ timeout: 60000 });
    check(true, 'fallo al arrancar: tras el reintento, motores listos');
    await p.tap('[data-testid=play-start]'); await p.waitForTimeout(800);
    await p.tap('[data-testid=play-more]'); await p.tap('[data-testid=play-engine-diag]');
    const err = await p.textContent('[data-testid=engine-diag-error]').catch(() => '');
    check(/could not allocate memory/.test(err), `diagnóstico: muestra el motivo del fallo («${err.slice(0, 70)}»)`);
    await ctx.close();
  }
  // 3) Escritorio: sin cambios
  {
    const { ctx, p, workers } = await open(b, false, { notice: true });
    await p.locator('main[data-engines-ready=true]').waitFor({ timeout: 60000 });
    const sf = workers.filter((w) => w.url.includes('/stockfish/') && !decodeURIComponent(w.url).endsWith(',worker'));
    check(sf.length === 2 && sf.every((w) => /\/stockfish\.js/.test(w.url)), `escritorio: los 2 motores usan stockfish.js como siempre (${sf.map((w) => w.url.split('/').pop()).join(', ')})`);
    check(sf.length === 2 && Math.abs(sf[1].t - sf[0].t) < 150, 'escritorio: el rival arranca a la vez que el analista, como siempre');
    check(await p.locator('[data-testid=pc-notice]').count() === 0, 'escritorio: nunca muestra el aviso para PC');
    check(!(await p.$('[data-testid=play-engine-diag], [data-testid=engine-diag-open]')), 'escritorio: sin diagnóstico');
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} fallo(s)` : 'todo OK'); process.exit(fails ? 1 : 0);
})();
