// Uso: npm run build:e2e && npx vite preview --outDir dist-e2e --port 4631
//      node scripts/e2e-report.cjs [http://localhost:4631/]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://localhost:4631/';
const fixture = (name) => fs.readFileSync(path.join(__dirname, '../src/import/__fixtures__', name), 'utf8');
const lichessGame = JSON.parse(fixture('lichess-user.ndjson'));
const now = Date.now();
const lichessGames = Array.from({ length: 50 }, (_, i) => ({
  ...lichessGame, id: `v2${String(i).padStart(6, '0')}`, rated: true,
  createdAt: now - (i + 1) * 3_600_000, lastMoveAt: now - (i + 1) * 3_600_000 + 900_000,
  players: { ...lichessGame.players, white: { user: { name: 'bonerook' }, rating: 1900 } },
})).map((game) => JSON.stringify(game)).join('\n') + '\n';
const ccArchives = JSON.parse(fixture('chesscom-archives.json'));
const cors = { 'Access-Control-Allow-Origin': '*' };

async function nav(page, tab) {
  await page.locator('[data-testid=menu-toggle]:visible, [data-testid=bottom-nav-more]:visible').click();
  await page.getByTestId(`nav-${tab}`).click();
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const variant of [
      { locale: 'es-ES', viewport: { width: 1366, height: 768 }, colorScheme: 'light' },
      { locale: 'en-US', viewport: { width: 1004, height: 508 }, colorScheme: 'dark' },
      { locale: 'es-ES', viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true },
    ]) {
      const context = await browser.newContext({ ...variant, serviceWorkers: 'block' });
      await context.addInitScript(() => localStorage.setItem('escaque:pcNoticeSeen', '1'));
      const calls = [];
      await context.route('https://lichess.org/api/games/user/**', (route) => {
        const url = new URL(route.request().url());
        calls.push(url);
        const user = url.pathname.split('/').at(-1);
        if (user === 'missing') return route.fulfill({ status: 404, headers: cors });
        if (user === 'offline') return route.abort('internetdisconnected');
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/x-ndjson',
          body: user === 'empty' || url.searchParams.has('since') ? '' : lichessGames });
      });
      await context.route('https://api.chess.com/pub/player/**', (route) => {
        const url = route.request().url();
        const month = /games\/(\d{4})\/(\d{2})$/.exec(url);
        const body = month ? fixture(`chesscom-${month[1]}-${month[2]}.json`) : JSON.stringify(ccArchives);
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      await page.mouse.move(600, 300);
      await page.getByTestId('welcome-report').click();
      const input = page.getByTestId('report-username');
      const view = page.getByTestId('report-view');
      const submit = () => page.getByTestId('report-submit').click();
      for (const [user, expected] of [
        ['missing', /Lichess.*missing/i],
        ['empty', /ajedrez estándar|standard chess/],
        ['offline', /conexión|connect/i],
      ]) {
        await input.fill(user);
        await submit();
        await page.getByTestId('report-error').waitFor();
        assert.match(await page.getByTestId('report-error').textContent(), expected);
        assert.equal(await input.inputValue(), user);
      }
      await input.fill('bonerook');
      const start = Date.now();
      await submit();
      await view.waitFor({ timeout: 10000 });
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 10000, `50 games: ${elapsed} ms`);
      assert.equal(calls.at(-1).searchParams.get('max'), '50');
      assert.match(await view.textContent(), /50 partidas|50 games/);
      assert.match(await page.getByTestId('report-rating').textContent(), /1[,.]?900/);
      await page.getByTestId('report-highlight-0').waitFor();
      assert.deepEqual(await page.evaluate(() => window.__escaqueEvents.slice(-2)), ['report_start', 'report_done']);
      const before = calls.length;
      await page.getByTestId('report-refresh').click();
      await page.waitForFunction(() => window.__escaqueEvents.filter((event) => event === 'report_done').length === 2);
      assert.ok(Number(calls.at(-1).searchParams.get('since')) > 0);
      assert.equal(calls.length, before + 1);

      await page.getByTestId('report-cta-play').click();
      if (variant.isMobile) await page.getByTestId('play-setup-rival').click();
      await page.getByTestId('level-8').waitFor();
      assert.equal(await page.getByTestId('level-8').getAttribute('aria-checked'), 'true');
      await page.reload();
      await page.mouse.move(600, 300);
      await nav(page, 'report');
      await input.fill('BONEROOK');
      await submit();
      await view.waitFor();
      assert.equal(calls.length, before + 1, 'stored report makes no platform request');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      if (variant.viewport.width === 1366) {
        await page.getByTestId('report-platform-chesscom').click();
        await input.fill('MrEKO0');
        await submit();
        await view.waitFor();
        assert.match(await view.textContent(), /MrEKO0.*Chess\.com/);
        await nav(page, 'progress');
        await page.getByTestId('progress-report').click();
        await input.waitFor();
      }
      assert.deepEqual(errors, []);
      console.log(`OK ${variant.locale} ${variant.viewport.width}×${variant.viewport.height} ${variant.colorScheme}: 50 games in ${elapsed} ms`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
