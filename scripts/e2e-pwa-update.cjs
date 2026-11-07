// Prueba del aviso "Nueva versión disponible — Actualizar": sirve un build (A) con un servidor propio
// (con COOP/COEP), deja que el SW lo precargue, cambia a un build B (copia de A con index.html
// distinto y su sw.js regenerado con build-tools/pwa.js) y comprueba que aparece el aviso, que no
// aparece en la primera visita y que "Actualizar" recarga con la versión B. Además, que los términos
// se leen de la red aunque el SW sea el de A, y de la caché sin conexión.
// Uso: npm run build && node scripts/e2e-pwa-update.cjs [dist]   (por defecto dist/)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST_A = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

/** Servidor estático con COOP/COEP cuyo directorio se puede cambiar en caliente. */
function serve(getDir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(getDir(), p);
    if (!file.startsWith(getDir()) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const walk = (dir) => fs.readdirSync(dir).flatMap((f) => (fs.statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));

/** Copia A → B con un cambio en index.html y regenera sw.js como lo haría el build. */
async function makeBuildB() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escaque-build-b-'));
  fs.cpSync(DIST_A, dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'index.html'), '\n<!-- e2e: build B -->\n');
  const terms = path.join(dir, 'terminos.html');
  fs.writeFileSync(terms, fs.readFileSync(terms, 'utf8').replace('</main>', '<p>e2e: terminos B</p></main>'));
  const { precacheConfig, renderServiceWorker } = await import(pathToFileURL(path.join(ROOT, 'build-tools/pwa.js')).href);
  const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
  const files = walk(dir).map((abs) => ({ path: `/${path.relative(dir, abs).split(path.sep).join('/')}`, hash: sha(fs.readFileSync(abs)) }));
  const template = fs.readFileSync(path.join(ROOT, 'src/pwa/sw-template.js'), 'utf8');
  const config = precacheConfig(files, sha(template));
  fs.writeFileSync(path.join(dir, 'sw.js'), renderServiceWorker(template, config));
  return { dir, build: config.build };
}

const swBuild = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data.build);
        navigator.serviceWorker.controller?.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
        setTimeout(() => resolve(null), 3000);
      }),
  );

(async () => {
  const b = await makeBuildB();
  let current = DIST_A;
  const server = await serve(() => current);
  const url = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(url);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 120000 });
  const buildA = await swBuild(page);
  check(!!buildA, `versión A activa: ${buildA}`);
  await page.waitForTimeout(500);
  check((await page.locator('[data-testid=update-toast]').count()) === 0, 'primera visita: sin aviso de versión nueva');

  current = b.dir; // "despliegue" del build B
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  const shown = await page.locator('[data-testid=update-toast]').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  check(shown, 'aparece "Nueva versión disponible — Actualizar"');
  if (shown) {
    const text = await page.locator('[data-testid=update-toast]').textContent();
    check(/Nueva versión disponible/.test(text) && /Actualizar/.test(text), `texto del aviso: "${text.trim()}"`);
    // Las páginas legales van primero a la red: con el SW de A todavía al mando, ya se leen las de B.
    const legal = await context.newPage();
    await legal.goto(`${url}terminos.html`);
    const legalHtml = await legal.content();
    check(legalHtml.includes('terminos B'), 'sin actualizar: los términos se leen de la red (versión B)');
    await context.setOffline(true);
    await legal.goto(`${url}terminos.html`).catch(() => {});
    check(/Términos de uso/.test(await legal.content()), 'sin conexión: los términos salen de la caché');
    await context.setOffline(false);
    await legal.close();
    // No bloquea: el menú sigue respondiendo con el aviso visible.
    await page.click('[data-testid=menu-toggle]');
    check((await page.getByTestId('side-menu').getAttribute('data-open')) === 'true', 'con el aviso visible, la app sigue usable (menú abre)');
    await page.keyboard.press('Escape');
    await Promise.all([page.waitForEvent('load', { timeout: 30000 }), page.click('[data-testid=update-apply]')]);
    await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
    const buildB = await swBuild(page);
    check(buildB === b.build && buildB !== buildA, `tras "Actualizar": versión B (${buildB})`);
    const served = await (await page.request.get(url)).text();
    check(served.includes('build B'), 'el servidor ya sirve el build B');
    check(await page.evaluate(async () => (await (await caches.match('/')).text()).includes('build B')), 'la caché del SW tiene el index.html de B');
    check((await page.locator('[data-testid=update-toast]').count()) === 0, 'tras actualizar, sin aviso');
    check(await page.evaluate(() => crossOriginIsolated), 'tras actualizar: crossOriginIsolated === true');
    const names = await page.evaluate(() => caches.keys());
    check(names.filter((n) => n.startsWith('escaque-shell-')).length === 1, `cachés antiguas borradas: ${names.join(', ')}`);
  }

  check(errors.length === 0, `sin errores de página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  server.close();
  fs.rmSync(b.dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
