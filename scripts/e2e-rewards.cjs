// R1: real training producers + reward-bus contracts, persistence and compact header.
// npx vite --mode e2e --port 4641
// node scripts/e2e-rewards.cjs http://localhost:4641/ [--shots DIRECTORY]
// The bus contract checks import Vite's source modules; run against the dev server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const base = process.argv[2] || 'http://localhost:4641/';
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt >= 0 ? process.argv[shotsAt + 1] : null;
const MATE = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function rewards(page) {
  // Integración v1.3: las recompensas se guardan repartidas por día (src/rewards/store.js).
  return page.evaluate(async () => {
    const { readRewards } = await import('/src/rewards/store.js');
    return (await readRewards()).xp;
  });
}
async function waitXp(page, expected) {
  for (let i = 0; i < 300; i++) {
    const state = await rewards(page);
    if (state.xp === expected) return state;
    if (state.xp > expected) throw new Error(`XP ${state.xp} exceeds expected ${expected}`);
    await page.waitForTimeout(100);
  }
  assert.equal((await rewards(page)).xp, expected);
}
async function emit(page, type, data) {
  await page.evaluate(async ([type, data]) => {
    const { emitRewardEvent } = await import('/src/rewards/events.js');
    const { rewardsSettled } = await import('/src/rewards/runtime.js');
    emitRewardEvent(type, data);
    await rewardsSettled();
  }, [type, data]);
}
async function start(page, fen) {
  await page.evaluate((fen) => window.__escaqueTest.startFromFen(fen, { color: 'w' }), fen);
  await page.waitForFunction(() => /^(Tu turno|Your turn)$/.test(document.querySelector('[data-testid=match-state]')?.textContent));
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
      const context = await browser.newContext({ locale: variant.locale, viewport: variant.viewport, reducedMotion: 'reduce' });
      await skipWelcome(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript((dark) => {
        localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true }));
        localStorage.setItem('coach-chess:theme', dark ? 'dark' : 'light');
      }, variant.dark);
      await page.goto(base);
      await page.mouse.move(200, 150);
      await page.waitForFunction(() => Boolean(window.__escaqueTest));
      await page.getByText(/^(Listo|Ready)$/, { exact: true }).first().waitFor({ timeout: 60000 });
      await page.evaluate(async () => {
        const { onRewardEvent } = await import('/src/rewards/events.js');
        window.__rewardEvents = [];
        onRewardEvent((event) => window.__rewardEvents.push(event));
      });
      assert.equal((await rewards(page)).xp, 0);
      await start(page, MATE);
      await move(page, 'g6', 'g7');
      await page.locator('[data-testid=game-result]').waitFor();
      await waitXp(page, 83); // level 6 base 48 + victory 20 + complete no-blunder ledger 15
      const finish = await page.evaluate(() => window.__rewardEvents.find((event) => event.type === 'training-finished'));
      assert.equal(finish.data.plies, 1);
      assert.equal(finish.data.level, 6);
      const savedId = finish.data.id;
      assert.equal(Object.keys((await rewards(page)).awards).filter((key) => key.includes(String(savedId))).length, 3);
      await page.click('[data-testid=undo]');
      await move(page, 'g6', 'g7');
      await page.locator('[data-testid=game-result]').waitFor();
      await page.waitForTimeout(500);
      assert.equal((await rewards(page)).xp, 83, 'undo/replay cannot farm XP');
      const replayIds = await page.evaluate(() => window.__rewardEvents.filter((event) => event.type === 'training-finished').map((event) => event.data.id));
      assert.equal(replayIds[replayIds.length - 1], savedId);
      await start(page, START);
      await move(page, 'e2', 'e4');
      await page.click('[data-testid=abandon]');
      await page.locator('[data-testid=game-result]').waitFor();
      const abandoned = await page.evaluate(() => window.__rewardEvents.filter((event) => event.type === 'training-finished').at(-1));
      assert.equal(abandoned.data.plies, 1, 'abandon before the rival answers');
      await page.waitForTimeout(500);
      assert.equal((await rewards(page)).xp, 83, 'one-ply abandonment earns no XP');
      await start(page, START);
      const initialBlackPieces = await page.locator('[data-piece^="b"]').evaluateAll((pieces) => pieces.map((piece) => `${piece.closest('[data-square]').dataset.square}:${piece.dataset.piece}`).sort().join());
      await move(page, 'e2', 'e4');
      await page.waitForFunction((initial) => [...document.querySelectorAll('[data-piece^="b"]')].map((piece) => `${piece.closest('[data-square]').dataset.square}:${piece.dataset.piece}`).sort().join() !== initial, initialBlackPieces, { timeout: 60000 });
      await page.click('[data-testid=abandon]');
      await page.locator('[data-testid=game-result]').waitFor();
      const afterReply = await page.evaluate(() => window.__rewardEvents.filter((event) => event.type === 'training-finished').at(-1));
      assert.equal(afterReply.data.plies, 2, 'rival answered after the first player move');
      await page.waitForTimeout(500);
      assert.equal((await rewards(page)).xp, 83, 'first-own-move abandonment after rival reply earns no XP');
      await emit(page, 'training-finished', { id: 'black-first-own-move', plies: 3, playerColor: 'b', result: { winner: 'w', reason: 'abandon' }, level: 6 });
      assert.equal((await rewards(page)).xp, 83, 'black first-own-move abandonment after rival reply earns no XP');
      console.log(`OK ${variant.locale}: real mate → 83 XP; undo/replay stable id; first-own-move abandonment before/after rival reply → 0 XP`);

      // Producer-independent event contracts: duplicate solves and late first-try claims.
      await emit(page, 'puzzle-result', { puzzleId: 'r1-first', solved: true, firstTry: true });
      await waitXp(page, 98);
      await emit(page, 'puzzle-result', { puzzleId: 'r1-first', solved: true, firstTry: true });
      assert.equal((await rewards(page)).xp, 98);
      await emit(page, 'puzzle-result', { puzzleId: 'r1-retry', solved: true, firstTry: false });
      await waitXp(page, 108);
      const animation = await page.locator('[data-testid=rewards-toast]').evaluate((el) => getComputedStyle(el).animationName);
      assert.equal(animation, 'none', 'reduced-motion removes reward animation');
      await emit(page, 'puzzle-result', { puzzleId: 'r1-retry', solved: true, firstTry: true });
      assert.equal((await rewards(page)).xp, 108, 'late/replayed first-try claim earns no XP');
      await page.locator('[data-testid=rewards-header]').click();
      await page.locator('[data-testid=rewards-panel]').waitFor();
      assert.match(await page.locator('[data-testid=rewards-panel]').innerText(), /108/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-testid=rewards-panel]').count(), 0);
      assert.equal(await page.locator('[data-testid=rewards-level]').innerText(), variant.locale === 'es-ES' ? 'Nivel 2' : 'Level 2');
      const bar = page.locator('[data-testid=rewards-header] [role=progressbar]');
      assert.equal(await bar.getAttribute('aria-valuenow'), '8');
      assert.equal(await bar.getAttribute('aria-valuemax'), '200');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      const bounds = await page.locator('[data-testid=rewards-header]').boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= variant.viewport.width, 'header reward stays within viewport');
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, `r1-${variant.locale}-${variant.viewport.width}.png`) });
      }
      const avatarBounds = await page.locator('[data-testid=profile-button]').boundingBox();
      assert.ok(avatarBounds && avatarBounds.x >= 0 && avatarBounds.x + avatarBounds.width <= variant.viewport.width, 'avatar stays visible beside the reward header');
      const beforeReload = await rewards(page);
      await page.reload();
      await page.locator('[data-testid=rewards-level]').filter({ hasText: /2/ }).waitFor();
      assert.deepEqual(await rewards(page), beforeReload, 'XP and award identities survive reload');
      assert.deepEqual(errors, []);
      console.log(`OK ${variant.locale} ${variant.viewport.width}×${variant.viewport.height}: duplicate puzzle contracts, level/bar, modal, reduced motion, reload, layout and no errors`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
