// Sembrado solo para pruebas: Progreso con datos deterministas, sin consultas externas.
// npm run build && npm run preview -- --port 4183
// node scripts/e2e-progress.cjs http://localhost:4183/
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
// Estas pruebas cubren las funciones completas: se simula un plan Premium guardado (src/premium/planStore.js),
// que la app respeta sin servidor de cuentas. Los límites del plan gratuito se prueban en e2e-accounts.cjs.
const PREMIUM_SEED = () => localStorage.setItem('escaque:account', JSON.stringify({
  user: { id: 'e2e', email: null, name: 'e2e', provider: 'test' }, plan: { premium: true, plan: 'founder', lifetime: true, periodEnd: null }, checkedAt: Date.now(),
}));

(async () => {
  const browser = await chromium.launch();
  try {
    for (const locale of ['es-ES', 'en-US']) {
      const page = await browser.newPage({ locale, viewport: { width: 1004, height: 508 } });
      await skipWelcome(page);
      await page.addInitScript(PREMIUM_SEED);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const go = async () => {
        await page.mouse.move(600, 300);
        await page.click('[data-testid=menu-toggle]');
        await page.click('[data-testid=nav-progress]');
        await page.waitForSelector('[data-testid=progress-screen]');
        assert.ok(!(await page.locator('header').innerText()).includes('header.progress'));
      };
      await page.goto(process.argv[2] || 'http://localhost:4183/');
      await go();
      await page.waitForSelector('[data-testid=progress-empty]');
      assert.equal(await page.locator('[data-testid=progress-play]').count(), 1);
      assert.equal(await page.locator('[data-testid=progress-import]').count(), 1);
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('escaque'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        const tx = db.transaction(['games', 'moves'], 'readwrite');
        const game = { id: 'escaque:progress-test', source: 'escaque', externalId: 'progress-test', white: 'Tester', black: 'Rival', whiteElo: null, blackElo: 1500, result: '0-1', endTime: Date.now(), importedAt: Date.now(), playerName: 'Tester', playerColor: 'w', timeControl: '600+0', speed: 'rapid', rated: false, variant: 'standard', opening: 'Test opening', eco: 'C20', pgn: '[Result "0-1"]\n\n1. e4 {[%clk 0:00:30]} e5 2. Nf3 Nc6 0-1' };
        tx.objectStore('games').put(game);
        tx.objectStore('games').put({ ...game, id: 'lichess:progress-test', source: 'lichess', speed: 'blitz', whiteElo: 1400, opening: 'Second test opening', eco: 'D00', result: '1-0', endTime: Date.now() - 100 * 86400000 });
        tx.objectStore('moves').put({ gameId: game.id, moves: [
          { ply: 1, color: 'w', san: 'e4', uci: 'e2e4', label: 'Blunder', phase: 'apertura', motif: 'ataque_doble', evalBefore: { type: 'cp', value: 600 }, evalAfter: { type: 'cp', value: -300 }, winBefore: 90, winAfter: 25, loss: 65 },
          { ply: 3, color: 'w', san: 'Nf3', uci: 'g1f3', label: 'Mistake', phase: 'apertura', motif: 'captura', evalBefore: { type: 'cp', value: 20 }, evalAfter: { type: 'cp', value: -200 }, winBefore: 52, winAfter: 32, loss: 20 },
        ] });
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
      });
      await page.reload(); await go();
      await page.waitForSelector('[data-testid=progress-coverage]');
      for (const id of ['results', 'elo', 'accuracy', 'phases', 'weaknesses', 'openings', 'conversion', 'time-trouble']) assert.equal(await page.locator(`[data-testid=progress-${id}]`).count(), 1);
      assert.equal((await page.textContent('[data-testid=progress-wins]')).trim(), '1');
      assert.equal((await page.textContent('[data-testid=progress-losses]')).trim(), '1');
      assert.equal(await page.locator('[data-testid=progress-weakness-0]').count(), 1);
      assert.equal(await page.locator('[data-testid=progress-analyze]').count(), 1);
      assert.equal(await page.locator('[data-testid=progress-elo-chart]').count(), 1);
      assert.equal(await page.locator('[data-testid=progress-opening-best]').count(), 1);
      assert.equal(await page.locator('[data-testid=progress-opening-worst]').count(), 1);
      assert.ok(!/progress\./.test(await page.textContent('[data-testid=progress-screen]')));
      await page.selectOption('[data-testid=progress-filter-source]', 'escaque');
      await page.waitForFunction(() => document.querySelector('[data-testid=progress-wins]')?.textContent.trim() === '0');
      await page.selectOption('[data-testid=progress-filter-source]', 'all');
      await page.selectOption('[data-testid=progress-filter-period]', '30');
      await page.waitForFunction(() => document.querySelector('[data-testid=progress-wins]')?.textContent.trim() === '0');
      await page.selectOption('[data-testid=progress-filter-period]', 'all');
      await page.selectOption('[data-testid=progress-filter-speed]', 'bullet');
      await page.waitForSelector('[data-testid=progress-filter-empty]');
      await page.selectOption('[data-testid=progress-filter-speed]', 'all');
      for (const width of [1004, 390]) {
        await page.setViewportSize({ width, height: 508 });
        for (const dark of [false, true]) {
          await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (locale === 'es-ES' && !dark) await page.screenshot({ path: width === 1004 ? '/workspace/progress-desktop.png' : '/workspace/progress-mobile.png', fullPage: true });
        }
      }
      assert.deepEqual(errors, []);
      console.log(`OK ${locale}: vacío, tarjetas, métricas, WDL/Elo, filtros, análisis y tamaños/claro/oscuro`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
