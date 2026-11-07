// P4 acceptance smoke test against a local preview build.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
// Estas pruebas cubren las funciones completas: se simula un plan Premium guardado (src/premium/planStore.js),
// que la app respeta sin servidor de cuentas. Los límites del plan gratuito se prueban en e2e-accounts.cjs.
const PREMIUM_SEED = () => localStorage.setItem('escaque:account', JSON.stringify({
  user: { id: 'e2e', email: null, name: 'e2e', provider: 'test' }, plan: { premium: true, plan: 'founder', lifetime: true, periodEnd: null }, checkedAt: Date.now(),
}));
const { Chess } = require('chess.js');
const BASE = process.argv[2] || 'http://127.0.0.1:4633/';
const NOW = Date.now();
function fixtures() {
  const chess = new Chess();
  chess.move('e4'); const bad = chess.move('c5'); chess.move('Nf3');
  const games = [0, 1, 2].map((n) => ({ id: `escaque:p4-${n}`, source: 'escaque', externalId: `p4-${n}`,
    white: 'Héctor', black: 'Tester', playerName: 'Tester', playerColor: 'b', whiteElo: 1500, blackElo: null,
    endTime: NOW - n * 86400000, importedAt: NOW, result: '1-0', speed: 'blitz', timeControl: '300+0',
    pgn: chess.pgn(), opening: 'Sicilian Defense', eco: 'B20', termination: 'abandon', variant: 'standard', rated: false }));
  const moves = games.map((game) => ({ gameId: game.id, moves: [{ ply: 2, color: 'b', san: bad.san, uci: bad.lan,
    fenBefore: bad.before, fenAfter: bad.after, phase: 'final', label: 'Blunder', motif: 'ataque_doble',
    evalBefore: { type: 'cp', value: 0 }, evalAfter: { type: 'cp', value: 500 }, loss: 35 }] }));
  // UI fixtures: tactical exercise intentionally simple, linked to a known saved game.
  const puzzle = { id: 'p4-fork', gameId: games[0].id, fen: new Chess().fen(), solution: ['e2e4'],
    color: 'w', type: 'error', motif: 'ataque_doble', phase: 'apertura', rating: 1000, source: 'escaque',
    moveNumber: 1, played: 'd4', opponent: 'Héctor', date: '2026-11-02', opening: 'Sicilian Defense',
    playerColor: 'b', gameUrl: null };
  return { games, moves, puzzles: [puzzle] };
}
async function seed(page, data) {
  await page.evaluate((snapshot) => new Promise((resolve, reject) => {
    const req = indexedDB.open('escaque');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['games', 'analysis', 'moves', 'puzzles'], 'readwrite');
      for (const name of ['games', 'analysis', 'moves', 'puzzles']) {
        const store = tx.objectStore(name); store.clear();
        for (const record of snapshot[name] ?? []) store.put(record);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), data);
  await page.reload();
}
async function go(page, tab) {
  await page.click('[data-testid=menu-toggle]');
  await page.click(`[data-testid=nav-${tab}]`);
}
async function progress(page) {
  await go(page, 'progress');
  await page.locator('[data-testid=progress-screen]').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid=progress-loading]'));
}
(async () => {
  const browser = await chromium.launch();
  try {
    for (const variant of [{ locale: 'es-ES', viewport: { width: 1004, height: 508 }, dark: false },
      { locale: 'en-US', viewport: { width: 390, height: 844 }, dark: true }]) {
      const context = await browser.newContext({ locale: variant.locale, viewport: variant.viewport });
      await skipWelcome(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => { errors.push(String(error)); console.error(error.message); });
      await page.addInitScript((dark) => localStorage.setItem('coach-chess:theme', dark ? 'dark' : 'light'), variant.dark);
      await page.addInitScript(PREMIUM_SEED);
      await page.goto(BASE);
      await page.locator('[data-testid=menu-toggle]').waitFor();
      await progress(page);
      assert.equal(await page.locator('[data-testid^=training-plan-start-]').count(), 0, 'empty data offers no plan actions');
      const data = fixtures();
      await seed(page, { games: [{ ...data.games[0], id: 'pgn:unanalysed', source: 'pgn' }] });
      await progress(page);
      await page.locator('[data-testid=progress-needs-analysis]').waitFor();
      assert.equal(await page.locator('[data-testid^=training-plan-start-]').count(), 0, 'unanalysed games offer no invented actions');
      assert.equal(await page.locator('[data-testid=training-plan-review]').count(), 0);
      await seed(page, data);
      await progress(page);
      await page.locator('[data-testid=training-plan-start-puzzles]').waitFor({ timeout: 30000 });
      assert.equal(await page.locator('[data-testid=training-plan-start-practice]').count(), 1);
      assert.equal(await page.locator('[data-testid=training-plan-review]').count(), 1);
      assert.ok((await page.locator('[data-testid=training-plan]').textContent()).includes('Sicilian Defense'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'plan fits viewport');
      await page.selectOption('[data-testid=progress-filter-source]', 'imported');
      await page.locator('[data-testid=training-plan-empty]').waitFor();
      assert.equal(await page.locator('[data-testid^=training-plan-start-]').count(), 0, 'source filters remove recommendations from excluded games');
      assert.equal(await page.locator('[data-testid=training-plan-review]').count(), 0);
      await page.selectOption('[data-testid=progress-filter-source]', 'all');
      await page.locator('[data-testid=training-plan-start-puzzles]').waitFor();
      await page.click('[data-testid=training-plan-start-puzzles]');
      const trainer = page.locator('[data-testid=puzzle-trainer]');
      await trainer.waitFor();
      assert.equal(await trainer.getAttribute('data-puzzle'), 'p4-fork');
      const target = page.locator('[data-testid=plan-puzzle-target]');
      await target.waitFor();
      assert.equal(await target.getAttribute('data-motif'), 'ataque_doble');
      await progress(page);
      await page.click('[data-testid="training-plan-review-escaque:p4-0-2"]');
      await page.locator('[data-testid=plan-review-targets]').waitFor();
      assert.equal(await page.locator('[data-testid=plan-review-targets] button').count(), 3);
      const selection = page.locator('[data-testid=plan-review-targets]');
      assert.equal(await selection.getAttribute('data-game-id'), 'escaque:p4-0');
      assert.equal(await selection.getAttribute('data-ply'), '2');
      await page.locator('[data-testid="plan-review-target-escaque:p4-1-2"]').click();
      assert.equal(await selection.getAttribute('data-game-id'), 'escaque:p4-1');
      assert.equal(await selection.getAttribute('data-ply'), '2');
      await progress(page);
      await page.click('[data-testid=training-plan-start-practice]');
      await page.locator('[data-testid=start-game]').waitFor();
      assert.equal(await page.locator('[data-testid=color-b]').getAttribute('aria-checked'), 'true');
      assert.match(await page.locator('[data-testid=level-label]').textContent(), /Héctor/);
      await page.locator('[data-testid=practice-opening-goal]').waitFor();
      assert.match(await page.locator('[data-testid=practice-opening-goal]').textContent(), /Sicilian Defense/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'practice fits viewport');
      assert.deepEqual(errors, []);
      console.log(`OK P4 ${variant.locale} ${variant.viewport.width}x${variant.viewport.height}: empty/unanalysed, puzzle filter, exact review+next target, practice preset+goal`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
