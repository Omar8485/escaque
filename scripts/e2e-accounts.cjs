// Prueba de punta a punta de cuentas, Premium y sincronización contra `wrangler dev` en MODO DE PRUEBA:
// proveedor OIDC simulado (solo existe con AUTH_TEST_MODE=1 en localhost) y Polar simulado
// (POLAR_SERVER=mock); los webhooks de Polar se firman aquí con el mismo esquema Standard Webhooks.
//
// Uso: npm run build && node scripts/e2e-accounts.cjs [carpeta-capturas]
//   (arranca su propio `wrangler dev` en el puerto 8799 con una base D1 local temporal)
//   o bien: node scripts/e2e-accounts.cjs --base http://localhost:8799/ [carpeta]  si ya está corriendo.
//
// Recorre: sin cuenta todo funciona (límites gratuitos con aviso) → sin la casilla de consentimiento
// no hay login ni se crea la cuenta → login simulado con la casilla (vuelve con crossOriginIsolated)
// → precios de Polar simulados (2,99 / 19,99 / 49,99: «1,67 al mes · ahorra 44 %», plazas de
// Fundador) → comprar (checkout simulado) → webhook firmado → Premium activo → datos locales suben y
// bajan en un segundo navegador (otro "dispositivo") con la misma cuenta → términos de una versión
// vieja: se piden de nuevo → cerrar sesión vuelve a los límites gratuitos → Fundador agotado
// (FOUNDER_LIMIT=1) y borrar la cuenta desde el menú. En es/en, claro/oscuro, 1004×508 y 390 px.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipWelcome } = require('./lib/welcome.cjs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const EXTERNAL = baseIdx >= 0 ? args[baseIdx + 1] : null;
const OUT = args.filter((a, i) => baseIdx < 0 || (i !== baseIdx && i !== baseIdx + 1))[0] || null;
const PORT = 8799;
const BASE = EXTERNAL || `http://localhost:${PORT}/`;
// Secreto FALSO de prueba (24 bytes 1..24), generado aquí para que no parezca una clave real.
const WEBHOOK_SECRET = `whsec_${Buffer.from(Array.from({ length: 24 }, (_, i) => i + 1)).toString('base64')}`;
const TERMS_VERSION = '1.0'; // shared/legal.js
const nb = (s) => String(s ?? '').replace(/[\u00a0\u202f]/g, ' ');

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

async function startWrangler() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'escaque-e2e-d1-'));
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'escaque', '--local', '--persist-to', state], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const vars = {
    AUTH_TEST_MODE: '1', POLAR_SERVER: 'mock', POLAR_PRODUCT_MONTHLY: 'mock-monthly', POLAR_PRODUCT_YEARLY: 'mock-yearly',
    POLAR_PRODUCT_FOUNDER: 'mock-founder', SESSION_SECRET: 'e2e-session-secret-0123456789abcdefghijklmnop', POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
    FOUNDER_LIMIT: '1',
  };
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: ROOT, env: { ...process.env, CI: '1' }, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}api/health`);
      if (r.ok) {
        return {
          // SQL sobre la D1 local del wrangler dev en marcha (para simular una cuenta con términos viejos).
          sql: (command) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'escaque', '--local', '--persist-to', state, '--command', command], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, CI: '1' } }),
          stop: () => { try { process.kill(-proc.pid); } catch { /* ya terminó */ } fs.rmSync(state, { recursive: true, force: true }); },
        };
      }
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev no arrancó');
}

/** Webhook de Polar firmado como Standard Webhooks (clave = base64 tras whsec_). */
async function sendWebhook(event) {
  const id = `msg_${crypto.randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  const key = Buffer.from(WEBHOOK_SECRET.slice('whsec_'.length), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  const res = await fetch(`${BASE}api/webhooks/polar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
    body,
  });
  return res.status;
}

const founderOrder = (userId) => ({
  type: 'order.paid',
  timestamp: new Date().toISOString(),
  data: {
    id: `ord_${userId.slice(0, 8)}`, status: 'paid', paid: true, product_id: 'mock-founder', billing_reason: 'purchase', customer_id: 'cus_f',
    modified_at: new Date().toISOString(), customer: { id: 'cus_f', external_id: userId }, metadata: {},
  },
});

const subscription = (type, userId, extra = {}) => ({
  type,
  timestamp: new Date().toISOString(),
  data: {
    id: 'sub_e2e', status: 'active', product_id: 'mock-monthly', customer_id: 'cus_e2e', cancel_at_period_end: false,
    current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), modified_at: new Date().toISOString(),
    customer: { id: 'cus_e2e', external_id: userId }, metadata: {}, ...extra,
  },
});

const PGN_GAME = (n) => ({
  id: `pgn:e2e${n}`, source: 'pgn', externalId: `e2e${n}`, url: null, white: 'tester', black: `rival${n}`, whiteElo: 1500, blackElo: 1500,
  result: '1-0', endTime: Date.now() - n * 3600_000, timeControl: '300+0', speed: 'blitz', rated: false, variant: 'standard', eco: null,
  opening: null, termination: null, pgn: `[White "tester"]\n[Black "rival${n}"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0`,
  playerName: 'tester', playerColor: 'w', importedAt: Date.now(),
});

(async () => {
  const server = EXTERNAL ? null : await startWrangler();
  const browser = await chromium.launch();
  const errors = [];
  const contexts = [];
  const apiResponses = [];
  // Respuestas de error provocadas a propósito (el navegador las anota en la consola): «label:estado».
  const expectedHttp = [];
  try {
    const open = async (label, { locale = 'es-ES', viewport = { width: 1280, height: 800 }, scheme = 'light' } = {}) => {
      const context = await browser.newContext({ locale, viewport, colorScheme: scheme });
      contexts.push(context);
      await skipWelcome(context);
      // La app guarda su tema en localStorage (no sigue prefers-color-scheme): se fija antes de cargar.
      if (scheme === 'dark') await context.addInitScript(() => { try { localStorage.setItem('coach-chess:theme', 'dark'); } catch { /* sin almacenamiento */ } });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
      // ERR_INTERNET_DISCONNECTED: solo lo provoca la comprobación deliberada de /api sin red (1b).
      page.on('console', (m) => {
        if (m.type() !== 'error' || m.text().includes('ERR_INTERNET_DISCONNECTED')) return;
        const i = expectedHttp.findIndex((e) => e.startsWith(`${label}:`) && m.text().includes(`status of ${e.split(':')[1]}`));
        if (i >= 0) expectedHttp.splice(i, 1);
        else errors.push(`${label}: ${m.text()}`);
      });
      page.on('dialog', (d) => d.accept());
      // Toda respuesta de /api debe venir de la red, nunca del service worker.
      page.on('response', (r) => { if (new URL(r.url()).pathname.startsWith('/api')) apiResponses.push({ label, url: r.url(), sw: r.fromServiceWorker() }); });
      await page.goto(BASE);
      // Playwright deja el puntero en (0,0), sobre el borde que abre el menú al pasar el ratón: eso
      // abría el menú a destiempo (sobre todo a 390 px, donde tapa ☰) y hacía fallar clics al azar.
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.waitForSelector('[data-testid=account-section][data-status=anonymous]', { timeout: 60000 });
      return { context, page };
    };
    const menu = async (page) => {
      if ((await page.getAttribute('[data-testid=side-menu]', 'data-open')) !== 'true') await page.click('[data-testid=menu-toggle]');
    };
    const nav = async (page, id) => {
      await menu(page);
      await page.click(`[data-testid=nav-${id}]`);
      // Progreso y Mis partidas son pantallas diferidas (src/screens.js): esperar a que monten.
      const screen = { progress: 'progress-screen', games: 'my-games' }[id];
      if (screen) await page.waitForSelector(`[data-testid=${screen}]`, { timeout: 30000 });
      await page.waitForTimeout(250);
    };
    const isolated = (page) => page.evaluate(() => globalThis.crossOriginIsolated === true);
    const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const shot = async (page, name) => OUT && page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const idb = (page, op, store, value) => page.evaluate(async ([o, s, v]) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('escaque'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const t = db.transaction(s, o === 'put' ? 'readwrite' : 'readonly');
      const st = t.objectStore(s);
      const req = o === 'put' ? st.put(v) : o === 'count' ? st.count() : o === 'get' ? st.get(v) : st.getAll();
      const out = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
      db.close();
      return out;
    }, [op, store, value]);

    // ── 1. Dispositivo A sin cuenta: todo local, límites gratuitos con aviso ──────────────────
    const A = await open('A');
    check(await isolated(A.page), 'A sin cuenta: crossOriginIsolated');
    // Partidas creadas antes de tener cuenta (luego se suben en la sincronización inicial).
    for (let i = 1; i <= 3; i++) await idb(A.page, 'put', 'games', PGN_GAME(i));
    await A.page.reload();
    await A.page.waitForSelector('[data-testid=account-section][data-status=anonymous]');
    await nav(A.page, 'progress');
    await A.page.waitForSelector('[data-testid=progress-premium-notice]');
    check(await A.page.locator('[data-testid=progress-openings-locked]').count() === 1, 'gratis: tarjeta de aperturas con aviso Premium');
    check(await A.page.$eval('[data-testid=progress-filter-period]', (s) => s.value) === '30', 'gratis: Progreso de 30 días');
    check(await A.page.$eval('[data-testid=progress-filter-period] option[value=all]', (o) => o.disabled), 'gratis: «Todo» bloqueado');
    await nav(A.page, 'games');
    check(await A.page.$eval('[data-testid=max-lichess]', (i) => i.value) === '50', 'gratis: importar como mucho 50 partidas');
    await nav(A.page, 'practice');
    check(await A.page.locator('[data-testid=board-theme]').first().isVisible(), 'jugar sigue disponible sin cuenta');

    // ── 1b. Service worker activo y controlando la página antes de iniciar sesión (como en la PWA
    //       instalada): el login es una navegación completa que el SW deja pasar a la red.
    const controlled = await A.page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 120000, polling: 500 }).then(() => true, () => false);
    check(controlled, 'SW activo y controlando la página antes del login');
    await A.context.setOffline(true);
    const offlineApi = await A.page.evaluate(() => fetch('/api/health').then((r) => `HTTP ${r.status}`, () => 'error de red'));
    await A.context.setOffline(false);
    check(offlineApi === 'error de red', `sin red, /api no sale de la caché del SW (${offlineApi})`);

    // ── 2. Consentimiento: sin la casilla no hay login ni cuenta nueva ────────────────────────
    await menu(A.page);
    check(await A.page.locator('[data-testid=login-test]').isVisible(), 'botón de inicio de sesión (proveedor de prueba)');
    check(!(await A.page.isChecked('[data-testid=login-consent]')), 'la casilla de consentimiento no viene marcada');
    check(await A.page.isDisabled('[data-testid=login-test]'), 'sin marcar la casilla, el botón de inicio de sesión está deshabilitado');
    const consentText = nb(await A.page.textContent('[data-testid=account-section]'));
    check(/Tengo 16 años o más y acepto los Términos y la Política de privacidad, incluida la transferencia de mis datos a los proveedores indicados fuera de Ecuador/.test(consentText), 'texto de la casilla (16 años, términos, privacidad, transferencia)');
    check(await A.page.locator('[data-testid=account-section] a[href="/terminos.html"]').count() === 1 && await A.page.locator('[data-testid=account-section] a[href="/privacidad.html"]').count() === 1, 'la casilla enlaza a Términos y Privacidad');
    // Saltarse la casilla yendo directo al login: el Worker no crea la cuenta.
    await A.page.goto(`${BASE}api/auth/login/test?hint=sinconsentimiento&return=/`);
    await A.page.waitForSelector('[data-testid=account-section][data-status=anonymous]', { timeout: 20000 });
    check((await A.page.getAttribute('[data-testid=account-notice]', 'data-key')) === 'account.result.consentRequired', 'login sin consentimiento → aviso y sin cuenta');
    check((await A.page.evaluate(() => fetch('/api/me').then((r) => r.json()))).user === null, '/api/me sin usuario tras el intento sin consentimiento');
    await A.page.mouse.move(640, 400);

    // ── 2b. Login simulado con la casilla (navegación completa; vuelve aislado) ─────────────
    await menu(A.page);
    await A.page.check('[data-testid=login-consent]');
    check(await A.page.isEnabled('[data-testid=login-test]'), 'con la casilla marcada, el botón se habilita');
    await A.page.click('[data-testid=login-test]');
    await A.page.waitForSelector('[data-testid=account-section][data-status=signedIn]', { timeout: 20000 });
    check(!(await A.page.evaluate(() => location.search)), 'la URL de vuelta queda limpia');
    const authResponses = apiResponses.filter((r) => r.label === 'A' && /\/api\/(auth|test-oidc)\//.test(r.url));
    check(authResponses.length >= 2 && authResponses.every((r) => !r.sw), `login: ${authResponses.length} respuestas de /api/auth y del proveedor, todas de la red (no del SW)`);
    check(await A.page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'tras el login la página vuelve a estar controlada por el SW');
    check(await isolated(A.page), 'tras volver del login: crossOriginIsolated sigue true');
    check((await A.page.getAttribute('[data-testid=account-notice]', 'data-key')) === 'account.result.ok', 'aviso «Sesión iniciada»');
    check((await A.page.getAttribute('[data-testid=account-section]', 'data-plan')) === 'free', 'plan gratuito al entrar');
    const me = await A.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    check(me.user?.email === 'tester@example.test' && typeof me.csrf === 'string', '/api/me con usuario y CSRF');
    check(me.consent?.accepted === TERMS_VERSION && me.consent?.required === false, `consentimiento registrado (versión ${me.consent?.accepted})`);
    const cookies = await A.context.cookies();
    const sid = cookies.find((c) => c.name.includes('escaque_sid'));
    check(sid && sid.httpOnly && sid.secure && sid.sameSite === 'Lax', 'cookie de sesión HttpOnly; Secure; SameSite=Lax');
    check(!(await A.page.evaluate(() => document.cookie)).includes('escaque_sid'), 'la cookie no es legible desde JavaScript');

    // ── 3. Pantalla Premium y compra simulada ─────────────────────────────────────────────
    await menu(A.page);
    await A.page.click('[data-testid=open-premium]');
    await A.page.waitForSelector('[data-testid=premium-product-founder]');
    check(await A.page.locator('[data-testid^=premium-product-]').count() === 3, 'precios de Polar (3 productos)');
    await A.page.waitForSelector('[data-testid=premium-founder-slots]');
    const order = await A.page.$$eval('[data-testid^=premium-product-]', (n) => n.map((x) => x.dataset.testid.replace('premium-product-', '')));
    check(order.join(',') === 'monthly,yearly,founder', `orden Mensual · Anual · Fundador (${order})`);
    check(nb(await A.page.textContent('[data-testid=premium-product-monthly]')).includes('2,99'), 'mensual 2,99 US$ (precio de Polar)');
    const yearly = nb(await A.page.textContent('[data-testid=premium-product-yearly]'));
    check(yearly.includes('19,99') && yearly.includes('Mejor valor'), 'anual 19,99 US$ destacado como «Mejor valor»');
    const deal = nb(await A.page.textContent('[data-testid=premium-yearly-deal]'));
    check(/1,67 US\$ al mes · ahorra 44 %/.test(deal), `anual: «1,67 al mes · ahorra 44 %» calculado con los precios reales (${deal})`);
    check(await A.page.getAttribute('[data-testid=premium-product-yearly]', 'data-featured') === 'true', 'anual con el estilo destacado');
    const founder = nb(await A.page.textContent('[data-testid=premium-product-founder]'));
    check(founder.includes('49,99') && founder.includes('Pago único · para siempre mientras exista Escaque') && founder.includes('Queda 1 plaza de 1'), `Fundador: 49,99, «para siempre mientras exista Escaque» y plazas reales (${founder})`);
    check(!/Más elegido|tachad/i.test(nb(await A.page.textContent('[data-testid=premium-prices]'))), 'sin reclamos sin respaldo («Más elegido») ni precios tachados');
    const refund = nb(await A.page.textContent('[data-testid=premium-refund-note]'));
    check(refund.includes('14 días') && await A.page.locator('[data-testid=premium-refund-note] a[href="/terminos.html#reembolsos"]').count() === 1
      && await A.page.locator('[data-testid=premium-refund-note] a[href="/privacidad.html"]').count() === 1, 'junto a la compra: reembolso de 14 días y enlaces a Términos (reembolsos) y Privacidad');
    check(await noHScroll(A.page), 'pantalla Premium sin desplazamiento horizontal');
    await shot(A.page, 'premium-es-claro');
    // Se espera a la navegación que provoca el clic (antes, waitForURL podía darse por cumplido con
    // la URL de partida y la comprobación siguiente caía en plena navegación).
    await Promise.all([A.page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }), A.page.click('[data-testid=premium-buy-monthly]')]);
    await A.page.waitForSelector('[data-testid=account-section][data-status=signedIn]');
    check(await isolated(A.page), 'tras volver del pago: crossOriginIsolated');
    check((await sendWebhook(subscription('subscription.created', me.user.id))) === 202, 'webhook firmado aceptado (202)');
    check((await sendWebhook({ ...subscription('subscription.active', me.user.id) })) === 202, 'segundo webhook aceptado');
    const forged = await fetch(`${BASE}api/webhooks/polar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'webhook-id': 'x', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' }, body: '{}' });
    check(forged.status === 403, 'webhook con firma falsa rechazado (403)');
    await A.page.waitForSelector('[data-testid=account-section][data-plan=monthly]', { timeout: 40000 });
    check(true, 'Premium activo tras el webhook');
    await A.page.waitForSelector('[data-testid=premium-current][data-plan=monthly]');
    check(nb(await A.page.textContent('[data-testid=premium-buy-monthly]')) === 'Ya lo tienes'
      && nb(await A.page.textContent('[data-testid=premium-buy-yearly]')) === 'Ya tienes Premium'
      && await A.page.isDisabled('[data-testid=premium-buy-yearly]'), 'con el mensual: «Ya lo tienes» en Mensual y «Ya tienes Premium» en Anual');
    await A.page.waitForSelector('[data-testid=account-sync-state][data-state=idle]', { timeout: 30000 });
    check(true, 'primera sincronización completada');
    await shot(A.page, 'premium-activo');
    await A.page.click('[data-testid=premium-close]');

    // Premium: Progreso completo y temas extra.
    await nav(A.page, 'progress');
    check(await A.page.locator('[data-testid=progress-premium-notice]').count() === 0, 'Premium: sin aviso en Progreso');
    check(!(await A.page.$eval('[data-testid=progress-filter-period] option[value=all]', (o) => o.disabled)), 'Premium: «Todo» disponible');
    await nav(A.page, 'practice');
    await A.page.click('[data-testid=board-theme]');
    await A.page.click('[data-testid=board-theme]');
    check((await A.page.getAttribute('[data-board-theme]', 'data-board-theme')) === 'azul', 'Premium: tema de tablero extra (azul)');
    await A.page.evaluate(() => fetch('/api/me')); // mantener vivo
    await menu(A.page);
    await A.page.click('[data-testid=open-premium]');
    await A.page.click('[data-testid=sync-now]');
    await A.page.waitForSelector('[data-testid=premium-sync][data-state=idle]');
    await A.page.waitForTimeout(500);
    await A.page.click('[data-testid=premium-close]');

    // ── 4. Dispositivo B (otro navegador, inglés, oscuro, móvil): misma cuenta → recibe todo ──
    const B = await open('B', { locale: 'en-US', viewport: { width: 390, height: 844 }, scheme: 'dark' });
    await menu(B.page);
    check(/I am 16 or older and I accept the Terms and the Privacy policy/.test(nb(await B.page.textContent('[data-testid=account-section]'))), 'B: casilla de consentimiento en inglés');
    await B.page.check('[data-testid=login-consent]');
    await B.page.click('[data-testid=login-test]');
    await B.page.waitForSelector('[data-testid=account-section][data-plan=monthly]', { timeout: 20000 });
    await B.page.waitForSelector('[data-testid=account-sync-state][data-state=idle]', { timeout: 30000 });
    check(await isolated(B.page), 'B: crossOriginIsolated tras el login');
    check((await idb(B.page, 'count', 'games')) === 3, 'B recibe las 3 partidas de A');
    check((await B.page.evaluate(() => localStorage.getItem('escaque:board'))) === 'azul', 'B recibe el tema del tablero');
    await B.page.reload();
    await B.page.waitForSelector('[data-testid=account-section][data-status=signedIn]');
    await nav(B.page, 'games');
    await B.page.waitForFunction(() => document.querySelector('[data-testid=games-count]')?.textContent.includes('3'));
    check(true, 'B ve las partidas en «My games»');
    await menu(B.page);
    await B.page.click('[data-testid=open-premium]');
    await B.page.waitForSelector('[data-testid=premium-current]');
    check(await noHScroll(B.page), 'B (390 px, oscuro, inglés): Premium sin desplazamiento horizontal');
    check((await B.page.textContent('[data-testid=premium-screen]')).includes('Your plan'), 'B: pantalla Premium en inglés');
    check(await B.page.locator('[data-testid=premium-prices]').count() === 1 && /\$1\.67 per month · save 44%/.test(nb(await B.page.textContent('[data-testid=premium-yearly-deal]'))), 'B: «$1.67 per month · save 44%» en inglés');
    check(await B.page.evaluate(() => document.documentElement.classList.contains('dark')), 'B: tema oscuro');
    await shot(B.page, 'premium-en-oscuro-390');
    await B.page.click('[data-testid=premium-close]');

    // B añade una partida (como haría la app: escritura con registro de cambios) → llega a A.
    await B.page.evaluate(async (g) => {
      const db = await new Promise((res) => { const r = indexedDB.open('escaque'); r.onsuccess = () => res(r.result); });
      await new Promise((res) => {
        const t = db.transaction(['games', 'changes'], 'readwrite');
        t.objectStore('games').put(g);
        t.objectStore('changes').put({ id: `games\u001f${g.id}`, store: 'games', key: g.id, updatedAt: Date.now(), deleted: false, dirty: 1 });
        t.oncomplete = res;
      });
      db.close();
    }, PGN_GAME(4));
    await menu(B.page);
    await B.page.click('[data-testid=open-premium]');
    await B.page.click('[data-testid=sync-now]');
    await B.page.waitForSelector('[data-testid=premium-sync][data-state=idle]');
    await B.page.waitForTimeout(500);
    await A.page.click('[data-testid=sync-now]').catch(async () => {
      await menu(A.page);
      await A.page.click('[data-testid=open-premium]');
      await A.page.click('[data-testid=sync-now]');
    });
    await A.page.waitForFunction(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('escaque'); r.onsuccess = () => res(r.result); });
      const n = await new Promise((res) => { const q = db.transaction('games').objectStore('games').count(); q.onsuccess = () => res(q.result); });
      db.close();
      return n === 4;
    }, null, { timeout: 20000, polling: 500 });
    check(true, 'la partida nueva de B llega a A');

    // ── 4b. Términos de una versión vieja: se pide aceptar antes de seguir ────────────────────
    if (server) {
      server.sql("UPDATE users SET terms_version = '0.9'");
      await B.page.keyboard.press('Escape');
      await B.page.reload();
      await B.page.waitForSelector('[data-testid=consent-dialog]', { timeout: 20000 });
      check(true, 'B: con términos viejos aparece el aviso para aceptar los vigentes');
      check(await B.page.isDisabled('[data-testid=consent-accept]'), 'B: «Accept and continue» deshabilitado sin marcar la casilla');
      expectedHttp.push('B:403');
      const blocked = await B.page.evaluate(() => fetch('/api/sync/pull?cursor=0').then((r) => r.status));
      check(blocked === 403, `B: sin aceptar, el servidor no sincroniza (${blocked})`);
      await B.page.check('[data-testid=consent-dialog-checkbox]');
      await B.page.click('[data-testid=consent-accept]');
      await B.page.waitForSelector('[data-testid=consent-dialog]', { state: 'detached', timeout: 10000 });
      const meB = await B.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
      check(meB.consent?.accepted === TERMS_VERSION && meB.consent?.required === false, 'B: aceptación registrada; vuelve la sincronización');
      await B.page.waitForSelector('[data-testid=account-sync-state][data-state=idle]', { timeout: 30000 });
      await A.page.reload();
      await A.page.waitForSelector('[data-testid=account-section][data-status=signedIn]');
      check(await A.page.locator('[data-testid=consent-dialog]').count() === 0, 'A (misma cuenta): ya no se le pide aceptar');
    }

    // ── 5. Cerrar sesión en A: vuelve el plan gratuito (los datos locales se quedan) ─────────
    await A.page.keyboard.press('Escape');
    await menu(A.page);
    await A.page.click('[data-testid=account-logout]');
    await A.page.waitForSelector('[data-testid=account-section][data-status=anonymous][data-plan=free]');
    check((await idb(A.page, 'count', 'games')) === 4, 'tras cerrar sesión los datos locales siguen');
    await A.page.keyboard.press('Escape');
    await nav(A.page, 'progress');
    await A.page.waitForSelector('[data-testid=progress-premium-notice]');
    check(true, 'tras cerrar sesión vuelven los límites gratuitos');
    await nav(A.page, 'practice');
    check((await A.page.getAttribute('[data-board-theme]', 'data-board-theme')) === 'madera', 'tema Premium guardado se muestra como madera');
    const meAfter = await A.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    check(meAfter.user === null, '/api/me sin usuario tras cerrar sesión');

    // ── 6. Diseño: 1004×508 claro con el menú y la pantalla Premium ──────────────────────────
    await A.page.setViewportSize({ width: 1004, height: 508 });
    await menu(A.page);
    const menuFits = await A.page.$eval('[data-testid=side-menu]', (n) => n.scrollHeight >= n.clientHeight && getComputedStyle(n).overflowY === 'auto');
    check(menuFits, '1004×508: el menú desplaza si no cabe');
    await A.page.waitForTimeout(400);
    await shot(A.page, 'menu-1004x508');
    await A.page.click('[data-testid=open-premium]');
    await A.page.waitForSelector('[data-testid=premium-screen]');
    check(await noHScroll(A.page), '1004×508: Premium sin desplazamiento horizontal');
    check(await A.page.locator('[data-testid=premium-login-test]').count() === 1, 'sin sesión, Premium ofrece iniciar sesión para comprar');
    await shot(A.page, 'premium-1004x508-sin-sesion');

    // ── 7. Fundador agotado (FOUNDER_LIMIT=1) y borrar la cuenta desde el menú ──────────────
    if (server) {
      const C = await open('C');
      await C.page.goto(`${BASE}api/auth/login/test?hint=carol&consent=${TERMS_VERSION}&return=/`);
      await C.page.waitForSelector('[data-testid=account-section][data-status=signedIn]', { timeout: 20000 });
      const meC = await C.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
      check((await sendWebhook(founderOrder(meC.user.id))) === 202, 'C compra Fundador (webhook order.paid)');
      await C.page.reload();
      await C.page.waitForSelector('[data-testid=account-section][data-plan=founder]', { timeout: 20000 });
      check(true, 'C: plan Fundador activo');
      const D = await open('D', { viewport: { width: 390, height: 844 } });
      await D.page.goto(`${BASE}api/auth/login/test?hint=dave&consent=${TERMS_VERSION}&return=/`);
      await D.page.waitForSelector('[data-testid=account-section][data-status=signedIn]', { timeout: 20000 });
      await menu(D.page);
      await D.page.click('[data-testid=open-premium]');
      await D.page.waitForSelector('[data-testid=premium-founder-slots][data-remaining="0"]', { timeout: 20000 });
      check(nb(await D.page.textContent('[data-testid=premium-founder-slots]')) === 'Agotado', 'D: Fundador «Agotado» con las plazas reales');
      check(await D.page.isDisabled('[data-testid=premium-buy-founder]') && nb(await D.page.textContent('[data-testid=premium-buy-founder]')) === 'Agotado', 'D: botón de Fundador deshabilitado');
      check(await D.page.isEnabled('[data-testid=premium-buy-yearly]'), 'D: las suscripciones siguen a la venta');
      const meD = await D.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
      expectedHttp.push('D:409');
      const soldOut = await D.page.evaluate((csrf) => fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ plan: 'founder' }) })
        .then(async (r) => `${r.status} ${(await r.json()).error?.kind}`), meD.csrf);
      check(soldOut === '409 founder_sold_out', `D: el servidor bloquea la compra de Fundador (${soldOut})`);
      check(await noHScroll(D.page), 'D (390 px): Premium sin desplazamiento horizontal');
      await shot(D.page, 'premium-fundador-agotado-390');
      await D.page.click('[data-testid=premium-close]');
      // Borrar la cuenta desde el menú (el diálogo de confirmación se acepta solo).
      const dialogs = [];
      D.page.on('dialog', (d) => dialogs.push(d.message()));
      await menu(D.page);
      await D.page.click('[data-testid=account-delete-menu]');
      await D.page.waitForSelector('[data-testid=account-section][data-status=anonymous]', { timeout: 10000 });
      check(dialogs.some((m) => /datos sincronizados/.test(m) && /NO se borran/.test(m)), 'borrar cuenta: la confirmación dice que borra el servidor y no el navegador');
      check((await D.page.getAttribute('[data-testid=account-notice]', 'data-key')) === 'account.deleted', 'aviso «Cuenta borrada»');
      check((await D.page.evaluate(() => fetch('/api/me').then((r) => r.json()))).user === null, '/api/me sin usuario tras borrar la cuenta');
      await D.page.goto(`${BASE}api/auth/login/test?hint=dave&return=/`);
      await D.page.waitForSelector('[data-testid=account-section][data-status=anonymous]', { timeout: 20000 });
      check((await D.page.getAttribute('[data-testid=account-notice]', 'data-key')) === 'account.result.consentRequired', 'tras borrarla, volver a entrar exige el consentimiento otra vez');
    }

    const fromSw = apiResponses.filter((r) => r.sw);
    check(apiResponses.length > 0 && fromSw.length === 0, `${apiResponses.length} respuestas de /api (me, sync, billing, auth), ninguna del service worker${fromSw.length ? `: ${fromSw.slice(0, 3).map((r) => r.url).join(', ')}` : ''}`);
    check(errors.length === 0, `0 errores de consola${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close();
    server?.stop();
  }
  console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})();
