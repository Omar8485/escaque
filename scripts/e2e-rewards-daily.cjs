// R2 browser contracts, local-day persistence and editable goals.
// npx vite --mode e2e --port 4641
// node scripts/e2e-rewards-daily.cjs http://localhost:4641/ [--shots DIRECTORY]
// Uses the Vite source-module bus with the exact producer payloads (puzzleId, result.reason).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const base = process.argv[2] || 'http://localhost:4641/';
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt < 0 ? null : process.argv[shotsAt + 1];
async function model(page) {
  return page.evaluate(async () => {
    const { rewardsSettled } = await import('/src/rewards/runtime.js');
    // Integración v1.3: las recompensas se guardan repartidas por día (src/rewards/store.js).
    const { readRewards } = await import('/src/rewards/store.js');
    await rewardsSettled();
    return readRewards();
  });
}
async function emit(page, type, data) {
  await page.evaluate(async ([type, data]) => {
    const { emitRewardEvent } = await import('/src/rewards/events.js');
    const { rewardsSettled } = await import('/src/rewards/runtime.js');
    emitRewardEvent(type, data);
    await rewardsSettled();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, [type, data]);
}
(async () => {
  const browser = await chromium.launch();
  try {
    for (const variant of [
      { locale: 'es-ES', timezoneId: 'America/Guayaquil', viewport: { width: 1004, height: 508 }, dark: false },
      { locale: 'en-US', timezoneId: 'America/New_York', viewport: { width: 390, height: 844 }, dark: true },
    ]) {
      const context = await browser.newContext({ ...variant, reducedMotion: 'reduce' });
      await skipWelcome(context);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript((dark) => localStorage.setItem('coach-chess:theme', dark ? 'dark' : 'light'), variant.dark);
      await page.goto(base);
      await page.locator('[data-testid=rewards-header]').waitFor();
      const day = await page.evaluate(async () => {
        const { localDay } = await import('/src/rewards/daily.js');
        const { setMeta } = await import('/src/storage/db.js');
        const { rewardsSettled } = await import('/src/rewards/runtime.js');
        await rewardsSettled();
        const today = localDay();
        const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
        await setMeta('rewards', { preserved: 'unrelated-setting', xp: { xp: 0, awards: {} }, daily: {
          goal: { games: 1, puzzles: 3 },
          days: { [yesterday]: { games: [], puzzles: [], activities: ['puzzle:yesterday'] } },
        } });
        return today;
      });
      await page.reload();
      await page.locator('[data-testid=rewards-header]').click();
      let panel = page.locator('[data-testid=rewards-panel]');
      await panel.locator('[data-testid=rewards-daily]').waitFor();
      assert.match(await panel.locator('[data-testid=rewards-daily-streak]').innerText(), /^1\b/);
      assert.equal(await panel.locator('[data-testid=rewards-daily-goal-games]').inputValue(), '1');
      assert.equal(await panel.locator('[data-testid=rewards-daily-goal-puzzles]').inputValue(), '3');
      await emit(page, 'puzzle-result', { puzzleId: 'attempted', solved: false, firstTry: false });
      assert.match(await panel.locator('[data-testid=rewards-daily-streak]').innerText(), /^2\b/, 'failed puzzle maintains local-day streak');
      assert.match(await panel.locator('[data-testid=rewards-daily-best]').innerText(), /^2\b/);
      assert.equal((await model(page)).daily.days[day].puzzles.length, 0);
      assert.equal((await model(page)).daily.days[day].activities.length, 1);
      assert.equal(await panel.locator('[data-testid=rewards-daily-complete]').count(), 0);
      assert.equal((await model(page)).xp.xp, 0);
      await emit(page, 'training-finished', { id: 'too-short', plies: 1, playerColor: 'w', level: 6, result: { winner: 'b', reason: 'abandon' } });
      assert.equal((await model(page)).daily.days[day].games.length, 0, 'result.reason abandonment is normalized');
      await emit(page, 'training-finished', { id: 'daily-game', plies: 2, playerColor: 'w', level: 6, result: { winner: 'w', reason: 'checkmate' } });
      await emit(page, 'training-finished', { id: 'daily-game', plies: 2, playerColor: 'w', level: 6, result: { winner: 'w', reason: 'checkmate' } });
      assert.equal((await model(page)).daily.days[day].games.length, 1);
      await emit(page, 'puzzle-result', { puzzleId: 'attempted', solved: true, firstTry: false });
      await emit(page, 'puzzle-result', { puzzleId: 'attempted', solved: true, firstTry: true });
      assert.equal((await model(page)).daily.days[day].puzzles.length, 1, 'duplicate puzzle is one goal unit');
      await emit(page, 'puzzle-result', { puzzleId: 'second', solved: true, firstTry: true });
      assert.equal(await panel.locator('[data-testid=rewards-daily-complete]').count(), 0);
      await emit(page, 'puzzle-result', { puzzleId: 'third', solved: true, firstTry: true });
      await panel.locator('[data-testid=rewards-daily-complete]').waitFor();
      assert.deepEqual((await model(page)).daily.days[day].puzzles.sort(), ['attempted', 'second', 'third']);
      assert.equal((await model(page)).xp.xp, 133, '68 game + 40 puzzle + 25 goal');
      assert.equal((await model(page)).xp.awards[`goal:${day}`].amount, 25);
      assert.match(await panel.locator('[data-testid=rewards-daily-progress-games]').innerText(), /^1\D+1$/);
      assert.match(await panel.locator('[data-testid=rewards-daily-progress-puzzles]').innerText(), /^3\D+3$/);
      const edit = async (key, value) => {
        await panel.locator(`[data-testid=rewards-daily-goal-${key}]`).fill(String(value));
        await model(page);
      };
      await edit('puzzles', 5);
      assert.equal(await panel.locator('[data-testid=rewards-daily-complete]').count(), 0);
      await edit('puzzles', 3);
      await panel.locator('[data-testid=rewards-daily-complete]').waitFor();
      await edit('games', 0);
      await edit('puzzles', 0);
      assert.deepEqual((await model(page)).daily.goal, { games: 0, puzzles: 3 }, 'both targets cannot be zero');
      await edit('games', 2);
      await edit('puzzles', 0);
      assert.equal(await panel.locator('[data-testid=rewards-daily-complete]').count(), 0);
      await edit('games', 1);
      assert.deepEqual((await model(page)).daily.goal, { games: 1, puzzles: 0 });
      assert.equal((await model(page)).xp.xp, 133, 'changing a completed goal cannot farm daily XP');
      assert.equal(Object.keys((await model(page)).xp.awards).filter((key) => key.startsWith('goal:')).length, 1);
      assert.equal((await model(page)).preserved, 'unrelated-setting');
      await page.keyboard.press('Escape');
      await page.click('[data-testid=menu-toggle]');
      await page.click('[data-testid=nav-progress]');
      await page.locator('[data-testid=rewards-daily]').waitFor();
      await page.locator('[data-testid=rewards-header]').click();
      assert.equal(await page.locator('[data-testid=rewards-daily]').count(), 2, 'daily card is available in Progress and modal');
      panel = page.locator('[data-testid=rewards-panel]');
      await panel.locator('[data-testid=rewards-daily-rules]').click();
      assert.ok((await panel.locator('[data-testid=rewards-daily-wildcard]').innerText()).length > 10);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), 'goal panel fits the mobile viewport');
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, `r2-${variant.locale}-${variant.viewport.width}.png`) });
      }
      const before = await model(page);
      await page.reload();
      await page.locator('[data-testid=rewards-header]').click();
      panel = page.locator('[data-testid=rewards-panel]');
      await panel.locator('[data-testid=rewards-daily-complete]').waitFor();
      assert.equal(await panel.locator('[data-testid=rewards-daily-goal-games]').inputValue(), '1');
      assert.equal(await panel.locator('[data-testid=rewards-daily-goal-puzzles]').inputValue(), '0');
      assert.deepEqual(await model(page), before, 'goal, daily identities and XP survive reload');
      assert.deepEqual(errors, []);
      console.log(`OK ${variant.locale} ${variant.timezoneId} ${variant.viewport.width}×${variant.viewport.height}: streak from failed attempt, unique daily goal, 25XP once, editable targets, Progress/modal, reload and layout`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
