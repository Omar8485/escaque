// Prueba en el navegador de la "experiencia de partida" (v1.1): coronación con selector,
// campanillas, rey derrotado inclinado, estadísticas de fin de partida, clasificación de las
// jugadas del rival sin búsquedas duplicadas y tiempo de respuesta del rival.
//
// Necesita el build de pruebas (expone window.__escaqueTest.startFromFen; el de producción no):
//   npm run build:e2e && npx vite preview --port 4622 --outDir dist-e2e
//   node scripts/e2e-game-experience.cjs [URL] [--baseline URL_BUILD_ANTERIOR] [--moves N]
// Con --baseline mide también el tiempo de respuesta del rival en otro build (p. ej. main) con
// la misma partida guionizada, para comparar.
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const { Chess } = require('chess.js');

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const URL_BASE = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:4622/';
const BASELINE = flag('--baseline', null);
const TIMING_MOVES = Number(flag('--moves', 6));

let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

// Instrumentación: comandos enviados a cada worker de Stockfish (y sus `bestmove`) y frecuencias
// de los osciladores de Web Audio (los golpes de pieza usan 190 Hz; las campanillas, > 500 Hz).
function instrument() {
  window.__wlog = [];
  let n = 0;
  const OrigWorker = window.Worker;
  window.Worker = class extends OrigWorker {
    constructor(...a) {
      super(...a);
      const id = n++;
      this.__id = id;
      this.addEventListener('message', (e) => {
        for (const line of String(e.data).split('\n')) {
          if (line.startsWith('bestmove')) window.__wlog.push({ id, dir: 'in', cmd: line, t: performance.now() });
        }
      });
    }
    postMessage(m, ...rest) {
      window.__wlog.push({ id: this.__id, dir: 'out', cmd: String(m), t: performance.now() });
      return super.postMessage(m, ...rest);
    }
  };
  window.__osc = [];
  const origOsc = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function (...a) {
    const o = origOsc.apply(this, a);
    o.frequency.__isOsc = true;
    return o;
  };
  const origSet = AudioParam.prototype.setValueAtTime;
  AudioParam.prototype.setValueAtTime = function (v, t) {
    if (this.__isOsc) window.__osc.push({ f: v, t: performance.now() });
    return origSet.call(this, v, t);
  };
}

const chimeFreqs = (page, since = 0) =>
  page.evaluate((s) => window.__osc.filter((o) => o.t >= s && o.f > 400).map((o) => Math.round(o.f)), since);
const now = (page) => page.evaluate(() => performance.now());

async function newPage(browser, url, { coach = 'never', fixedRandom = false } = {}) {
  const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1400, height: 900 } });
  await skipWelcome(page);
  // Para medir tiempos: retardo visible del rival fijo (su sorteo usa Math.random).
  if (fixedRandom) await page.addInitScript(() => (Math.random = () => 0.5));
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(instrument);
  // coach: 'never' = Alfred activo sin detener la partida; 'mistakes' = como por defecto; 'off' = apagado.
  await page.addInitScript(
    (c) => localStorage.setItem('alfred:prefs', JSON.stringify(c === 'off' ? { mode: 'never', active: false } : { mode: c, active: true })),
    coach,
  );
  await page.goto(url);
  await page.mouse.move(700, 400);
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  return { page, errors };
}

const sq = (page, s) => page.locator(`[data-square="${s}"]`);
const pieceAt = (page, s) => page.locator(`[data-square="${s}"] [data-piece]`).first().getAttribute('data-piece', { timeout: 1000 }).catch(() => null);
const center = async (page, s) => {
  const b = await sq(page, s).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};
async function drag(page, from, to) {
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
  await page.mouse.up();
}
async function clickMove(page, from, to) {
  await sq(page, from).click();
  await sq(page, to).click();
}
/** Empieza una partida desde `fen` (gancho de pruebas) y espera a que el tablero la muestre. */
async function startFromFen(page, fen, opts) {
  await page.evaluate(([f, o]) => window.__escaqueTest.startFromFen(f, o), [fen, opts ?? {}]);
  const placement = fen.split(' ')[0];
  for (let i = 0; i < 100; i++) {
    if ((await boardFen(page, 'w')).split(' ')[0] === placement) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`el tablero no muestra ${fen}`);
}
const waitTurn = (page, timeout = 60000) =>
  page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout });

/** FEN aproximado leído del tablero (sin enroques ni al paso): sirve para elegir jugadas legales. */
async function boardFen(page, turn) {
  const placement = await page.evaluate(() => {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (const f of 'abcdefgh') {
        const p = document.querySelector(`[data-square="${f}${r}"] [data-piece]`)?.dataset.piece;
        if (!p) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          row += p[0] === 'w' ? p[1].toUpperCase() : p[1];
        }
      }
      rows.push(row + (empty ? empty : ''));
    }
    return rows.join('/');
  });
  return `${placement} ${turn} - - 0 1`;
}

/** Análisis del worker analista: búsquedas (`go`) con su FEN, profundidad y MultiPV. */
async function analystSearches(page, since = 0) {
  return page.evaluate((s) => {
    const log = window.__wlog;
    const ids = [...new Set(log.filter((e) => e.cmd === 'setoption name Hash value 32').map((e) => e.id))];
    const id = ids[0];
    let multipv = 1;
    let fen = null;
    const out = [];
    for (const e of log) {
      if (e.id !== id || e.dir !== 'out') continue;
      const m = /^setoption name MultiPV value (\d+)/.exec(e.cmd);
      if (m) multipv = Number(m[1]);
      if (e.cmd.startsWith('position fen ')) fen = e.cmd.slice(13);
      if (e.cmd.startsWith('go ') && e.t >= s) out.push({ fen, depth: Number(e.cmd.split(' ')[2]), multipv, t: e.t, stopped: false });
      if (e.cmd === 'stop' && out.length) out[out.length - 1].stopped = true;
    }
    return out;
  }, since);
}

/** Búsquedas redundantes: misma posición ya buscada (sin `stop`) con profundidad y MultiPV ≥. */
function duplicates(searches) {
  const dups = [];
  searches.forEach((s, i) => {
    const prev = searches.slice(0, i).find((p) => !p.stopped && p.fen === s.fen && p.depth >= s.depth && p.multipv >= s.multipv);
    if (prev) dups.push(s);
  });
  return dups;
}

async function setupLevel(page, level, color) {
  if (await page.$('[data-testid=new-game]')) await page.click('[data-testid=new-game]');
  await page.click(`[data-testid=level-${level}]`);
  await page.click(`[data-testid=color-${color}]`);
}

// ------------------------------------------------------------------------------------------
async function testPromotion(browser) {
  console.log('\n(a) Coronación');
  const { page, errors } = await newPage(browser, URL_BASE, { coach: 'never' });
  await setupLevel(page, 1, 'w');
  const WHITE_FEN = '8/4P3/8/k7/7p/8/7P/K7 w - - 0 1';
  const KNIGHT_AFTER_W = '4N3/8/8/k7/7p/8/7P/K7 b - - 0 1';

  // Clic-clic, blancas abajo; primero Esc y clic fuera cancelan.
  await startFromFen(page, WHITE_FEN);
  await waitTurn(page);
  await clickMove(page, 'e7', 'e8');
  await page.locator('[data-testid=promotion-picker]').waitFor({ timeout: 3000 });
  const picks = await page.$$eval('[data-testid^=promote-]', (els) => els.map((e) => e.dataset.testid));
  check(picks.join() === 'promote-q,promote-n,promote-r,promote-b', `selector con dama, caballo, torre y alfil (${picks.join(', ')})`);
  const qBox = await page.locator('[data-testid=promote-q]').boundingBox();
  const e8 = (await center(page, 'e8')).box;
  const e5 = (await center(page, 'e5')).box;
  const bBox = await page.locator('[data-testid=promote-b]').boundingBox();
  check(Math.abs(qBox.x - e8.x) < 2 && Math.abs(qBox.y - e8.y) < 2, 'la dama aparece sobre la casilla de coronación (e8)');
  check(Math.abs(bBox.y - e5.y) < 2, 'la columna baja hacia el centro (el alfil en e5)');
  const svgWhite = await page.$eval('[data-testid=promote-n] svg path', (p) => p.getAttribute('fill'));
  check(svgWhite === '#fff', 'las piezas del selector son las del set actual y del color que corona');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(!(await page.$('[data-testid=promotion-picker]')), 'Esc cierra el selector');
  check((await pieceAt(page, 'e7')) === 'wp' && (await pieceAt(page, 'e8')) === null, 'tras Esc el peón sigue en e7');
  await clickMove(page, 'e7', 'e8');
  await page.locator('[data-testid=promotion-backdrop]').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(150);
  check(!(await page.$('[data-testid=promotion-picker]')) && (await pieceAt(page, 'e7')) === 'wp', 'clic fuera cancela y deja el peón en su sitio');

  const since = await now(page);
  await clickMove(page, 'e7', 'e8');
  await page.click('[data-testid=promote-n]');
  await page.waitForTimeout(200);
  check((await pieceAt(page, 'e8')) === 'wn', 'clic-clic: el tablero muestra el caballo en e8');
  await waitTurn(page);
  await page.waitForTimeout(600);
  const searched = (await analystSearches(page, since)).map((s) => s.fen);
  check(searched.includes(KNIGHT_AFTER_W) && !searched.some((f) => f.startsWith('4Q3/')), 'la clasificación analiza la posición con caballo (UCI e7e8n), no con dama');

  // Arrastre, blancas abajo (otro FEN, por la caché del motor).
  await startFromFen(page, '8/4P3/8/k6p/8/8/7P/K7 w - - 0 1');
  await waitTurn(page);
  const tDrag = await now(page);
  await drag(page, 'e7', 'e8');
  await page.locator('[data-testid=promotion-picker]').waitFor({ timeout: 3000 });
  check((await pieceAt(page, 'e7')) === 'wp', 'arrastre: mientras eliges, el peón sigue en su casilla');
  await page.click('[data-testid=promote-n]');
  await page.waitForTimeout(200);
  check((await pieceAt(page, 'e8')) === 'wn', 'arrastre: el tablero muestra el caballo en e8');
  await waitTurn(page);
  await page.waitForTimeout(600);
  const dragFens = (await analystSearches(page, tDrag)).map((x) => x.fen);
  check(dragFens.includes('4N3/8/8/k6p/8/8/7P/K7 b - - 0 1'), 'arrastre: se analiza la posición con caballo (e7e8n)');

  // Tablero girado (juegas con negras): clic-clic y arrastre hacia e1.
  // Un FEN distinto en cada modo: si no, la 2.ª vez la posición ya estaría en la caché del motor.
  const BLACK = {
    'clic-clic': ['k7/7p/8/7P/8/8/4p3/7K b - - 0 1', 'k7/7p/8/7P/8/8/8/4n2K w - - 0 2'],
    arrastre: ['k7/7p/8/8/7P/8/4p3/7K b - - 0 1', 'k7/7p/8/8/7P/8/8/4n2K w - - 0 2'],
  };
  for (const mode of ['clic-clic', 'arrastre']) {
    const [BLACK_FEN, KNIGHT_AFTER_B] = BLACK[mode];
    await startFromFen(page, BLACK_FEN);
    await waitTurn(page);
    const t0 = await now(page);
    if (mode === 'clic-clic') await clickMove(page, 'e2', 'e1');
    else await drag(page, 'e2', 'e1');
    await page.locator('[data-testid=promotion-picker]').waitFor({ timeout: 3000 });
    const q = await page.locator('[data-testid=promote-q]').boundingBox();
    const e1 = (await center(page, 'e1')).box;
    const e4 = (await center(page, 'e4')).box;
    const b = await page.locator('[data-testid=promote-b]').boundingBox();
    check(Math.abs(q.y - e1.y) < 2 && Math.abs(q.x - e1.x) < 2 && Math.abs(b.y - e4.y) < 2, `girado (${mode}): selector sobre e1 (arriba) bajando hasta e4`);
    check((await page.$eval('[data-testid=promote-n] svg path', (p) => p.getAttribute('fill'))) === '#000', `girado (${mode}): piezas negras en el selector`);
    await page.click('[data-testid=promote-n]');
    await page.waitForTimeout(200);
    check((await pieceAt(page, 'e1')) === 'bn', `girado (${mode}): el tablero muestra el caballo negro en e1`);
    await waitTurn(page);
    await page.waitForTimeout(600);
    const fens = (await analystSearches(page, t0)).map((s) => s.fen);
    check(fens.includes(KNIGHT_AFTER_B), `girado (${mode}): se analiza la posición con caballo (e2e1n)`);
  }
  check(errors.length === 0, `0 errores de consola (${errors.join(' | ').slice(0, 200)})`);
  await page.close();
  return errors.length;
}

// ------------------------------------------------------------------------------------------
async function testChimesAndKing(browser) {
  console.log('\n(b) Campanillas y (c) rey derrotado');
  const { page, errors } = await newPage(browser, URL_BASE, { coach: 'never' });
  await setupLevel(page, 1, 'w');

  // Inicio con el botón (gesto real).
  let t = await now(page);
  await page.click('[data-testid=start-game]');
  await page.waitForTimeout(400);
  let f = await chimeFreqs(page, t);
  check(f.includes(784) && f.includes(1175) && !f.includes(1047), `campanilla de inicio: ${f.length} osciladores (784 y 1175 Hz + parciales)`);

  // Sin terminar: ningún rey inclinado.
  check((await page.$$('[data-defeated]')).length === 0, 'partida en curso: ningún rey inclinado');

  // Abandono → gana el rival: se inclina TU rey (blanco) y suena el cierre.
  t = await now(page);
  await page.click('[data-testid=abandon]');
  await page.waitForTimeout(900);
  f = await chimeFreqs(page, t);
  check(f.includes(1047) && f.includes(784) && f.includes(523), `campanilla de fin: ${f.length} osciladores (1047, 784 y 523 Hz + parciales)`);
  const tiltAbandon = await page.$eval('[data-defeated]', (e) => ({ king: e.dataset.king, transform: getComputedStyle(e).transform })).catch(() => null);
  const angle = (m) => {
    const v = /matrix\(([^)]+)\)/.exec(m ?? '')?.[1]?.split(',').map(Number);
    return v ? Math.round((Math.atan2(v[1], v[0]) * 180) / Math.PI) : null;
  };
  check(tiltAbandon?.king === 'w' && angle(tiltAbandon.transform) === -16, `abandono: tu rey se inclina (${tiltAbandon?.transform} → ${angle(tiltAbandon?.transform)}°)`);

  // Mate en 1 (Rd8#) desde un FEN: se inclina el rey negro, el blanco no.
  await startFromFen(page, '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  await waitTurn(page);
  t = await now(page);
  await clickMove(page, 'd1', 'd8');
  await page.waitForSelector('[data-defeated]', { timeout: 5000 });
  const mid = await page.$eval('[data-defeated]', (e) => getComputedStyle(e).transform);
  await page.waitForTimeout(900);
  const kings = await page.$$eval('[data-king]', (els) => els.map((e) => ({ king: e.dataset.king, defeated: e.dataset.defeated === 'true', transform: getComputedStyle(e).transform })));
  const black = kings.find((k) => k.king === 'b');
  const white = kings.find((k) => k.king === 'w');
  check(black?.defeated && angle(black.transform) === -16, `mate: el rey negro (perdedor) queda a ${angle(black?.transform)}° (transform ${black?.transform})`);
  check(white && !white.defeated && (white.transform === 'none' || angle(white.transform) === 0), 'mate: el rey ganador no se inclina');
  check(angle(mid) !== null && angle(mid) > -16, `la inclinación es una transición (a mitad: ${angle(mid)}°)`);
  f = await chimeFreqs(page, t);
  check(f.includes(523), 'el mate también hace sonar la campanilla de fin');
  check((await page.textContent('[data-testid=game-result]')).includes('Jaque mate'), 'resultado: jaque mate');

  // Ahogado (tablas): ningún rey inclinado.
  await startFromFen(page, '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1');
  await waitTurn(page);
  await clickMove(page, 'g1', 'g6');
  await page.waitForFunction(() => document.querySelector('[data-testid=game-result]')?.textContent.includes('½-½'), null, { timeout: 5000 });
  await page.waitForTimeout(300);
  check((await page.$$('[data-defeated]')).length === 0, 'tablas por ahogado: ningún rey inclinado');

  // Reducir movimiento: inclinado sin transición.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startFromFen(page, '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  await waitTurn(page);
  await clickMove(page, 'd1', 'd8');
  await page.waitForSelector('[data-defeated]', { timeout: 5000 });
  const rm = await page.$eval('[data-defeated]', (e) => ({ d: getComputedStyle(e).transitionDuration, tr: getComputedStyle(e).transform }));
  check(rm.d === '0s' && angle(rm.tr) === -16, `con reducir movimiento: sin transición (${rm.d}) y ya inclinado`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // Silencio: ni inicio ni fin suenan.
  await page.click('[data-testid=sound-toggle]');
  await page.click('[data-testid=new-game]');
  t = await now(page);
  await page.click('[data-testid=start-game]');
  await page.waitForTimeout(400);
  await page.click('[data-testid=abandon]');
  await page.waitForTimeout(600);
  f = await chimeFreqs(page, t);
  check(f.length === 0, `silenciado: no se crean osciladores de campanilla (${f.length})`);
  await page.click('[data-testid=sound-toggle]');

  check(errors.length === 0, `0 errores de consola (${errors.join(' | ').slice(0, 200)})`);
  await page.close();
}

// ------------------------------------------------------------------------------------------
/**
 * Juega `moves` jugadas propias (blancas) contra el nivel indicado eligiendo siempre la primera
 * jugada legal "tranquila" según chess.js; devuelve los tiempos de respuesta del rival (ms desde
 * tu clic hasta que su pieza aparece).
 */
async function playScripted(page, moves) {
  const responses = [];
  for (let i = 0; i < moves; i++) {
    await waitTurn(page);
    const fen = await boardFen(page, 'w');
    const chess = new Chess(fen);
    const legal = chess.moves({ verbose: true }).filter((m) => !m.promotion);
    // Determinista: prioriza peones de flanco y piezas menores; evita dar material gratis si se puede.
    const pick = legal.find((m) => m.piece === 'p' && 'abgh'.includes(m.from[0])) ?? legal.find((m) => m.piece === 'n') ?? legal[0];
    const t0 = await now(page);
    await clickMove(page, pick.from, pick.to);
    const t1 = await page.waitForFunction(
      (before) => {
        const s = document.querySelector('[data-testid=match-state]')?.textContent;
        if (s === 'Tu turno' && performance.now() > before) return performance.now();
        if (s === 'Terminada') return -1;
        return null;
      },
      t0,
      { timeout: 60000, polling: 50 },
    );
    const end = await t1.jsonValue();
    if (end < 0) break;
    responses.push(Math.round(end - t0));
  }
  return responses;
}

async function testSummaryAndEngine(browser) {
  console.log('\n(d) Estadísticas y (e) motor');
  const { page, errors } = await newPage(browser, URL_BASE, { coach: 'never' });
  await setupLevel(page, 1, 'w');
  await page.click('[data-testid=time-5]');
  const tStart = await now(page);
  await page.click('[data-testid=start-game]');
  const responses = await playScripted(page, 4);
  await page.waitForTimeout(1500);
  const lastRival = await page.getAttribute('[data-testid=match-panel]', 'data-last-rival-label');
  check(Boolean(lastRival), `onRivalMoveClassified: la última jugada del rival se clasificó (${lastRival})`);
  const tEnd = await now(page);
  await page.click('[data-testid=abandon]');
  await page.waitForSelector('[data-testid=game-summary]', { timeout: 5000 });
  await page.waitForSelector('[data-testid=game-summary][data-complete=true]', { timeout: 60000 });
  const read = (id) => page.textContent(`[data-testid=${id}]`);
  const s = {
    total: await read('summary-total-time'),
    moves: await read('summary-moves'),
    mw: Number(await read('summary-moves-w')),
    mb: Number(await read('summary-moves-b')),
    tw: await read('summary-time-w'),
    tb: await read('summary-time-b'),
    aw: await read('summary-accuracy-w'),
    ab: await read('summary-accuracy-b'),
  };
  const sum = async (c) => {
    let n = 0;
    for (const l of ['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']) n += Number(await read(`summary-count-${c}-${l}`));
    return n;
  };
  const secs = (txt) => txt.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  console.log('     tarjeta:', JSON.stringify(s));
  check(s.mw === 4 && s.mb === 4 && s.moves === '4', `jugadas: 4 (8 plies), 4 por color`);
  check((await page.textContent('[data-testid=game-summary]')).includes('8 medias jugadas'), 'muestra los 8 plies');
  check((await sum('w')) === 4 && (await sum('b')) === 4, 'conteos por color = jugadas de cada color (todas clasificadas)');
  check(/%/.test(s.aw) && /%/.test(s.ab), `precisión por color (${s.aw} / ${s.ab})`);
  const wall = (tEnd - tStart) / 1000;
  check(Math.abs(secs(s.total) - (secs(s.tw) + secs(s.tb))) <= 1 && secs(s.total) <= wall + 1, `tiempo total ${s.total} = tú ${s.tw} + rival ${s.tb} (≤ ${wall.toFixed(1)} s reales)`);
  check(secs(s.tb) >= 1, 'el rival gastó tiempo de reloj');

  // Accesible tras "Nueva partida" hasta que empiece otra.
  await page.click('[data-testid=new-game]');
  check(!(await page.$('[data-testid=game-summary]')) && (await page.isVisible('[data-testid=summary-toggle]')), 'tras Nueva partida: botón "Estadísticas de la partida anterior"');
  await page.click('[data-testid=summary-toggle]');
  check((await read('summary-moves-w')) === '4' && (await read('summary-total-time')) === s.total, 'la tarjeta se vuelve a ver con los mismos datos');
  await page.click('[data-testid=summary-close]');
  await page.click('[data-testid=start-game]');
  check(!(await page.$('[data-testid=summary-toggle]')) && !(await page.$('[data-testid=game-summary]')), 'al empezar otra partida desaparece');
  await page.click('[data-testid=abandon]');

  // Motor: sin búsquedas duplicadas en toda la sesión.
  const searches = await analystSearches(page);
  const dups = duplicates(searches);
  check(dups.length === 0, `0 búsquedas duplicadas del analista (${searches.length} búsquedas en total)${dups.length ? ' → ' + JSON.stringify(dups.slice(0, 3)) : ''}`);
  console.log(`     respuesta del rival (ms): ${responses.join(', ')}`);
  check(errors.length === 0, `0 errores de consola (${errors.join(' | ').slice(0, 200)})`);
  await page.close();
}

async function timing(browser, url, label, coach) {
  const { page, errors } = await newPage(browser, url, { coach, fixedRandom: true });
  await setupLevel(page, 1, 'w');
  await page.click('[data-testid=start-game]');
  const responses = await playScripted(page, TIMING_MOVES);
  await page.waitForTimeout(1500);
  const searches = await analystSearches(page);
  const dups = duplicates(searches);
  await page.close();
  const sorted = [...responses].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`     ${label} (Alfred ${coach === 'off' ? 'apagado' : 'activo'}): respuestas ${responses.join(', ')} ms · mediana ${median} ms · ${searches.length} búsquedas, ${dups.length} duplicadas · ${errors.length} errores`);
  return { median, searches: searches.length, dups: dups.length, errors: errors.length };
}

(async () => {
  const browser = await chromium.launch();
  await testPromotion(browser);
  await testChimesAndKing(browser);
  await testSummaryAndEngine(browser);

  console.log('\n(e) Tiempo de respuesta del rival y búsquedas (nivel 1, misma partida guionizada)');
  for (const coach of ['never', 'off']) {
    const cur = await timing(browser, URL_BASE, 'esta rama', coach);
    check(cur.dups === 0 && cur.errors === 0, `esta rama: 0 búsquedas duplicadas y 0 errores (Alfred ${coach === 'off' ? 'apagado' : 'activo'})`);
    if (BASELINE) {
      const base = await timing(browser, BASELINE, 'build anterior', coach);
      check(cur.median <= base.median * 1.1 + 50, `el rival no tarda más que antes (mediana ${cur.median} ms vs ${base.median} ms)`);
      check(cur.searches <= base.searches, `clasificar al rival no añade búsquedas (${cur.searches} vs ${base.searches})`);
    }
  }

  await browser.close();
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
