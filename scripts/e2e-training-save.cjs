// Training persistence regression. Use Vite --mode e2e or npm run build:e2e.
// node scripts/e2e-training-save.cjs http://localhost:4631/
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const base = process.argv[2] || 'http://localhost:4631/';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATE = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';

async function records(page, store) {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const req = indexedDB.open('escaque');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const read = db.transaction(name).objectStore(name).getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }), store);
}
async function waitGames(page, count) {
  for (let tries = 0; tries < 100; tries++) {
    const games = await records(page, 'games');
    if (games.length === count) return games;
    await page.waitForTimeout(100);
  }
  throw new Error(`Expected ${count} stored games`);
}
async function waitClassified(page, gameId) {
  for (let tries = 0; tries < 300; tries++) {
    const ledger = (await records(page, 'moves')).find((row) => row.gameId === gameId);
    if (ledger?.moves.length && ledger.moves.every((move) => move.label != null)) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Final ledger classifications did not persist within 30 seconds');
}
async function go(page, tab) {
  await page.click('[data-testid=menu-toggle]');
  await page.click(`[data-testid=nav-${tab}]`);
}
async function start(page, fen) {
  await page.evaluate((f) => window.__escaqueTest.startFromFen(f), fen);
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid=match-state]')?.textContent;
    return state === 'Tu turno' || state === 'Your turn';
  });
}
async function move(page, from, to) {
  await page.click(`[data-square="${from}"]`);
  await page.click(`[data-square="${to}"]`);
}
(async () => {
  const browser = await chromium.launch();
  try {
    for (const variant of [
      { locale: 'es-ES', viewport: { width: 1004, height: 508 }, dark: false },
      { locale: 'en-US', viewport: { width: 390, height: 844 }, dark: true },
    ]) {
      const context = await browser.newContext({ locale: variant.locale, viewport: variant.viewport });
      await skipWelcome(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => { errors.push(String(e)); console.error('PAGEERROR', String(e)); });
      await page.addInitScript((dark) => {
        localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true }));
        localStorage.setItem('coach-chess:theme', dark ? 'dark' : 'light');
      }, variant.dark);
      await page.goto(base);
      await page.waitForFunction(() => Boolean(window.__escaqueTest));
      console.log('START', variant.locale);
      await start(page, MATE);
      await move(page, 'g6', 'g7');
      await page.locator('[data-testid=game-result]').waitFor();
      console.log('MATE ended');
      const [game] = await waitGames(page, 1);
      assert.equal(game.source, 'escaque');
      assert.equal(game.result, '1-0');
      assert.equal(game.termination, 'checkmate');
      assert.match(game.pgn, /Qg7#/);
      assert.equal(game.playerColor, 'w');
      assert.ok(game.timeUsedMs.w >= 0);
      const [ledger] = await records(page, 'moves');
      assert.equal(ledger.gameId, game.id);
      assert.equal(ledger.moves[0].san, 'Qg7#');
      assert.equal(ledger.moves[0].uci, 'g6g7');
      assert.equal(ledger.moves[0].phase, 'final');
      await waitClassified(page, game.id);
      await page.click('[data-testid=undo]');
      await waitGames(page, 0);
      assert.equal((await records(page, 'moves')).length, 0, 'undo removes reversible result');
      await move(page, 'g6', 'g7');
      const [replayed] = await waitGames(page, 1);
      assert.equal(replayed.id, game.id, 'replayed mate uses the same stable session id');
      await go(page, 'games');
      const row = page.locator(`[data-testid=game-row][data-game-id="${game.id}"]`);
      assert.match(await row.textContent(), /Escaque/);
      console.log('LIST visible');
      await row.click();
      await page.locator('[data-testid=analysis-games]').waitFor();
      assert.equal(await page.locator('[data-testid=analysis-game]').count(), 1);
      console.log('ANALYSIS visible');
      await page.reload();
      await page.waitForFunction(() => Boolean(window.__escaqueTest));
      assert.equal((await records(page, 'games'))[0].id, game.id);
      assert.equal((await records(page, 'moves'))[0].moves[0].san, 'Qg7#');
      await go(page, 'games');
      await page.click('[data-testid=clear-games]');
      await page.click('[data-testid=clear-confirm]');
      await waitGames(page, 0);
      assert.equal((await records(page, 'moves')).length, 0);
      console.log('CLEAR passed');
      await go(page, 'practice');
      await start(page, START);
      await page.click('[data-testid=abandon]');
      await page.locator('[data-testid=game-result]').waitFor();
      await page.waitForTimeout(300);
      assert.equal((await records(page, 'games')).length, 0, 'zero-ply abandonment is not saved');
      await start(page, START);
      console.log('ZERO passed; requesting hint');
      await page.click('[data-testid=coach-hint-btn]');
      await page.locator('[data-testid=coach-hint][data-state=ready]').waitFor({ timeout: 60000 });
      await move(page, 'e2', 'e4');
      await page.click('[data-testid=abandon]');
      const [abandoned] = await waitGames(page, 1);
      assert.equal(abandoned.termination, 'abandon');
      let savedMoves;
      for (let tries = 0; tries < 100; tries++) {
        savedMoves = (await records(page, 'moves'))[0]?.moves;
        if (savedMoves?.[0]?.hintsUsed > 0) break;
        await page.waitForTimeout(100);
      }
      assert.ok(savedMoves[0].hintsUsed > 0, 'the hint is persisted on the played move');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      assert.deepEqual(errors, []);
      console.log(`OK ${variant.locale} ${variant.viewport.width}x${variant.viewport.height} ${variant.dark ? 'dark' : 'light'}: mate, PGN, moves, list, analysis, reload, clear, zero-ply, hints`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
