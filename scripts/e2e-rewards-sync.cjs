// Integración v1.3 — prueba de punta a punta de recompensas sin conexión y sincronización Premium.
// Contra `wrangler dev` (build de producción, service worker real) en MODO DE PRUEBA (AUTH_TEST_MODE=1,
// Polar simulado, D1 local temporal), como scripts/e2e-accounts.cjs.
//
// Uso: npm run build && node scripts/e2e-rewards-sync.cjs     (arranca su wrangler dev en :4742)
//      o: node scripts/e2e-rewards-sync.cjs --base http://localhost:4742/   si ya está corriendo.
//
// Recorre: A inicia sesión y pasa a Premium (webhook firmado) → sin red, recarga (la sirve el SW,
// Stockfish «Listo») → partida real contra Ícaro (2 jugadas y abandonar) → XP y racha suben sin
// red → vuelve la red: se reanuda la sesión y se suben las recompensas → B (otro navegador, inglés)
// inicia sesión y recibe XP, racha y partida SIN pisar nada con su estado vacío → A sigue igual.
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
const PORT = 4742;
const BASE = EXTERNAL || `http://localhost:${PORT}/`;
const WEBHOOK_SECRET = 'whsec_AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY';
// Partida terminada contra el nivel 1: base 30 + 3 × nivel = 33; +15 si todas tus jugadas quedan
// clasificadas sin errores graves (e4 y Nf3 lo están en cuanto Stockfish termina, también sin red).
const BASE_XP = 33;
const QUALITY_XP = 15;

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

async function startWrangler() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'escaque-e2e-rs-'));
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'escaque', '--local', '--persist-to', state], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, CI: '1' } });
  const vars = {
    AUTH_TEST_MODE: '1', POLAR_SERVER: 'mock', POLAR_PRODUCT_MONTHLY: 'mock-monthly', POLAR_PRODUCT_YEARLY: 'mock-yearly',
    POLAR_PRODUCT_FOUNDER: 'mock-founder', SESSION_SECRET: 'e2e-session-secret-0123456789abcdefghijklmnop', POLAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state,
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: ROOT, env: { ...process.env, CI: '1' }, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}api/health`);
      if (r.ok) return { stop: () => { try { process.kill(-proc.pid); } catch { /* ya terminó */ } fs.rmSync(state, { recursive: true, force: true }); } };
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev no arrancó');
}

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

const subscription = (userId) => ({
  type: 'subscription.active',
  timestamp: new Date().toISOString(),
  data: {
    id: 'sub_rs', status: 'active', product_id: 'mock-monthly', customer_id: 'cus_rs', cancel_at_period_end: false,
    current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), modified_at: new Date().toISOString(),
    customer: { id: 'cus_rs', external_id: userId }, metadata: {},
  },
});

/** Lee de IndexedDB (sin pasar por la app). */
const idb = (page, store, key) => page.evaluate(async ([s, k]) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('escaque'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const req = k == null ? db.transaction(s).objectStore(s).getAll() : db.transaction(s).objectStore(s).get(k);
  const out = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  db.close();
  return out;
}, [store, key ?? null]);
/**
 * Recompensas tal como las ve la app: repartidas en `rewards` (resumen) y `rewards:day:*`
 * (src/rewards/store.js). Une premios (sin duplicar) y días, como joinRewards().
 */
const isRewardKey = (k) => k === 'rewards' || String(k).startsWith('rewards:day:');
const rewardsOf = async (page) => {
  const recs = (await idb(page, 'meta')).filter((r) => isRewardKey(r.key));
  if (!recs.length) return null;
  const awards = {};
  const days = {};
  let extra = 0;
  for (const { key, value } of recs) {
    Object.assign(awards, value?.xp?.awards);
    if (key === 'rewards') extra = Math.max(0, (value?.xp?.xp ?? 0) - Object.values(value?.xp?.awards ?? {}).reduce((n, a) => n + a.amount, 0));
    for (const [d, day] of Object.entries(value?.daily?.days ?? {})) days[d] = { games: [...new Set([...(days[d]?.games ?? []), ...(day.games ?? [])])] };
  }
  return { xp: { xp: Object.values(awards).reduce((n, a) => n + a.amount, 0) + extra, awards }, daily: { days } };
};
/** Estado de subida de los registros de recompensas: 'pendiente' si alguno está sin subir. */
const rewardsDirty = async (page) => (await idb(page, 'changes')).filter((c) => c.store === 'meta' && isRewardKey(c.key)).some((c) => c.dirty === 1);
const localDay = (page) => page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

(async () => {
  const server = EXTERNAL ? null : await startWrangler();
  const browser = await chromium.launch();
  const errors = [];
  const contexts = [];
  try {
    const open = async (label, locale) => {
      const context = await browser.newContext({ locale, viewport: { width: 1280, height: 800 } });
      contexts.push(context);
      await skipWelcome(context);
      // Sin interrupciones de Alfred: el rival de nivel 1 es aleatorio y podría convertir una jugada en error.
      await context.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
      page.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text()) && errors.push(`${label}: ${m.text()}`));
      page.on('dialog', (d) => d.accept());
      await page.goto(BASE);
      await page.mouse.move(640, 400);
      return { context, page };
    };
    const ready = (page, text) => page.getByText(text, { exact: true }).first().waitFor({ timeout: 90000 });
    const menu = async (page) => {
      if ((await page.getAttribute('[data-testid=side-menu]', 'data-open')) !== 'true') await page.click('[data-testid=menu-toggle]');
    };
    const login = async (page) => {
      await menu(page);
      await page.check('[data-testid=login-consent]'); // casilla obligatoria (16+ y términos)
      await page.click('[data-testid=login-test]');
      await page.waitForSelector('[data-testid=account-section][data-status=signedIn]', { timeout: 30000 });
      await page.mouse.move(640, 400);
    };

    // ── 1. A: SW activo, sesión y Premium ───────────────────────────────────────────────
    const A = await open('A', 'es-ES');
    await ready(A.page, 'Listo');
    const controlled = await A.page.waitForFunction(async () => {
      if (!navigator.serviceWorker?.controller) return false;
      const names = await caches.keys();
      const engine = names.find((n) => n.startsWith('escaque-engine-'));
      return Boolean(engine && (await (await caches.open(engine)).match('/stockfish/stockfish.wasm')));
    }, null, { timeout: 180000, polling: 500 }).then(() => true, () => false);
    check(controlled, 'A: service worker controlando y motor en caché');
    await login(A.page);
    const me = await A.page.evaluate(() => fetch('/api/me').then((r) => r.json()));
    check((await sendWebhook(subscription(me.user.id))) === 202, 'webhook de suscripción aceptado');
    await A.page.reload();
    await A.page.waitForSelector('[data-testid=account-section][data-plan=monthly]', { timeout: 30000 });
    await A.page.waitForSelector('[data-testid=account-sync-state][data-state=idle]', { timeout: 30000 });
    check(true, 'A: Premium activo y primera sincronización');
    check(((await rewardsOf(A.page))?.xp?.xp ?? 0) === 0, 'A: empieza con 0 XP');

    // ── 2. Sin red: la app se recarga desde el SW y se juega una partida ─────────────────────
    await A.context.setOffline(true);
    await A.page.reload();
    await ready(A.page, 'Listo');
    check(await A.page.evaluate(() => crossOriginIsolated && Boolean(navigator.serviceWorker.controller)), 'sin red: recarga servida por el SW, aislada y con Stockfish «Listo»');
    await A.page.waitForSelector('[data-testid=account-section][data-status=signedIn][data-plan=monthly]', { timeout: 20000 });
    check(true, 'sin red: sesión Premium desde la caché del plan');
    await A.page.mouse.move(640, 400);
    await A.page.click('[data-testid=level-1]');
    await A.page.click('[data-testid=color-w]');
    await A.page.click('[data-testid=start-game]');
    const turn = () => A.page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });
    const move = async (from, to) => {
      await A.page.click(`[data-square="${from}"]`);
      await A.page.click(`[data-square="${to}"]`);
    };
    const snapshot = () => A.page.$$eval('[data-piece]', (els) => els.map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join());
    // Juega una jugada y espera la respuesta del rival (el tablero cambia otra vez) y tu turno.
    const playAndWait = async (from, to) => {
      await move(from, to);
      await A.page.waitForFunction((f) => !document.querySelector(`[data-square="${f}"] [data-piece]`), from, { timeout: 10000 });
      const mine = await snapshot();
      await A.page.waitForFunction((pos) => [...document.querySelectorAll('[data-piece]')]
        .map((e) => e.closest('[data-square]').dataset.square + e.dataset.piece).sort().join() !== pos, mine, { timeout: 60000 });
      await turn();
    };
    await turn();
    await playAndWait('e2', 'e4');
    await playAndWait('g1', 'f3');
    await A.page.click('[data-testid=abandon]');
    // Se espera a que la XP se asiente (el bonus de calidad llega cuando terminan las clasificaciones).
    let offlineRewards = null;
    for (let i = 0, last = -1, same = 0; i < 60 && same < 4; i++) {
      await A.page.waitForTimeout(500);
      offlineRewards = await rewardsOf(A.page);
      const xp = offlineRewards?.xp?.xp ?? 0;
      same = xp > 0 && xp === last ? same + 1 : 0;
      last = xp;
    }
    const EXPECTED_XP = offlineRewards?.xp?.xp;
    const today = await localDay(A.page);
    const keys = Object.keys(offlineRewards?.xp?.awards ?? {});
    check([BASE_XP, BASE_XP + QUALITY_XP].includes(EXPECTED_XP) && keys.some((k) => k.endsWith(':base')) && !keys.some((k) => k.endsWith(':win')),
      `sin red: XP tras la partida = ${EXPECTED_XP} (${keys.map((k) => k.split(':').pop()).join(' + ')}; sin victoria)`);
    const headerA = await A.page.waitForFunction((xp) => document.querySelector('[data-testid=rewards-xp]')?.textContent.includes(String(xp)), EXPECTED_XP, { timeout: 10000 }).then(() => true, () => false);
    check(headerA, 'sin red: la cabecera muestra la XP');
    check(offlineRewards?.daily?.days?.[today]?.games?.length === 1, `sin red: el día local ${today} cuenta la partida para la racha y la meta`);
    await A.page.click('[data-testid=rewards-header]');
    await A.page.waitForSelector('[data-testid=rewards-panel] [data-testid=rewards-daily-streak]');
    const streakA = await A.page.textContent('[data-testid=rewards-panel] [data-testid=rewards-daily-streak]');
    check(/\b1\b/.test(streakA), `sin red: racha actual = «${streakA.trim()}»`);
    await A.page.click('[data-testid=rewards-close]');
    check(await rewardsDirty(A.page), 'sin red: las recompensas quedan pendientes de subir');

    // ── 3. Vuelve la red: se reanuda la sesión y se sube ─────────────────────────────────
    await A.context.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    let uploaded = false;
    for (let i = 0; i < 120 && !uploaded; i++) {
      await A.page.waitForTimeout(500);
      uploaded = !(await rewardsDirty(A.page));
    }
    check(uploaded, 'con red: la sesión se reanuda sola y las recompensas se suben');

    // ── 4. B: otro navegador (inglés) inicia sesión y recibe todo ────────────────────────
    const B = await open('B', 'en-US');
    await ready(B.page, 'Ready');
    check(((await rewardsOf(B.page))?.xp?.xp ?? 0) === 0, 'B: navegador nuevo con 0 XP antes de iniciar sesión');
    await login(B.page);
    await B.page.waitForSelector('[data-testid=account-section][data-plan=monthly]', { timeout: 30000 });
    let synced = false;
    for (let i = 0; i < 120 && !synced; i++) {
      await B.page.waitForTimeout(500);
      synced = (await rewardsOf(B.page))?.xp?.xp === EXPECTED_XP;
    }
    check(synced, `B recibe las recompensas de A (${EXPECTED_XP} XP)`);
    const headerB = await B.page.waitForFunction((xp) => document.querySelector('[data-testid=rewards-xp]')?.textContent.includes(String(xp)), EXPECTED_XP, { timeout: 15000 }).then(() => true, () => false);
    check(headerB, 'B: la cabecera se actualiza sin recargar');
    const gamesB = await idb(B.page, 'games');
    check(gamesB.some((g) => g.source === 'escaque'), 'B recibe la partida jugada sin red');
    await B.page.click('[data-testid=rewards-header]');
    const streakB = await B.page.textContent('[data-testid=rewards-panel] [data-testid=rewards-daily-streak]');
    check(/\b1\b/.test(streakB), `B: racha = «${streakB.trim()}» (inglés)`);
    await B.page.click('[data-testid=rewards-close]');

    // ── 5. A vuelve a sincronizar: el estado vacío de B no pisó nada ───────────────────────
    await B.page.waitForSelector('[data-testid=account-sync-state][data-state=idle]', { timeout: 30000 });
    await menu(A.page);
    await A.page.click('[data-testid=open-premium]');
    await A.page.click('[data-testid=sync-now]');
    await A.page.waitForSelector('[data-testid=premium-sync][data-state=idle]', { timeout: 30000 });
    await A.page.waitForTimeout(500);
    check((await rewardsOf(A.page))?.xp?.xp === EXPECTED_XP, 'A conserva su XP tras sincronizar con B');
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
