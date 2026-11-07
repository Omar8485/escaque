// npm run build && npx vite preview --port 4626
// node scripts/e2e-puzzle-promotion.cjs http://localhost:4626/
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const base = process.argv[2] || 'http://localhost:4626/';

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [locale, color, viewport, dark] of [
      ['es-ES', 'w', { width: 1004, height: 508 }, false],
      ['en-US', 'b', { width: 390, height: 844 }, true],
    ]) {
      const context = await browser.newContext({ locale, viewport });
      await skipWelcome(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(base);
      await page.mouse.move(200, 150);
      await page.getByText(/^(Listo|Ready)$/, { exact: true }).first().waitFor({ timeout: 60000 });
      await page.evaluate(async ({ color, dark }) => {
        localStorage.removeItem('escaque:puzzles');
        document.documentElement.classList.toggle('dark', dark);
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('escaque');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['games', 'puzzles'], 'readwrite');
          tx.objectStore('games').put({ id: 'pgn:promotion', endTime: Date.now(), source: 'pgn', playerColor: color });
          tx.objectStore('puzzles').put({
            id: 'promotion', gameId: 'pgn:promotion', color, rating: 1200,
            fen: color === 'w' ? '7k/P7/8/8/8/8/8/7K w - - 0 1' : '7k/8/8/8/8/8/p7/7K b - - 0 1',
            solution: [color === 'w' ? 'a7a8n' : 'a2a1n'], type: 'oportunidad',
            motif: null, phase: 'final', moveNumber: 1, played: 'a8=Q', opponent: 'Rival', date: '2026-11-02',
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, { color, dark });
      await page.click('[data-testid=menu-toggle]');
      await page.click('[data-testid=nav-puzzles]');
      await page.waitForSelector('[data-testid=puzzle-trainer]');
      const from = color === 'w' ? 'a7' : 'a2';
      const to = color === 'w' ? 'a8' : 'a1';
      const startPromotion = async () => {
        await page.click(`[data-square="${from}"]`);
        await page.click(`[data-square="${to}"]`);
        await page.waitForSelector('[data-testid=promotion-picker]');
        assert.equal(await page.locator(`[data-square="${from}"] [data-piece]`).getAttribute('data-piece'), color + 'p');
      };
      await startPromotion();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-testid=promotion-picker]').count(), 0);
      await startPromotion();
      await page.locator('[data-testid=promotion-backdrop]').click({ position: { x: 5, y: 5 } });
      assert.equal(await page.locator('[data-testid=promotion-picker]').count(), 0);
      await startPromotion();
      await page.click('[data-testid=promote-q]');
      await page.waitForFunction(() => document.querySelector('[data-testid=puzzle-message]').dataset.tone === 'alerta');
      assert.equal(await page.locator('[data-testid=puzzle-rating]').innerText(), '1188');
      await page.click('[data-testid=puzzle-retry]');
      await startPromotion();
      await page.click('[data-testid=promote-n]');
      await page.waitForSelector('[data-testid=puzzle-trainer][data-status=solved]');
      assert.equal(await page.locator(`[data-square="${to}"] [data-piece]`).getAttribute('data-piece'), color + 'n');
      assert.equal(await page.locator('[data-testid=puzzle-rating]').innerText(), '1188');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      console.log(`OK ${locale} ${color} ${viewport.width}x${viewport.height}: cancelación, pieza incorrecta, subcoronación, Elo y disposición`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exitCode = 1; });
