// Prueba en el navegador: la voz de los rivales (globo junto a su barra).
// Uso: npm run build && npx vite preview --port 4623   y en otra terminal
//   node scripts/e2e-rival-voice.cjs [URL] [carpeta-capturas]
// Comprueba: saludo del rival correcto (Ícaro), el globo no tapa casillas (escritorio y móvil, claro
// y oscuro), clic lo cierra, con el coach deteniendo la partida el rival calla, tras Retroceder no
// comenta la jugada deshecha, tras Seguir sí comenta, frase de fin (abandono), "El rival habla: no"
// (sin globos, se recuerda al recargar) y 0 errores de consola.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const { Chess } = require('chess.js');

const URL_BASE = process.argv[2] || 'http://localhost:4623/';
const OUT = process.argv[3] || null;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

(async () => {
  const { getPersonality } = await import(pathToFileURL(path.join(__dirname, '../src/rivals/personalities.js')).href);
  const icaro = getPersonality(1);
  const inLines = (event, text) => icaro.lines[event].some((l) => (l.includes('{move}') ? new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{move\\}', '.+')}$`).test(text) : l === text));

  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
  await skipWelcome(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // Registro de cada globo que aparece (evento, texto, hora) para comprobar silencios.
  await page.addInitScript(() => {
    window.__speeches = [];
    const seen = new WeakSet();
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid=rival-speech]');
      if (el && !seen.has(el)) {
        seen.add(el);
        window.__speeches.push({ event: el.dataset.event, level: el.dataset.level, text: el.textContent.replace(/^.*? dice: /, ''), t: Date.now() });
      }
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(URL_BASE);
  await page.mouse.move(600, 300);
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  const speeches = () => page.evaluate(() => window.__speeches);
  const lastSpeech = async () => (await speeches()).at(-1) ?? null;
  const waitSpeech = (pred, timeout = 15000) =>
    page.waitForFunction((src) => window.__speeches.some(new Function('s', `return ${src}`)), pred, { timeout }).then(() => true, () => false);

  const readFen = async () => {
    const placement = await page.evaluate(() => {
      const rows = [];
      for (let r = 8; r >= 1; r--) {
        let row = '';
        let empty = 0;
        for (const f of 'abcdefgh') {
          const el = document.querySelector(`[data-square="${f}${r}"] [data-piece]`);
          if (!el) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          const k = el.getAttribute('data-piece');
          row += k[0] === 'w' ? k[1].toUpperCase() : k[1];
        }
        if (empty) row += empty;
        rows.push(row);
      }
      return rows.join('/');
    });
    return `${placement} w - - 0 1`;
  };
  const move = async (uci) => {
    await page.click(`[data-square="${uci.slice(0, 2)}"]`);
    await page.click(`[data-square="${uci.slice(2, 4)}"]`);
  };
  const waitTurn = () => page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });
  const findBlunder = (fen) => {
    const chess = new Chess(fen);
    return chess.moves({ verbose: true }).find((m) => ['q', 'r', 'n', 'b'].includes(m.piece) && !m.captured && (() => {
      const c = new Chess(fen);
      c.move(m);
      return c.attackers(m.to, 'b').some((sq) => c.get(sq).type === 'p');
    })());
  };
  /** El globo no se superpone a ninguna casilla del tablero. */
  const bubbleClearOfSquares = () =>
    page.evaluate(() => {
      const b = document.querySelector('[data-testid=rival-speech]')?.getBoundingClientRect();
      if (!b) return null;
      const squares = [...document.querySelectorAll('[data-square]')].map((e) => e.getBoundingClientRect());
      const top = Math.min(...squares.map((r) => r.top));
      const bottom = Math.max(...squares.map((r) => r.bottom));
      const left = Math.min(...squares.map((r) => r.left));
      const right = Math.max(...squares.map((r) => r.right));
      const overlaps = b.bottom > top + 0.5 && b.top < bottom - 0.5 && b.right > left + 0.5 && b.left < right - 0.5;
      return { overlaps, bubble: [Math.round(b.top), Math.round(b.bottom)], board: [Math.round(top), Math.round(bottom)] };
    });

  // ---------- 1. Saludo de Ícaro ----------
  check((await page.getAttribute('[data-testid=rival-voice]', 'data-value')) === 'on', 'por defecto "El rival habla: sí"');
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  check(await waitSpeech("s.event === 'game_start'", 5000), 'al empezar aparece un globo de saludo');
  const hello = await lastSpeech();
  check(hello?.level === '1' && inLines('game_start', hello.text), `frase de inicio de Ícaro: «${hello?.text}»`);
  check(Boolean(await page.$('[data-testid=player-bar-b] [data-testid=rival-speech]')), 'el globo está en la barra del rival');
  const region = await page.$eval('[data-testid=player-bar-b] [data-testid=rival-speech-region]', (e) => [e.getAttribute('role'), e.getAttribute('aria-live')].join('/'));
  check(region === 'status/polite', `región accesible (${region})`);
  const clear1 = await bubbleClearOfSquares();
  check(clear1 && !clear1.overlaps, `no tapa casillas en escritorio (globo ${clear1?.bubble}, casillas ${clear1?.board})`);
  if (OUT) await page.screenshot({ path: `${OUT}/rival-saludo-claro.png` });
  await page.click('[data-testid=theme-toggle]');
  await page.waitForTimeout(250);
  const darkBg = await page.$eval('[data-testid=rival-speech]', (e) => getComputedStyle(e).backgroundColor);
  check(!/255, 255, 255/.test(darkBg), `en oscuro el globo no es blanco (${darkBg})`);
  if (OUT) await page.screenshot({ path: `${OUT}/rival-saludo-oscuro.png` });
  await page.click('[data-testid=theme-toggle]');
  await page.click('[data-testid=rival-speech]');
  await page.waitForTimeout(400);
  check(!(await page.$('[data-testid=rival-speech]')), 'clic en el globo lo cierra');

  // ---------- 2. Error grave con el coach activo ----------
  await move('e2e4');
  await waitTurn();
  let commented = false;
  let retroDone = false;
  for (let attempt = 0; attempt < 6 && !commented; attempt++) {
    const fen = await readFen();
    const blunder = findBlunder(fen);
    if (!blunder) {
      const chess = new Chess(fen);
      const quiet = chess.moves({ verbose: true }).find((m) => m.piece === 'p' && !m.captured) ?? chess.moves({ verbose: true })[0];
      await move(quiet.lan);
      await page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno' || document.querySelector('[data-testid=coach-continue]'), null, { timeout: 60000 });
      if (await page.$('[data-testid=coach-continue]')) await page.click('[data-testid=coach-continue]');
      await waitTurn();
      continue;
    }
    // Cooldown: deja pasar 15 s desde la última frase para que el rival pueda hablar.
    const last = await lastSpeech();
    const wait = last ? 15500 - (Date.now() - last.t) : 0;
    if (wait > 0) await page.waitForTimeout(wait);
    const before = (await speeches()).length;
    await move(blunder.lan);
    const stopped = await page.waitForSelector('[data-testid=coach-continue]', { timeout: 30000 }).then(() => true, () => false);
    if (!stopped) {
      console.log(`  (${blunder.san}: el coach no detuvo la partida; otro intento)`);
      await waitTurn();
      continue;
    }
    const label = await page.$eval('[data-testid=coach-feedback]', (e) => e.dataset.label).catch(() => '?');
    await page.waitForTimeout(3000);
    const during = (await speeches()).slice(before);
    check(during.length === 0, `con el coach deteniendo la partida (${blunder.san}, ${label}) el rival no habla (${during.map((s) => s.event).join(',') || 'nada'})`);
    if (!retroDone) {
      // Retroceder: no se burla de la jugada deshecha.
      await page.click('[data-testid=coach-takeback]');
      await waitTurn();
      await page.waitForTimeout(3000);
      const afterBack = (await speeches()).slice(before);
      check(afterBack.length === 0, `tras Retroceder el rival no comenta ${blunder.san} (${afterBack.map((s) => s.event).join(',') || 'nada'})`);
      retroDone = true;
      attempt--;
      continue;
    }
    if (OUT) await page.screenshot({ path: `${OUT}/rival-coach-detiene.png` });
    await page.click('[data-testid=coach-continue]');
    const said = await waitSpeech(`s.t > ${Date.now() - 100} && (s.event === 'player_blunder' || s.event === 'player_mistake')`, 6000);
    if (said) {
      const s = await lastSpeech();
      check(inLines(s.event, s.text), `tras Seguir, Ícaro comenta tu ${label === 'Blunder' ? 'error grave' : 'error'}: «${s.text}»`);
      commented = true;
      if (OUT) await page.screenshot({ path: `${OUT}/rival-tras-seguir.png` });
    } else {
      console.log(`  (${label}: sin comentario; los errores no graves solo a veces. Otro intento)`);
    }
    await waitTurn();
  }
  check(commented, 'el rival comentó un error tras Seguir');

  // ---------- 3. Móvil (se mide con la frase de fin) ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  // ---------- 4. Fin de partida (abandono) ----------
  await page.click('[data-testid=abandon]');
  check(await waitSpeech("s.event === 'rival_wins'", 5000), 'al abandonar, el rival dice su frase de victoria');
  const end = await lastSpeech();
  check(inLines('rival_wins', end?.text ?? ''), `frase de fin de Ícaro: «${end?.text}»`);
  const clear2 = await bubbleClearOfSquares();
  check(clear2 && !clear2.overlaps, `en móvil (390 px) no tapa casillas (globo ${clear2?.bubble}, casillas ${clear2?.board})`);
  const lines = await page.$eval('[data-testid=rival-speech] span.block', (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
  check(lines <= 3, `en móvil ocupa ${lines} línea(s) (≤ 3)`);
  if (OUT) await page.screenshot({ path: `${OUT}/rival-fin-movil.png` });
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---------- 5. "El rival habla: no" ----------
  await page.click('[data-testid=new-game]');
  await page.click('[data-testid=rival-voice-off]');
  check((await page.getAttribute('[data-testid=rival-voice]', 'data-value')) === 'off', 'se puede silenciar al rival');
  const n0 = (await speeches()).length;
  await page.click('[data-testid=start-game]');
  await page.waitForTimeout(2000);
  await move('e2e4');
  await waitTurn();
  await page.click('[data-testid=abandon]');
  await page.waitForTimeout(1500);
  check((await speeches()).length === n0 && !(await page.$('[data-testid=rival-speech]')), 'silenciado: ningún globo (ni saludo ni fin)');
  await page.reload();
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  check((await page.getAttribute('[data-testid=rival-voice]', 'data-value')) === 'off', 'la preferencia se recuerda al recargar');
  await page.click('[data-testid=rival-voice-on]');
  check((await page.getAttribute('[data-testid=rival-voice]', 'data-value')) === 'on', 'y se vuelve a activar');

  check(errors.length === 0, `errores de consola: ${errors.length ? errors.join(' | ') : 0}`);
  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
