// Uso: npm run build:e2e && npx vite preview --outDir dist-e2e --port 4631
//      node scripts/e2e-paywall.cjs [http://localhost:4631/]
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

const base = process.argv[2] || 'http://localhost:4631/';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

async function nav(page, section) {
  await page.locator('[data-testid=menu-toggle]:visible, [data-testid=bottom-nav-more]:visible').click();
  await page.getByTestId(`nav-${section}`).click();
}

async function seedReport(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('escaque');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['games', 'analysis'], 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      const cp = (value) => ({ type: 'cp', value });
      const games = [
        ['f3 e5 2. g4 Qh4#', 'd8h4', { type: 'mate', value: 1, winner: 'b' }],
        ['e4 d5 2. Qg4 Bxg4', 'c8g4', cp(-800)],
        ['e4 d5 2. d3 dxe4', 'd5e4', cp(-500)],
      ];
      for (const [index, [moves, bestReply, after]] of games.entries()) {
        for (let copy = 0; copy < 2; copy++) {
          const id = `lichess:paywall-${index}-${copy}`;
          const endTime = Date.now() - (index * 2 + copy) * 60_000;
          tx.objectStore('games').put({
            id, source: 'lichess', white: 'payer', black: 'opponent', whiteElo: 1500,
            playerName: 'payer', playerColor: 'w', variant: 'standard', rated: true, result: '0-1',
            endTime, importedAt: endTime, speed: 'blitz', opening: 'Apertura real F71',
            pgn: `[Result "0-1"]\n\n1. ${moves} 0-1`,
          });
          tx.objectStore('analysis').put({
            gameId: id, generatorVersion: 1, depth: 12,
            scores: [cp(0), cp(0), cp(0), after, after],
            bestMoves: [null, null, 'b1c3', bestReply, null],
          });
        }
      }
    };
  }));
}

// Respuestas UCI deterministas para clasificar 1.e4 e5 con dos cambios de evaluación.
// Los Workers de métricas e IndexedDB usan la implementación normal.
function mockUci() {
  const RealWorker = window.Worker;
  window.Worker = class {
    constructor(url, options) {
      if (!/\/stockfish\/stockfish(?:-movil)?\.js/.test(String(url))) return new RealWorker(url, options);
      this.pv = 1;
      this.fen = '';
      this.depth = 15;
    }
    postMessage(command) {
      const send = (data) => queueMicrotask(() => this.onmessage?.({ data }));
      if (command === 'uci') send('uciok');
      else if (command === 'isready') send('readyok');
      else if (command.startsWith('position fen ')) this.fen = command.slice(13);
      else if (command.startsWith('setoption name MultiPV value ')) this.pv = Number(command.split(' ').at(-1));
      else if (command.startsWith('go ')) {
        const position = this.fen.split(' ')[0];
        const black = this.fen.split(' ')[1] === 'b';
        const opening = position.startsWith('rnbqkbnr/pppppppp/8/8/8/');
        const score = opening ? 0 : black ? 380 : 280;
        const moves = black ? ['e7e5', 'e7e6', 'd7d5'] : ['d2d4', 'b1c3', 'g1f3'];
        const depth = Number(/^go depth (\d+)/.exec(command)?.[1] ?? this.depth);
        send(moves.slice(0, this.pv).map((move, index) =>
          `info depth ${depth} multipv ${index + 1} score cp ${score - index * 10} pv ${move}`).join('\n'));
        send(`bestmove ${moves[0]}`);
      } else if (command === 'stop') send('bestmove (none)');
    }
    terminate() {}
  };
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const premium of [false, true]) {
      const locale = premium ? 'en-US' : 'es-ES';
      const context = await browser.newContext({
        locale, viewport: premium ? { width: 390, height: 844 } : { width: 1366, height: 768 },
        colorScheme: premium ? 'dark' : 'light', serviceWorkers: 'block',
      });
      await skipWelcome(context);
      await context.addInitScript(mockUci);
      await context.addInitScript(() => localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'never', active: true })));
      await context.route('**/api/me', (route) => route.fulfill({ json: {
        accounts: true, billing: true, providers: ['test'], checkedAt: Date.now(),
        user: premium ? { id: 'payer-test', name: 'Payer', provider: 'test' } : null,
        plan: premium ? { premium: true, plan: 'monthly', status: 'active' } : { premium: false, plan: 'free' },
        consent: { required: false },
      } }));
      await context.route('**/api/billing/products', (route) => route.fulfill({ json: { configured: true, products: [] } }));
      await context.route('**/api/sync/**', (route) => route.fulfill({ json: {} }));
      await context.route('https://lichess.org/api/games/user/**', (route) => route.abort());

      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      await page.mouse.move(600, 300);
      await page.getByTestId('account-section').and(page.locator(`[data-plan=${premium ? 'monthly' : 'free'}]`)).waitFor({ state: 'attached' });
      await seedReport(page);
      await nav(page, 'report');
      await page.getByTestId('report-username').fill('payer');
      await page.getByTestId('report-submit').click();
      await page.getByTestId('report-cta-errors').click();
      await page.getByTestId('report-error-motif-0').waitFor();
      assert.ok(await page.evaluate(() => window.__escaqueEvents.includes('report_errors_done')));
      const reportLock = page.getByTestId('premium-lock-repeatedErrors');
      if (premium) {
        await page.getByTestId('report-error-motif-2').waitFor();
        assert.equal(await reportLock.count(), 0);
      } else {
        assert.equal(await reportLock.count(), 2);
        assert.equal(await page.getByTestId('report-error-motif-1').count(), 0);
        assert.equal(await page.getByTestId('report-error-motif-2').count(), 0);
        await reportLock.first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => window.__escaqueEvents.includes('paywall_view'));
        await reportLock.first().getByRole('button').click();
        await page.getByTestId('premium-screen').waitFor();
        await page.getByTestId('premium-close').click();
      }

      await nav(page, 'progress');
      const openingsLock = page.getByTestId('premium-lock-progress-openings');
      if (premium) {
        await page.getByTestId('progress-opening').first().waitFor();
        assert.match(await page.getByTestId('progress-openings').textContent(), /Apertura real F71/);
        assert.equal(await openingsLock.count(), 0);
      } else {
        await openingsLock.scrollIntoViewIfNeeded();
        assert.doesNotMatch(await page.getByTestId('progress-openings').textContent(), /Apertura real F71/);
        assert.equal(await page.getByTestId('progress-opening').count(), 0);
      }

      await nav(page, 'practice');
      await page.waitForFunction(() => typeof window.__escaqueTest?.startFromFen === 'function');
      await page.evaluate((fen) => window.__escaqueTest.startFromFen(fen), START_FEN);
      await page.locator('[data-square=e2]').click();
      await page.locator('[data-square=e4]').click();
      const turn = premium ? 'Your turn' : 'Tu turno';
      await page.waitForFunction((text) => document.querySelector('[data-testid=match-state]')?.textContent === text, turn);
      await page.getByTestId('abandon').click();
      await page.getByTestId('summary-moment-0').getByTestId('summary-moment-explanation').waitFor({ state: 'attached' });
      if (premium) {
        await page.getByTestId('summary-moment-1').waitFor({ state: 'attached' });
        assert.equal(await page.getByTestId('premium-lock-gameMoments').count(), 0);
      } else {
        await page.getByTestId('premium-lock-gameMoments').waitFor();
        assert.equal(await page.getByTestId('summary-moment-1').count(), 0);
      }
      assert.equal(await page.evaluate(() => window.__escaqueEvents.filter((event) => event === 'paywall_view').length), premium ? 0 : 1);
      assert.deepEqual(errors, []);
      console.log(`OK ${locale}: ${premium ? 'Premium' : 'Free'} report, progress and summary`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
