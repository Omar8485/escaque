// Sembrado solo de prueba: repaso sin generación ni peticiones externas.
// npm run build && npx vite preview --port 4185
// node scripts/e2e-review.cjs http://localhost:4185/
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

(async () => {
  const browser = await chromium.launch();
  try {
    for (const locale of ['es-ES', 'en-US']) {
      const page = await browser.newPage({ locale, viewport: { width: 1004, height: 508 } });
      await skipWelcome(page);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(process.argv[2] || 'http://localhost:4185/');
      await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open('escaque');
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const tx = db.transaction(['games', 'puzzles'], 'readwrite');
        tx.objectStore('games').put({ id: 'test:review', white: 'Tester', black: 'Rival', result: '1-0', endTime: Date.now(), variant: 'standard', playerColor: 'w' });
        const p = { id: 'review-a', gameId: 'test:review', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'], color: 'w', type: 'oportunidad', motif: 'mate', phase: 'apertura', moveNumber: 4, played: 'Bc4', opponent: 'Rival', date: '2026.01.01', rating: 1200 };
        tx.objectStore('puzzles').put(p);
        tx.objectStore('puzzles').put({ ...p, id: 'review-future' });
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        db.close();
        localStorage.setItem('escaque:puzzles', JSON.stringify({ rating: 1188, streak: 0, best: 2, results: { 'review-a': { result: 'failed', date: '2020-01-01' } }, reviews: { 'review-future': { box: 1, dueAt: Date.now() + 86400000 } } }));
      });
      await page.reload();
      const go = async () => {
        await page.mouse.move(600, 300);
        await page.click('[data-testid=menu-toggle]');
        await page.click('[data-testid=nav-puzzles]');
        await page.waitForSelector('[data-testid=puzzle-review-start]');
      };
      await go();
      assert.match(await page.textContent('[data-testid=puzzle-review-count]'), /1/);
      await page.click('[data-testid=puzzle-review-start]');
      await page.click('[data-square=h5]');
      await page.click('[data-square=f7]');
      await page.waitForSelector('[data-testid=puzzle-trainer][data-status=solved]');
      const success = await page.evaluate(() => JSON.parse(localStorage.getItem('escaque:puzzles')));
      assert.equal(success.rating, 1188);
      assert.equal(success.reviews['review-a'].box, 1);
      assert.ok(success.reviews['review-a'].dueAt > Date.now() + 2 * 86400000);
      assert.equal(success.results['review-a'].result, 'failed');
      await page.click('[data-testid=puzzle-next]');
      await page.waitForSelector('[data-testid=puzzle-review-complete]');
      await page.reload();
      await go();
      assert.match(await page.textContent('[data-testid=puzzle-review-count]'), /0/);
      assert.equal(await page.isDisabled('[data-testid=puzzle-review-start]'), true);
      await page.evaluate(() => {
        const p = JSON.parse(localStorage.getItem('escaque:puzzles'));
        p.reviews['review-a'] = { box: 4, dueAt: 1 };
        localStorage.setItem('escaque:puzzles', JSON.stringify(p));
      });
      await page.reload(); await go();
      await page.click('[data-testid=puzzle-review-start]');
      await page.click('[data-square=c4]'); await page.click('[data-square=f7]');
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('escaque:puzzles')).reviews['review-a'].box === 0);
      const failed = await page.evaluate(() => JSON.parse(localStorage.getItem('escaque:puzzles')));
      assert.equal(failed.rating, 1188);
      assert.ok(Math.abs(failed.reviews['review-a'].dueAt - Date.now() - 86400000) < 5000);
      for (const width of [1004, 390]) {
        await page.setViewportSize({ width, height: 508 });
        for (const dark of [false, true]) {
          await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
      }
      assert.deepEqual(errors, []);
      console.log(`OK ${locale}: repaso, intervalos, Elo intacto, persistencia, fallo y tamaños/claro/oscuro`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
