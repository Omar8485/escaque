// Prueba en el navegador de la PWA: manifiestos e iconos, service worker, uso sin conexión con
// Stockfish en "Listo" y la página aislada (crossOriginIsolated), y botón de instalar.
// Uso (build de producción; mejor con las cabeceras reales de Cloudflare):
//   npm run build && npx wrangler dev --port 8787      (o: npx vite preview --port 4681)
//   node scripts/e2e-pwa.cjs [URL]                     (por defecto http://localhost:8787/)
const { chromium } = require('playwright');

const URL_BASE = (process.argv[2] || 'http://localhost:8787/').replace(/\/?$/, '/');
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

/** Ancho y alto de un PNG (cabecera IHDR). */
const pngSize = (buf) => (buf.readUInt32BE(12) === 0x49484452 ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);

async function waitReady(page, label = 'Listo') {
  await page.getByText(label, { exact: true }).first().waitFor({ timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
  // La bienvenida (primera visita) se prueba en e2e-launch.cjs; aquí no estorba.
  await context.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // --- 1. Manifiestos e iconos ---
  for (const [file, lang] of [['manifest.webmanifest', 'es'], ['manifest.en.webmanifest', 'en']]) {
    const res = await context.request.get(URL_BASE + file);
    check(res.ok(), `${file}: HTTP ${res.status()}`);
    check(/manifest\+json|application\/json/.test(res.headers()['content-type'] || ''), `${file}: content-type ${res.headers()['content-type']}`);
    const m = await res.json();
    check(m.name === 'Escaque' && m.short_name === 'Escaque', `${file}: nombre`);
    check(m.display === 'standalone' && m.start_url === '/' && m.scope === '/' && m.lang === lang, `${file}: display/start_url/scope/lang`);
    check(/^#[0-9a-f]{6}$/i.test(m.theme_color) && /^#[0-9a-f]{6}$/i.test(m.background_color), `${file}: colores`);
    for (const purpose of ['any', 'maskable']) {
      for (const size of [192, 512]) {
        const icon = m.icons.find((i) => i.purpose === purpose && i.sizes === `${size}x${size}`);
        if (!icon) { check(false, `${file}: falta icono ${purpose} ${size}`); continue; }
        const r = await context.request.get(new URL(icon.src, URL_BASE).href);
        const dim = r.ok() ? pngSize(await r.body()) : null;
        check(dim?.w === size && dim?.h === size, `${file}: icono ${purpose} ${size} accesible y de ${size}×${size}`);
      }
    }
  }
  const apple = await context.request.get(`${URL_BASE}icons/apple-touch-icon.png`);
  check(apple.ok() && pngSize(await apple.body())?.w === 180, 'apple-touch-icon 180×180');

  // --- 2. Primera visita: SW registrado y precarga (shell + Stockfish) ---
  const t0 = Date.now();
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
  await waitReady(page);
  console.log(`     primera visita: "Listo" en ${Date.now() - t0} ms`);
  check(await page.evaluate(() => crossOriginIsolated), 'en línea: crossOriginIsolated === true');
  check(await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href')) === '/manifest.webmanifest', 'link rel=manifest (es)');
  check(await page.evaluate(() => !!document.querySelector('link[rel=apple-touch-icon]') && !!document.querySelector('meta[name=theme-color]')), 'apple-touch-icon y theme-color en <head>');
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active?.scriptURL };
  });
  check(reg.script?.endsWith('/sw.js'), `SW activo: ${reg.script}`);
  const precached = await page
    .waitForFunction(
      async () => {
        const names = await caches.keys();
        const engine = names.find((n) => n.startsWith('escaque-engine-'));
        const shell = names.find((n) => n.startsWith('escaque-shell-'));
        if (!engine || !shell) return false;
        const wasm = await (await caches.open(engine)).match('/stockfish/stockfish.wasm');
        const index = await (await caches.open(shell)).match('/');
        return wasm && index ? { names, wasm: (await wasm.arrayBuffer()).byteLength } : false;
      },
      null,
      { timeout: 120000, polling: 500 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);
  check(!!precached, `precarga completa (${precached ? `${precached.names.join(', ')}; wasm ${precached.wasm} B` : 'no terminó'})`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'la pestaña queda controlada por el SW (clients.claim)');

  // --- 3. Sin conexión: recarga, motor en "Listo", aislamiento y pestañas ---
  await context.setOffline(true);
  const t1 = Date.now();
  await page.reload();
  await waitReady(page);
  console.log(`     sin conexión: "Listo" en ${Date.now() - t1} ms`);
  check(await page.evaluate(() => navigator.onLine === false), 'el navegador está sin conexión');
  check(await page.evaluate(() => crossOriginIsolated), 'sin conexión: crossOriginIsolated === true');
  check(await page.evaluate(() => typeof SharedArrayBuffer === 'function'), 'sin conexión: SharedArrayBuffer disponible');
  for (const [tab, testid] of [['puzzles', 'puzzles'], ['progress', 'progress'], ['practice', 'practice']]) {
    await page.click('[data-testid=menu-toggle]');
    await page.click(`[data-testid=nav-${tab}]`);
    await page.waitForTimeout(800);
    const heading = await page.locator('header h2').first().textContent();
    check(!!heading && !(await page.getByText(/error/i).filter({ hasText: /chunk|module|fetch/i }).count()), `sin conexión: pestaña ${testid} abre ("${heading}")`);
  }
  // Partida corta sin conexión: el rival (otro worker de Stockfish) responde.
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  const sq = async (s) => page.locator(`[data-square="${s}"]`).click();
  await sq('e2');
  await sq('e4');
  const blackMoved = await page
    .waitForFunction(
      () => {
        // Alguna pieza negra dejó su casilla inicial.
        const start = ['a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7', 'b8', 'g8'];
        return start.some((s) => !document.querySelector(`[data-square="${s}"] [data-piece]`));
      },
      null,
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);
  check(blackMoved, 'sin conexión: el rival responde a 1.e4');
  // Páginas legales también sin conexión (precargadas; en Cloudflare, /x.html redirige a /x).
  for (const [file, h1] of [['privacidad.html', /Política de privacidad/], ['terms.html', /Terms of use/], ['licencias.html', /Licencias/]]) {
    const ok = await page.goto(URL_BASE + file).then((r) => r?.ok()).catch(() => false);
    check(ok && h1.test((await page.locator('h1').textContent().catch(() => '')) || ''), `sin conexión: ${file} se abre`);
  }
  await context.setOffline(false);

  // --- 4. Botón "Instalar app" ---
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await waitReady(page);
  await page.click('[data-testid=menu-toggle]');
  check((await page.locator('[data-testid=install-app]').count()) === 0, 'sin beforeinstallprompt (escritorio): no hay botón de instalar');
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__installPrompted = true; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  const installBtn = page.locator('[data-testid=install-app]');
  check(await installBtn.isVisible().catch(() => false), `con beforeinstallprompt: botón "${(await installBtn.textContent().catch(() => '')) || '?'}"`);
  await installBtn.click().catch(() => {});
  check(await page.evaluate(() => window.__installPrompted === true), 'el botón abre el diálogo del navegador (prompt)');
  check((await page.locator('[data-testid=install-app]').count()) === 0, 'tras usarlo, el botón desaparece');
  await page.keyboard.press('Escape');

  // iPhone (Safari no tiene beforeinstallprompt): botón con instrucciones.
  const ios = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await ios.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
  const ip = await ios.newPage();
  await ip.goto(URL_BASE);
  await ip.mouse.move(300, 300);
  await ip.click('[data-testid=menu-toggle]');
  await ip.click('[data-testid=install-app]');
  const help = await ip.locator('[data-testid=install-ios-help]').textContent().catch(() => '');
  check(/Share/.test(help) && /Add to Home Screen/.test(help), `iOS (en): instrucciones "${help.trim()}"`);
  check(await ip.evaluate(() => document.querySelector('link[rel=manifest]').getAttribute('href')) === '/manifest.en.webmanifest', 'en inglés: link rel=manifest → manifest.en.webmanifest');
  await ios.close();

  check(errors.length === 0, `sin errores de página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
