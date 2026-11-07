// R3: history recognition, live bus/observer contracts, notices and responsive achievements.
// npx vite --mode e2e --port 4641
// node scripts/e2e-achievements.cjs http://localhost:4641/ [--shots DIRECTORY]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const base = process.argv[2] || 'http://localhost:4641/';
const shotIndex = process.argv.indexOf('--shots');
const shots = shotIndex < 0 ? null : process.argv[shotIndex + 1];
const PGN = '[White "Player"]\n[Black "Rival"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';
async function model(page) {
  return page.evaluate(async () => {
    const { rewardsSettled } = await import(window.__rewardsRuntimeUrl ?? '/src/rewards/runtime.js');
    // Integración v1.3: las recompensas se guardan repartidas por día (src/rewards/store.js).
    const { readRewards } = await import('/src/rewards/store.js');
    await rewardsSettled();
    return readRewards();
  });
}
async function emit(page, type, data) {
  await page.evaluate(async ([type, data]) => {
    const { emitRewardEvent } = await import('/src/rewards/events.js');
    const { rewardsSettled } = await import(window.__rewardsRuntimeUrl ?? '/src/rewards/runtime.js');
    emitRewardEvent(type, data);
    await rewardsSettled();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, [type, data]);
}
async function gotoProgress(page) {
  await page.click('[data-testid=menu-toggle]');
  await page.click('[data-testid=nav-progress]');
  await page.locator('[data-testid=achievements-screen]').waitFor();
}
async function waitHydrated(page) {
  for (let i = 0; i < 300; i++) {
    if ((await model(page))?.achievements?.hydrated) return;
    await page.waitForTimeout(100);
  }
  throw new Error('History was not hydrated');
}
async function newPage(browser, variant) {
  const context = await browser.newContext({ locale: variant.locale, viewport: variant.viewport, reducedMotion: 'reduce' });
  await skipWelcome(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((dark) => {
    localStorage.setItem('coach-chess:theme', dark ? 'dark' : 'light');
    localStorage.setItem('coach-chess:sound', 'off');
    window.__oscillators = 0;
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (Audio) {
      const create = Audio.prototype.createOscillator;
      Audio.prototype.createOscillator = function (...args) { window.__oscillators++; return create.apply(this, args); };
    }
    window.__achievementNotices = [];
    document.addEventListener('DOMContentLoaded', () => {
      let previous = null;
      new MutationObserver(() => {
        const id = document.querySelector('[data-testid=achievement-notice]')?.dataset.achievement ?? null;
        if (id && id !== previous) window.__achievementNotices.push(id);
        previous = id;
      }).observe(document.body, { childList: true, attributes: true, subtree: true });
    });
  }, variant.dark);
  await page.goto(base);
  // Vite may cache-bust this module after HMR; use the same singleton as the mounted UI.
  await page.evaluate(async () => {
    const source = await (await fetch('/src/rewards/RewardsRoot.jsx')).text();
    const runtime = source.match(/from\s+"([^"]*\/runtime\.js[^"]*)"/);
    if (!runtime) throw new Error('Cannot resolve the mounted rewards runtime');
    window.__rewardsRuntimeUrl = runtime[1];
  });
  await page.mouse.move(200, 150);
  await waitHydrated(page);
  return { context, page, errors };
}
async function waitNotice(page, id) {
  await page.waitForFunction((id) => window.__achievementNotices.includes(id), id, { timeout: 15000 });
  assert.equal(await page.locator('[data-testid=achievement-notice]').evaluate((el) => getComputedStyle(el).animationName), 'none');
}
(async () => {
  const browser = await chromium.launch();
  try {
    for (const variant of [
      { locale: 'es-ES', viewport: { width: 1004, height: 508 }, dark: false },
      { locale: 'en-US', viewport: { width: 390, height: 844 }, dark: true },
    ]) {
      // Installed users receive silent recognition from stored evidence, never retrospective XP.
      const historical = await newPage(browser, variant);
      const seededAt = await historical.page.evaluate(async (pgn) => {
        const { put, setMeta, STORES } = await import('/src/storage/db.js');
        const { localDay } = await import('/src/rewards/daily.js');
        const now = Date.now();
        const endTime = now - 2 * 86400000;
        await put(STORES.games, { id: 'escaque:history', source: 'escaque', playerColor: 'w', result: '1-0', termination: 'checkmate', rivalLevel: 1, endTime, pgn });
        await put(STORES.moves, { gameId: 'escaque:history', moves: [1, 3].map((ply) => ({ ply, color: 'w', label: 'Best', evalBefore: { type: 'cp', value: 600 }, evalAfter: { type: 'cp', value: 600 } })) });
        await put(STORES.games, { id: 'pgn:imported', source: 'pgn', playerColor: 'w', result: '1-0', endTime, pgn });
        await put(STORES.puzzles, { id: 'history-puzzle', gameId: 'pgn:imported' });
        localStorage.setItem('escaque:puzzles', JSON.stringify({ rating: 1250, best: 1, streak: 0, results: { 'history-puzzle': { result: 'solved', date: localDay(endTime) } } }));
        const today = Date.parse(localDay() + 'T00:00:00Z');
        const days = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [new Date(today - (index + 1) * 86400000).toISOString().slice(0, 10), { games: [], puzzles: [], activities: ['puzzle:prior-day'] }]));
        await setMeta('rewards', { xp: { xp: 17, awards: {} }, daily: { goal: { games: 100, puzzles: 100 }, days } });
        return endTime;
      }, PGN);
      await historical.page.reload();
      await waitHydrated(historical.page);
      const recognized = await model(historical.page);
      assert.equal(recognized.xp.xp, 17);
      for (const id of ['firstGame', 'rival1', 'cleanGame', 'accuracy90', 'conversion', 'firstImport', 'firstGenerated', 'streak7']) assert.ok(recognized.achievements.unlocked[id], `history proves ${id}`);
      assert.equal(recognized.achievements.unlocked.firstGame.unlockedAt, seededAt);
      assert.equal(recognized.achievements.unlocked.puzzleChain10, undefined);
      assert.equal(await historical.page.locator('[data-testid=achievement-notice]').count(), 0);
      assert.deepEqual(await historical.page.evaluate(() => window.__achievementNotices), []);
      assert.equal(await historical.page.evaluate(() => window.__oscillators), 0);
      await historical.page.reload();
      await waitHydrated(historical.page);
      assert.deepEqual((await model(historical.page)).achievements, recognized.achievements, 'history recognition runs once');
      assert.equal((await model(historical.page)).xp.xp, 17);
      assert.deepEqual(historical.errors, []);
      await historical.context.close();
      console.log(`OK ${variant.locale}: historical game/ledger/import/puzzle/streak recognition is silent, idempotent and awards no XP`);

      const { context, page, errors } = await newPage(browser, variant);
      assert.equal(Object.keys((await model(page)).achievements.unlocked).length, 0);
      await gotoProgress(page);
      let screen = page.locator('[data-testid=achievements-screen]');
      assert.match(await screen.locator('[data-testid=achievements-count]').innerText(), /^0\D+21/);
      assert.equal(await screen.locator('[data-testid=achievement-athena]').getAttribute('data-unlocked'), 'false');
      assert.match(await screen.locator('[data-testid=achievement-athena]').getAttribute('class'), /bg-ink-50/);
      assert.match(await screen.locator('[data-testid=achievement-date-athena]').innerText(), /^(Locked|Por desbloquear)$/);
      await emit(page, 'import-completed', { id: 'empty-import', added: 0 });
      await emit(page, 'puzzles-generated', { id: 'empty-generation', count: 0 });
      assert.equal(Object.keys((await model(page)).achievements.unlocked).length, 0);
      await emit(page, 'import-completed', { id: 'live-import', added: 1 });
      await waitNotice(page, 'firstImport');
      await page.evaluate(async (pgn) => {
        const { put, STORES } = await import('/src/storage/db.js');
        const { observeGeneratedPuzzles, rewardsSettled } = await import(window.__rewardsRuntimeUrl ?? '/src/rewards/runtime.js');
        await put(STORES.games, { id: 'pgn:live', source: 'pgn', playerColor: 'w', result: '1-0', pgn, endTime: Date.now() });
        await put(STORES.puzzles, { id: 'generated-live', gameId: 'pgn:live' });
        await observeGeneratedPuzzles(1);
        await rewardsSettled();
      }, PGN);
      await waitNotice(page, 'firstGenerated');
      const win = { id: 'live-athena', plies: 2, playerColor: 'w', level: 10, result: { winner: 'w', reason: 'checkmate' } };
      await emit(page, 'training-finished', win);
      await waitNotice(page, 'athena');
      const beforeDuplicate = (await model(page)).achievements;
      await page.locator('[data-testid=achievement-notice]').waitFor({ state: 'detached', timeout: 15000 });
      const countBefore = await page.evaluate(() => window.__achievementNotices.length);
      await emit(page, 'training-finished', win);
      assert.equal(await page.locator('[data-testid=achievement-notice]').count(), 0);
      assert.equal(await page.evaluate(() => window.__achievementNotices.length), countBefore);
      assert.deepEqual((await model(page)).achievements.unlocked, beforeDuplicate.unlocked);
      for (const id of ['firstGame', 'rival10', 'athena']) assert.equal(await page.evaluate((id) => window.__achievementNotices.filter((value) => value === id).length, id), 1);
      for (let index = 0; index < 9; index++) await emit(page, 'puzzle-result', { puzzleId: `chain${index}`, solved: true, firstTry: true });
      await emit(page, 'puzzle-result', { puzzleId: 'chain0', solved: true, firstTry: true });
      assert.equal((await model(page)).achievements.counters.puzzleStreak, 9);
      assert.equal((await model(page)).achievements.unlocked.puzzleChain10, undefined);
      await emit(page, 'puzzle-result', { puzzleId: 'chain9', solved: true, firstTry: true });
      await waitNotice(page, 'puzzleChain10');
      assert.equal((await model(page)).achievements.counters.puzzleStreak, 10);
      for (let index = 0; index < 9; index++) await emit(page, 'correction', { gameId: 'corrections-game', key: `position${index}` });
      await emit(page, 'correction', { gameId: 'corrections-game', key: 'position0' });
      assert.equal((await model(page)).achievements.counters.corrections, 9);
      assert.equal((await model(page)).achievements.unlocked.corrections10, undefined);
      await emit(page, 'correction', { gameId: 'corrections-game', key: 'position9' });
      await waitNotice(page, 'corrections10');
      await emit(page, 'review-started', { ids: ['review-one', 'review-two'] });
      await emit(page, 'puzzle-result', { puzzleId: 'review-one', solved: false, firstTry: false });
      await emit(page, 'review-completed', { count: 2 });
      assert.equal((await model(page)).achievements.unlocked.firstReview, undefined, 'unfinished review does not unlock achievement');
      await emit(page, 'puzzle-result', { puzzleId: 'review-two', solved: true, firstTry: false });
      await emit(page, 'review-completed', { count: 2 });
      await waitNotice(page, 'firstReview');
      assert.equal(Object.keys((await model(page)).achievements.unlocked).length, 8);
      assert.match(await screen.locator('[data-testid=achievements-count]').innerText(), /^8\D+21/);
      assert.equal(await screen.locator('[data-testid=achievement-athena]').getAttribute('data-unlocked'), 'true');
      assert.ok(await screen.locator('[data-testid=achievement-date-athena]').innerText());
      assert.equal(await page.evaluate(() => window.__oscillators), 0, 'sound-off never creates award oscillators');
      await page.locator('[data-testid=rewards-header]').click();
      const panel = page.locator('[data-testid=rewards-panel]');
      screen = panel.locator('[data-testid=achievements-screen]');
      assert.equal(await page.locator('[data-testid=achievements-screen]').count(), 2);
      await screen.locator('[data-testid=achievement-athena]').scrollIntoViewIfNeeded();
      assert.ok(await screen.evaluate((el) => el.scrollWidth <= el.clientWidth));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, `r3-${variant.locale}-${variant.viewport.width}.png`) });
      }
      const beforeReload = await model(page);
      await page.reload();
      await waitHydrated(page);
      assert.deepEqual((await model(page)).achievements, beforeReload.achievements);
      assert.equal(await page.locator('[data-testid=achievement-notice]').count(), 0, 'unlocked history is silent after reload');
      assert.deepEqual(errors, []);
      console.log(`OK ${variant.locale} ${variant.viewport.width}×${variant.viewport.height}: 21 translated achievements, live wins, one-time notices, unique chains/corrections, real generation observer, review, silent audio, reload and layout`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
