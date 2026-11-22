// Línea base del coach (P10). No es una prueba de la potencia de un teléfono real.
// Uso: npm run build:e2e && npx vite preview --outDir dist-e2e --port 4410
//      node scripts/bench-coach.cjs [URL] --out /tmp/coach-baseline.json [--rates 1,4,6] [--repetitions 3]
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Chess } = require('chess.js');
const { skipWelcome } = require('./lib/welcome.cjs');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:4410/';
const out = option('--out', null);
const rates = option('--rates', '1,4,6').split(',').map(Number);
const repetitions = Number(option('--repetitions', '3'));
if (!rates.every((n) => Number.isFinite(n) && n >= 1) || !Number.isInteger(repetitions) || repetitions < 1) throw Error('Tasas o repeticiones inválidas');
const positions = [
  { id: 'ruy-lopez', line: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7', move: 'b3f7' },
  { id: 'sicilian', line: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7', move: 'd2d6' },
  { id: 'dragon', line: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6 Nc3 Bg7 Be3 Nf6 Bc4 O-O Bb3 d6 f3 a6 Qd2 Bd7 O-O-O Rc8 Nde2 h6', move: 'd2d6' },
].map((fixture) => {
  const game = new Chess();
  for (const san of fixture.line.split(' ')) game.move(san);
  const fen = game.fen();
  game.move({ from: fixture.move.slice(0, 2), to: fixture.move.slice(2, 4) });
  return { ...fixture, fen };
});
const median = (numbers) => { const a = [...numbers].sort((a, b) => a - b); const i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
const round = (n) => Math.round(n * 100) / 100;

async function sample(browser, fixture, rate, repetition) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'es-ES', isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  try {
    await skipWelcome(context);
    await context.addInitScript(() => {
      localStorage.setItem('escaque:pcNoticeSeen', '1');
      localStorage.setItem('alfred:prefs', JSON.stringify({ mode: 'mistakes', active: true }));
      localStorage.setItem('coach-chess:sound', 'off');
      Math.random = () => 0.5;
      window.__benchLongTasks = [];
      new PerformanceObserver((list) => window.__benchLongTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(base);
    await page.locator('main[data-engines-ready=true]').waitFor({ timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.__escaqueTest && window.__escaqueBench));
    await page.evaluate((fen) => window.__escaqueTest.startFromFen(fen, { color: 'w' }), fixture.fen);
    await page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno');
    // Tiempo de preparación constante; se incluye en JSON para poder repetir la medición.
    await page.waitForTimeout(750);
    await page.locator(`[data-square=${fixture.move.slice(0, 2)}]`).tap();
    await page.evaluate((destination) => {
      const board = () => [...document.querySelectorAll('[data-testid=board-frame] [data-square] [data-piece^=b]')].map((p) => p.closest('[data-square]').dataset.square + p.dataset.piece).sort().join();
      let black = board();
      const measurement = window.__benchSample = { start: null, feedbackAt: null, rivalAt: null, turnAt: null };
      window.__benchMoveClick = (event) => {
        if (measurement.start === null && event.target.closest('[data-square]')?.dataset.square === destination) measurement.start = performance.now();
      };
      document.addEventListener('click', window.__benchMoveClick, true);
      window.__benchObserver = new MutationObserver(() => {
        if (measurement.start === null) return;
        const kind = document.querySelector('[data-testid=coach-line]')?.dataset.kind;
        if (!measurement.feedbackAt && (kind === 'feedback' || kind === 'decide')) {
          measurement.feedbackAt = performance.now();
          // La jugada del jugador puede capturar una pieza negra: esa desaparición no es la respuesta del rival.
          black = board();
          measurement.kind = kind;
          measurement.label = document.querySelector('[data-testid=coach-line]')?.dataset.label;
        }
        if (measurement.feedbackAt && !measurement.rivalAt && board() !== black) measurement.rivalAt = performance.now();
        if (measurement.rivalAt && !measurement.turnAt && document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno') measurement.turnAt = performance.now();
      });
      window.__benchObserver.observe(document.querySelector('main'), { subtree: true, childList: true, attributes: true, characterData: true });
    }, fixture.move.slice(2, 4));
    await page.locator(`[data-square=${fixture.move.slice(2, 4)}]`).tap();
    await page.waitForFunction(() => Boolean(window.__benchSample.feedbackAt), null, { timeout: 120000 });
    const kind = await page.evaluate(() => window.__benchSample.kind);
    if (kind !== 'decide') throw Error(`${fixture.id}: la jugada conocida no detuvo al coach (${kind}); muestra inválida`);
    await page.locator('[data-testid=coach-continue]').click();
    await page.waitForFunction(() => Boolean(window.__benchSample.turnAt), null, { timeout: 120000 });
    const metrics = await page.evaluate(() => {
      window.__benchObserver.disconnect();
      document.removeEventListener('click', window.__benchMoveClick, true);
      const m = window.__benchSample;
      const commits = window.__escaqueBench.commits.filter((at) => at >= m.start && at <= m.feedbackAt).length;
      const tasks = window.__benchLongTasks.filter((e) => e.start >= m.start && e.start < m.feedbackAt);
      return { coachMs: m.feedbackAt - m.start, rivalToTurnMs: m.turnAt - m.rivalAt, commits, commitsPerSecond: commits * 1000 / (m.feedbackAt - m.start), longTaskMs: tasks.reduce((sum, e) => sum + e.duration, 0), longTasks: tasks.length, kind: m.kind, env: { cores: navigator.hardwareConcurrency, isolated: crossOriginIsolated, userAgent: navigator.userAgent } };
    });
    if (errors.length) throw Error(errors.join(' | '));
    return { position: fixture.id, rate, repetition, ...metrics };
  } finally { await context.close(); }
}
(async () => {
  const started = new Date().toISOString();
  const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
  const samples = [];
  try {
    // Intercalar posiciones/repeticiones reduce el sesgo de calentamiento de una sola posición.
    for (let repetition = 1; repetition <= repetitions; repetition++) for (const rate of rates) for (const fixture of positions) {
      const result = await sample(browser, fixture, rate, repetition);
      samples.push(result);
      console.log(`${fixture.id} CPU ${rate}× #${repetition}: coach ${round(result.coachMs)} ms · commits/s ${round(result.commitsPerSecond)} · long tasks ${round(result.longTaskMs)} ms`);
      if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ started, base, preparationMs: 750, repetitions, positions, samples }, null, 2)); }
    }
  } finally { await browser.close(); }
  const summary = rates.map((rate) => {
    const group = samples.filter((s) => s.rate === rate);
    return { cpu: rate, n: group.length, coachMs: round(median(group.map((s) => s.coachMs))), rivalToTurnMs: round(median(group.map((s) => s.rivalToTurnMs))), commits: round(median(group.map((s) => s.commits))), commitsPerSecond: round(median(group.map((s) => s.commitsPerSecond))), longTaskMs: round(median(group.map((s) => s.longTaskMs))), longTasks: round(median(group.map((s) => s.longTasks))) };
  });
  const positionSummary = positions.flatMap((fixture) => rates.map((rate) => {
    const group = samples.filter((sample) => sample.rate === rate && sample.position === fixture.id);
    return { position: fixture.id, cpu: rate, n: group.length, coachMs: round(median(group.map((s) => s.coachMs))), commits: round(median(group.map((s) => s.commits))), commitsPerSecond: round(median(group.map((s) => s.commitsPerSecond))), longTaskMs: round(median(group.map((s) => s.longTaskMs))) };
  }));
  console.table(positionSummary);
  console.table(summary);
  if (out) fs.writeFileSync(out, JSON.stringify({ started, base, preparationMs: 750, repetitions, positions, samples, positionSummary, summary }, null, 2));
})().catch((e) => { console.error(e); process.exitCode = 1; });
