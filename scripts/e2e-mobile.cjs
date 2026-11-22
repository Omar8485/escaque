// Prueba de aceptación de la ronda M: Escaque en el teléfono (diseño móvil interno §4, criterios A1–A8).
// Cada comprobación pertenece a una tarea (M0…M5, diseño móvil interno §5 y lista interna de tareas §2).
//
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-mobile.cjs [URL] [carpeta-capturas] [--only M1[,M2…]] [--quick]
//     --only  solo esas tareas (repetible o separado por comas); para ellas un fallo es FALLO aunque
//             estén en PENDING.
//     --quick solo 360×740, español, claro.
// Viewports: 360×740, 390×844, 412×915 y 740×360 (horizontal), táctiles (isMobile + hasTouch);
// español claro en los 4 y, además, inglés oscuro en 360×740 y 412×915. Escritorio: 1280×800 con ratón.
// Salida: «OK   », «FALLO» o «PEND » (fallo de una tarea aún pendiente: no cuenta), y un resumen por tarea.
// Capturas (si se pasa la carpeta): mobile-<tarea>-<pantalla>-<w>x<h>-<idioma>-<tema>.png
// Requiere Playwright con Chromium (no es dependencia del proyecto).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const m = require('./lib/mobile.cjs');

const { sel, press, fit, rectOf, noHorizontalScroll, smallTargets, resetScroll, cssVars, goTo, hasBottomNav } = m;

// Tareas aún sin terminar: sus fallos se informan como PEND y no cuentan. Cada tarea quita su id al terminar.
const PENDING = new Set([]);
const TASKS = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];

// ---------- Argumentos ----------
const argv = process.argv.slice(2);
const only = new Set();
const positional = [];
let quick = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--quick') quick = true;
  else if (a === '--only' || a.startsWith('--only=')) {
    const val = a === '--only' ? argv[++i] : a.slice('--only='.length);
    for (const id of String(val ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) {
      if (!TASKS.includes(id)) {
        console.error(`Tarea desconocida en --only: ${id} (válidas: ${TASKS.join(', ')})`);
        process.exit(2);
      }
      only.add(id);
    }
  } else positional.push(a);
}
const URL_BASE = positional[0] || 'http://localhost:4173/';
const OUT = positional[1] || null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const runs = (task) => !only.size || only.has(task);

// ---------- Variantes ----------
const V = (w, h, lang, theme) => ({
  w, h, lang, theme, portrait: h > w,
  label: `${w}×${h} ${lang} ${theme === 'dark' ? 'oscuro' : 'claro'}`,
  key: `${w}x${h}-${lang}-${theme === 'dark' ? 'oscuro' : 'claro'}`,
});
const FULL = [V(360, 740, 'es', 'light'), V(390, 844, 'es', 'light'), V(412, 915, 'es', 'light'), V(740, 360, 'es', 'light'), V(360, 740, 'en', 'dark'), V(412, 915, 'en', 'dark')];
const VARIANTS = quick ? FULL.slice(0, 1) : FULL;
const DESKTOP = V(1280, 800, 'es', 'light');
const is = (v, w, h) => v.w === w && v.h === h;
// Interrupción del coach (A3): necesita jugar unas jugadas; en dos variantes basta.
const A3_VARIANTS = VARIANTS.filter((v) => (is(v, 360, 740) && v.lang === 'es') || (is(v, 412, 915) && v.lang === 'en'));
const PUZZLE_VARIANTS = VARIANTS.filter((v) => is(v, 360, 740) || is(v, 740, 360));
const SUMMARY_VARIANTS = VARIANTS.filter((v) => is(v, 360, 740));

// ---------- Registro ----------
const tally = Object.fromEntries(TASKS.map((t) => [t, { ok: 0, fail: 0, pend: 0 }]));
const notOk = [];
function record(task, ok, msg) {
  const status = ok ? 'ok' : PENDING.has(task) && !only.has(task) ? 'pend' : 'fail';
  tally[task][status]++;
  const tag = { ok: 'OK   ', fail: 'FALLO', pend: 'PEND ' }[status];
  console.log(`${tag} [${task}] ${msg}`);
  if (!ok) notOk.push(`${tag} [${task}] ${msg}`);
}
/** Registra el resultado de una medición { ok, why }. */
const check = (task, res, msg) => record(task, Boolean(res?.ok), res?.ok || !res?.why ? msg : `${msg} → ${res.why}`);
const checkSmall = (task, small, msg) => record(task, small.length === 0, small.length ? `${msg} → ${small.slice(0, 5).join(', ')}${small.length > 5 ? ` (+${small.length - 5})` : ''}` : msg);

async function shot(page, task, screen, v) {
  if (!OUT) return;
  await page.screenshot({ path: path.join(OUT, `mobile-${task}-${screen}-${v.key}.png`) }).catch(() => {});
}

let browser;
/**
 * Un bloque de comprobaciones con sus contextos: si algo lanza o se cuelga, registra FALLO para su
 * tarea, cierra los contextos y sigue con el siguiente bloque.
 */
async function block(task, label, fn, ms = 90000) {
  const contexts = [];
  const open = async (v, opts = {}) => {
    const app = await m.openApp(browser, v, { url: URL_BASE, ...opts });
    contexts.push(app);
    return app;
  };
  let timer;
  try {
    await Promise.race([
      fn(open),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`tiempo agotado (${ms / 1000} s)`)), ms);
      }),
    ]);
  } catch (e) {
    record(task, false, `${label}: error inesperado: ${m.firstLine(e)}`);
  } finally {
    clearTimeout(timer);
    for (const app of contexts) {
      if (app.errors.length) record(task, false, `${label}: errores de página: ${app.errors.slice(0, 3).join(' | ')}`);
      await app.context.close().catch(() => {});
    }
  }
}
/** Un paso dentro de un bloque: si lanza, FALLO con su nombre y el bloque sigue. */
async function step(task, label, fn) {
  try {
    await fn();
  } catch (e) {
    record(task, false, `${label}: ${m.firstLine(e)}`);
  }
}
const visibleSoon = (page, selector, timeout = 4000) =>
  page.locator(selector).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);

// =============================================================================================
// M0 · Contrato (§3), A5 (táctil no abre el menú) y A7 (escritorio sin cambios, humo)

async function runM0() {
  for (const v of VARIANTS) {
    await block('M0', v.label, async (open) => {
      const { page, context } = await open(v);
      const L = `${v.label} ·`;
      const vars = await cssVars(page);
      record('M0', vars.bottomNav !== '', `${L} --bottom-nav-h definida en móvil («${vars.bottomNav}» = ${vars.bottomNavPx}px)`);
      record('M0', vars.header !== '' && vars.headerPx > 0, `${L} --app-header-h definida («${vars.header}»)`);
      check('M0', await noHorizontalScroll(page), `${L} Jugar al cargar: sin desplazamiento horizontal`);
      await shot(page, 'M0', 'play', v);

      // A5: tocar y desplazar cerca del borde izquierdo no abre el menú lateral.
      const menuOpen = () => page.$eval(sel('side-menu'), (e) => e.dataset.open === 'true');
      record('M0', !(await menuOpen()), `${L} A5: menú lateral cerrado al cargar`);
      const y1 = Math.min(300, v.h - 80);
      await page.touchscreen.tap(2, y1);
      await page.waitForTimeout(500);
      record('M0', !(await menuOpen()), `${L} A5: tocar en (2, ${y1}) no abre el menú`);
      await page.touchscreen.tap(4, 100);
      await page.waitForTimeout(500);
      record('M0', !(await menuOpen()), `${L} A5: tocar en (4, 100) no abre el menú`);
      const cdp = await context.newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const yA = Math.round(v.h * 0.25);
      const yB = Math.round(v.h * 0.7);
      await touch('touchStart', 6, yA);
      for (let i = 1; i <= 10; i++) {
        await touch('touchMove', 6, yA + ((yB - yA) * i) / 10);
        await page.waitForTimeout(16);
      }
      await touch('touchEnd');
      await page.waitForTimeout(600);
      record('M0', !(await menuOpen()), `${L} A5: deslizar en vertical junto al borde izquierdo no abre el menú`);
    });
  }

  await block('M0', `escritorio ${DESKTOP.w}×${DESKTOP.h}`, async (open) => {
    const { page } = await open(DESKTOP, { desktop: true });
    const L = `escritorio ${DESKTOP.w}×${DESKTOP.h} ·`;
    const vars = await cssVars(page);
    record('M0', vars.bottomNav === '0px', `${L} --bottom-nav-h = 0px (es «${vars.bottomNav}»)`);
    record('M0', vars.header !== '' && vars.headerPx > 0, `${L} --app-header-h definida («${vars.header}»)`);
    record('M0', !(await page.locator(sel('bottom-nav')).first().isVisible().catch(() => false)), `${L} A7: sin barra inferior`);
    record('M0', !(await page.locator(sel('play-setup')).first().isVisible().catch(() => false)), `${L} A7: sin tarjeta de preparación (play-setup)`);
    const menuOpen = () => page.$eval(sel('side-menu'), (e) => e.dataset.open === 'true');
    await page.mouse.move(400, 300);
    await page.mouse.move(1, 250);
    await page.waitForTimeout(400);
    record('M0', await menuOpen(), `${L} A7: acercar el ratón al borde izquierdo abre el menú`);
    await page.mouse.move(700, 250);
    await shot(page, 'M0', 'play', DESKTOP);
  });
}

// =============================================================================================
// M1 · Jugar en móvil: A1 (tarjeta de preparación), hojas, A2 (en partida), A4, A6 (horizontal), A3

async function closeSheet(page, sheetSel) {
  await page.keyboard.press('Escape');
  if (await page.locator(sheetSel).first().waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false)) return 'Escape';
  const vw = page.viewportSize();
  await page.touchscreen.tap(Math.round(vw.width / 2), 8);
  return (await page.locator(sheetSel).first().waitFor({ state: 'hidden', timeout: 1500 }).then(() => true, () => false)) ? 'tocar fuera' : null;
}

async function runM1() {
  for (const v of VARIANTS) {
    await block('M1', `${v.label} Jugar`, async (open) => {
      const { page } = await open(v);
      const L = `${v.label} ·`;
      if (!(await page.locator(m.SCREEN_MARK.play).filter({ visible: true }).count())) await goTo(page, 'play');
      await resetScroll(page);

      // A1: tarjeta de preparación y botón Jugar enteros, sin desplazarse.
      const hasSetup = await visibleSoon(page, sel('play-setup'), 3000);
      check('M1', hasSetup ? await fit(page.locator(sel('play-setup'))) : { ok: false, why: 'no existe play-setup' }, `${L} A1: tarjeta de preparación (play-setup) entera sin desplazarse`);
      check('M1', await fit(page.locator(sel('play-start'))), `${L} A1: botón Jugar (play-start) entero sin desplazarse`);
      if (hasSetup) checkSmall('M1', await smallTargets(page, sel('play-setup'), { inViewport: false }), `${L} A4: botones de la tarjeta ≥ 44 px`);
      else record('M1', false, `${L} A4: botones de la tarjeta ≥ 44 px → no existe play-setup`);
      check('M1', await noHorizontalScroll(page), `${L} A4: Jugar sin desplazamiento horizontal`);
      await shot(page, 'M1', 'setup', v);

      // Hojas de rival y de coach.
      for (const [trigger, sheet] of [['play-setup-rival', 'rival-sheet'], ['play-setup-coach', 'coach-picker-sheet']]) {
        await step('M1', `${L} ${trigger} → ${sheet}`, async () => {
          const t = page.locator(sel(trigger)).filter({ visible: true });
          if (!(await t.count())) return record('M1', false, `${L} tocar ${trigger} abre ${sheet} → no existe ${trigger}`);
          await press(t.first());
          const opened = await visibleSoon(page, sel(sheet), 3000);
          record('M1', opened, `${L} tocar ${trigger} abre ${sheet}`);
          if (!opened) return undefined;
          await page.waitForTimeout(400);
          check('M1', await fit(page.locator(sel(sheet))), `${L} ${sheet} cabe en pantalla`);
          await shot(page, 'M1', sheet, v);
          const how = await closeSheet(page, sel(sheet));
          record('M1', Boolean(how), `${L} ${sheet} se cierra${how ? ` (${how})` : ' (ni con Escape ni tocando fuera)'}`);
          await resetScroll(page);
          return undefined;
        });
      }

      // A2 / A6: en partida.
      const { usedFallback } = await m.startGame(page);
      await resetScroll(page);
      const note = usedFallback ? ' (empezada con start-game: no hay play-start)' : '';
      const board = await fit(page.locator(sel('board-frame')));
      check('M1', board, `${L} ${v.portrait ? 'A2' : 'A6'}: tablero entero sin desplazarse${note}`);
      if (v.portrait) {
        const r = await rectOf(page.locator(sel('board-frame')));
        const share = r ? r.width / v.w : 0;
        record('M1', share >= 0.94, `${L} A2: tablero de ${r ? Math.round(r.width) : 0}px = ${Math.round(share * 100)} % del ancho (mín. 94 %)`);
        for (const c of ['w', 'b']) check('M1', await fit(page.locator(sel(`player-bar-${c}`))), `${L} A2: barra de jugador ${c === 'w' ? 'blanca' : 'negra'} visible sin desplazarse`);
        const hasLine = await visibleSoon(page, sel('coach-line'), 3000);
        check('M1', hasLine ? await fit(page.locator(sel('coach-line'))) : { ok: false, why: 'no existe coach-line' }, `${L} A2: línea del coach (coach-line) visible sin desplazarse`);
        // El encabezado es de M2 (se mide allí).
        checkSmall('M1', await smallTargets(page, 'main', { exclude: 'header' }), `${L} A4: botones en pantalla durante la partida ≥ 44 px`);
      }
      // La barra inferior es de M2: si falta, se informa como M2 (PEND mientras M2 esté pendiente).
      if (await hasBottomNav(page)) check('M2', await fit(page.locator(sel('bottom-nav'))), `${L} A2: barra inferior visible durante la partida`);
      else record('M2', false, `${L} A2: barra inferior visible durante la partida → no existe bottom-nav`);
      check('M1', await noHorizontalScroll(page), `${L} A4: en partida sin desplazamiento horizontal`);
      await shot(page, 'M1', 'game', v);

      if (!v.portrait) {
        // A6: la partida es jugable en horizontal.
        await step('M1', `${L} A6: jugada e2→e4`, async () => {
          await m.playMove(page, 'e2', 'e4');
          record('M1', (await m.pieceAt(page, 'e4')) === 'wp' && (await m.pieceAt(page, 'e2')) === null, `${L} A6: se puede jugar e2→e4 tocando las casillas`);
        });
      }
    });
  }

  for (const v of A3_VARIANTS) {
    await block('M1', `${v.label} A3`, async (open) => {
      const { page } = await open(v, { alfred: 'mistakes' });
      const L = `${v.label} ·`;
      if (!(await page.locator(m.SCREEN_MARK.play).filter({ visible: true }).count())) await goTo(page, 'play');
      await m.pickLevel1(page);
      await m.startGame(page);
      const stopped = await m.provokeCoachStop(page);
      record('M1', stopped, `${L} A3: el coach se detiene tras un error (preparación de la prueba)`);
      if (!stopped) return;
      await page.waitForTimeout(800);
      await resetScroll(page);
      const hasSheet = await visibleSoon(page, sel('coach-sheet'), 3000);
      check('M1', hasSheet ? await fit(page.locator(sel('coach-sheet'))) : { ok: false, why: 'no existe coach-sheet' }, `${L} A3: hoja del coach (coach-sheet) entera sin desplazarse`);
      for (const [id, name] of [['coach-takeback', 'Retroceder'], ['coach-why-btn', '¿Por qué?'], ['coach-continue', 'Seguir']]) {
        const res = await fit(page.locator(sel(id)));
        const inside = hasSheet && (await page.locator(`${sel('coach-sheet')} ${sel(id)}`).count()) > 0;
        if (res.ok && hasSheet && !inside) Object.assign(res, { ok: false, why: 'no está dentro de coach-sheet' });
        check('M1', res, `${L} A3: botón ${name} (${id}) visible sin desplazarse`);
      }
      checkSmall('M1', await smallTargets(page, hasSheet ? sel('coach-sheet') : null).then((s) => (hasSheet ? s : ['no existe coach-sheet'])), `${L} A4: botones de la hoja del coach ≥ 44 px`);
      // El tablero sigue visible (al menos la mitad, por encima de la hoja).
      const b = await rectOf(page.locator(sel('board-frame')));
      const sheetTop = hasSheet ? (await rectOf(page.locator(sel('coach-sheet'))))?.top ?? v.h : v.h;
      const frac = b ? Math.max(0, Math.min(b.bottom, sheetTop, v.h) - Math.max(b.top, 0)) / b.height : 0;
      record('M1', frac >= 0.5, `${L} A3: el tablero sigue visible (${Math.round(frac * 100)} % a la vista, mín. 50 %)`);
      await shot(page, 'M1', 'coach-sheet', v);
    }, 150000);
  }
}

// =============================================================================================
// M2 · Barra inferior y encabezado compacto

const TAB_SCREENS = ['puzzles', 'progress', 'games', 'play'];

async function runM2() {
  for (const v of VARIANTS) {
    await block('M2', `${v.label} barra inferior`, async (open) => {
      const { page } = await open(v);
      const L = `${v.label} ·`;
      const has = await visibleSoon(page, sel('bottom-nav'), 4000);
      if (!has) {
        record('M2', false, `${L} barra inferior (bottom-nav) visible → no existe`);
        return;
      }
      const nav = await rectOf(page.locator(sel('bottom-nav')));
      record('M2', Math.abs(nav.bottom - v.h) <= 1 && nav.left <= 1 && Math.abs(nav.right - v.w) <= 1, `${L} barra inferior pegada abajo y a todo el ancho (bottom ${Math.round(nav.bottom)} = ${v.h})`);
      const vars = await cssVars(page);
      record('M2', vars.bottomNavPx >= 56 && Math.abs(vars.bottomNavPx - nav.height) <= 2, `${L} --bottom-nav-h (${vars.bottomNavPx}px) ≥ 56 y = alto de la barra (${Math.round(nav.height)}px)`);
      record('M2', !(await page.locator(sel('menu-toggle')).first().isVisible().catch(() => false)), `${L} sin botón ☰ en móvil`);
      const header = await page.evaluate(() => document.querySelector('header')?.getBoundingClientRect().height ?? null);
      record('M2', header !== null && header <= 49, `${L} encabezado compacto ≤ 48 px (${header === null ? 'sin <header>' : `${Math.round(header)}px`})`);
      const tabsOut = [];
      for (const id of ['play', 'puzzles', 'progress', 'games', 'more']) {
        const res = await fit(page.locator(sel(`bottom-nav-${id}`)));
        if (!res.ok) tabsOut.push(`bottom-nav-${id}: ${res.why}`);
      }
      record('M2', tabsOut.length === 0, `${L} las 5 pestañas (play, puzzles, progress, games, more) se ven enteras${tabsOut.length ? ` → ${tabsOut.join('; ')}` : ''}`);
      checkSmall('M2', await smallTargets(page, sel('bottom-nav')), `${L} A4: pestañas de la barra ≥ 44 px`);
      checkSmall('M2', await smallTargets(page, 'header'), `${L} A4: botones del encabezado ≥ 44 px`);
      await shot(page, 'M2', 'play', v);

      for (const screen of TAB_SCREENS) {
        await step('M2', `${L} pestaña ${screen}`, async () => {
          await press(page.locator(sel(`bottom-nav-${screen}`)));
          const arrived = await page.locator(m.SCREEN_MARK[screen]).filter({ visible: true }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
          const current = await page.getAttribute(sel(`bottom-nav-${screen}`), 'aria-current').catch(() => null);
          record('M2', arrived && current === 'page', `${L} bottom-nav-${screen} lleva a su pantalla${arrived ? '' : ' (no apareció)'} y queda aria-current="page"${current === 'page' ? '' : ` (es ${current})`}`);
          await page.waitForTimeout(300);
          check('M2', await noHorizontalScroll(page), `${L} A4: ${screen} sin desplazamiento horizontal`);
          // Nada queda tapado por la barra al desplazar hasta el final.
          const res = await page.evaluate(() => {
            const navEl = document.querySelector('[data-testid=bottom-nav]');
            const main = document.querySelector('main');
            if (!navEl || !main) return { ok: false, why: 'sin barra o sin <main>' };
            main.scrollTop = main.scrollHeight;
            document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
            const kids = [...main.children].filter((e) => {
              const s = getComputedStyle(e);
              return e.getBoundingClientRect().height > 0 && s.position !== 'fixed' && s.position !== 'absolute';
            });
            const last = kids[kids.length - 1];
            if (!last) return { ok: true };
            const bottom = last.getBoundingClientRect().bottom;
            const top = navEl.getBoundingClientRect().top;
            return { ok: bottom <= top + 1, why: `último bloque de <main> acaba en ${Math.round(bottom)} > barra en ${Math.round(top)}` };
          });
          check('M2', res, `${L} ${screen}: al desplazar hasta el final nada queda tapado por la barra`);
          await resetScroll(page);
          if (screen === 'progress') await shot(page, 'M2', screen, v);
        });
      }

      await step('M2', `${L} Más`, async () => {
        await press(page.locator(sel('bottom-nav-more')));
        const opened = await page.locator(`${sel('side-menu')}[data-open=true]`).waitFor({ timeout: 3000 }).then(() => true, () => false);
        record('M2', opened, `${L} bottom-nav-more abre el menú lateral`);
        if (opened) {
          await page.waitForTimeout(300); // animación de entrada del menú
          checkSmall('M2', (await smallTargets(page, sel('side-menu'), { min: 0 })).filter((x) => x.includes('aplastado')), `${L} el menú Más no tiene iconos aplastados`);
        }
        await shot(page, 'M2', 'more', v);
        if (opened) await page.keyboard.press('Escape');
      });
    });
  }

  await block('M2', `escritorio ${DESKTOP.w}×${DESKTOP.h}`, async (open) => {
    const { page } = await open(DESKTOP, { desktop: true });
    const L = `escritorio ${DESKTOP.w}×${DESKTOP.h} ·`;
    record('M2', !(await page.locator(sel('bottom-nav')).first().isVisible().catch(() => false)), `${L} sin barra inferior`);
    record('M2', await page.locator(sel('menu-toggle')).first().isVisible().catch(() => false), `${L} el botón ☰ sigue en escritorio`);
  });
}

// =============================================================================================
// M3 · Puzles en móvil

async function runM3() {
  for (const v of PUZZLE_VARIANTS) {
    await block('M3', `${v.label} Puzles`, async (open) => {
      const { page } = await open(v);
      const L = `${v.label} ·`;
      await m.seedPuzzle(page);
      await goTo(page, 'puzzles');
      await page.locator(sel('puzzle-trainer')).waitFor({ timeout: 8000 });
      await page.waitForTimeout(500);
      await resetScroll(page);
      check('M3', await fit(page.locator(`${sel('puzzle-trainer')} ${sel('board-frame')}`)), `${L} ${v.portrait ? 'A8' : 'A6'}: tablero del puzle entero sin desplazarse`);
      for (const [id, name] of [['puzzle-hint', 'Pista'], ['puzzle-reveal', 'Solución'], ['puzzle-next', 'Siguiente']]) {
        check('M3', await fit(page.locator(sel(id))), `${L} A8: ${name} (${id}) visible sin desplazarse`);
      }
      check('M3', await noHorizontalScroll(page), `${L} A4: Puzles sin desplazamiento horizontal`);
      const small = await page.evaluate(() => ['puzzle-hint', 'puzzle-reveal', 'puzzle-retry', 'puzzle-next'].flatMap((id) => {
        const b = document.querySelector(`[data-testid=${id}]`);
        if (!b) return [`«${id}» no existe`];
        const r = b.getBoundingClientRect();
        return r.width < 43.5 || r.height < 43.5 ? [`«${id}» ${Math.round(r.width)}×${Math.round(r.height)}`] : [];
      }));
      checkSmall('M3', small, `${L} A4: botones de acción (pista, solución, reintentar, siguiente) ≥ 44 px`);
      await shot(page, 'M3', 'puzzles', v);
      // Resolver el puzle con el dedo: el aviso de acierto no empuja el tablero fuera de la vista.
      await step('M3', `${L} resolver`, async () => {
        await m.playMove(page, 'h5', 'f7');
        await page.locator(`${sel('puzzle-trainer')}[data-status=solved]`).waitFor({ timeout: 5000 });
        await page.waitForTimeout(400);
        await resetScroll(page);
        check('M3', await fit(page.locator(`${sel('puzzle-trainer')} ${sel('board-frame')}`)), `${L} tras resolver, el tablero sigue entero sin desplazarse`);
        check('M3', await fit(page.locator(sel('puzzle-next'))), `${L} tras resolver, Siguiente (puzzle-next) visible sin desplazarse`);
      });
    });
  }
}

// =============================================================================================
// M4 · Partidas y Análisis en móvil

const BOARD_NAV = {
  es: ['Ir al inicio', 'Jugada anterior', 'Jugada siguiente', 'Ir al final'],
  en: ['Go to start', 'Previous move', 'Next move', 'Go to end'],
};

async function runM4() {
  for (const v of VARIANTS) {
    await block('M4', `${v.label} Partidas y Análisis`, async (open) => {
      const { page } = await open(v);
      const L = `${v.label} ·`;
      await goTo(page, 'games');
      check('M4', await noHorizontalScroll(page), `${L} A4: Partidas (vacía) sin desplazamiento horizontal`);
      await m.seedGames(page);
      await resetScroll(page);
      check('M4', await noHorizontalScroll(page), `${L} A4: Partidas con la lista sin desplazamiento horizontal`);
      const rows = await page.$$eval(sel('game-row'), (els) => els.slice(0, 6).map((e) => {
        const r = e.getBoundingClientRect();
        return { w: r.width, h: r.height, right: r.right };
      }));
      const badRows = rows.filter((r) => r.h < 43.5 || r.right > v.w + 1);
      record('M4', rows.length > 0 && badRows.length === 0, `${L} A8: filas de partidas tocables ≥ 44 px de alto y dentro del ancho${rows.length ? (badRows.length ? ` → ${badRows.map((r) => `${Math.round(r.w)}×${Math.round(r.h)}`).join(', ')}` : '') : ' → sin filas (game-row)'}`);
      await shot(page, 'M4', 'games', v);

      await press(page.locator(sel('game-row')).first());
      await page.locator(sel('board-frame')).filter({ visible: true }).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(600);
      await resetScroll(page);
      check('M4', await fit(page.locator(sel('board-frame'))), `${L} ${v.portrait ? 'A8' : 'A6'}: Análisis con el tablero entero sin desplazarse`);
      const navBtns = [];
      for (const name of BOARD_NAV[v.lang]) {
        const scoped = page.locator(sel('board-controls')).getByRole('button', { name, exact: true });
        const btn = (await scoped.count()) ? scoped : page.getByRole('button', { name, exact: true });
        navBtns.push(btn);
        check('M4', await fit(btn), `${L} A8: Análisis, botón «${name}» visible sin desplazarse`);
      }
      const navSmall = [];
      for (const [i, btn] of navBtns.entries()) {
        const r = await rectOf(btn);
        if (r && (r.width < 43.5 || r.height < 43.5)) navSmall.push(`«${BOARD_NAV[v.lang][i]}» ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      checkSmall('M4', navSmall, `${L} A4: botones de navegación de jugadas ≥ 44 px`);
      checkSmall('M4', (await smallTargets(page, 'main', { exclude: 'header', min: 0 })).filter((x) => x.includes('aplastado')), `${L} A4: Análisis sin iconos aplastados en los botones`);
      check('M4', await noHorizontalScroll(page), `${L} A4: Análisis sin desplazamiento horizontal`);
      await shot(page, 'M4', 'analysis', v);
      // Con Análisis abierto, la pestaña activa de la barra es Partidas (M2).
      if (await hasBottomNav(page)) {
        const current = await page.getAttribute(sel('bottom-nav-games'), 'aria-current').catch(() => null);
        record('M2', current === 'page', `${L} con Análisis abierto, la pestaña activa es Partidas (aria-current es ${current})`);
      } else record('M2', false, `${L} con Análisis abierto, la pestaña activa es Partidas → no existe bottom-nav`);
    });
  }
}

// =============================================================================================
// M5 · Progreso, Premium y diálogos

const PLANS = ['monthly', 'yearly', 'founder'];

async function runM5() {
  for (const v of VARIANTS) {
    await block('M5', `${v.label} Progreso y Premium`, async (open) => {
      const { page } = await open(v, { route: m.mockAccountApi });
      const L = `${v.label} ·`;
      await m.seedProgress(page);
      await goTo(page, 'progress');
      await page.locator(sel('progress-coverage')).waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      check('M5', await noHorizontalScroll(page), `${L} A4: Progreso (con datos) sin desplazamiento horizontal`);
      await shot(page, 'M5', 'progress', v);

      await goTo(page, 'more');
      await press(page.locator(sel('open-premium')));
      await page.locator(sel('premium-screen')).waitFor({ timeout: 5000 });
      const loaded = await page.locator(sel('premium-product-founder')).waitFor({ timeout: 5000 }).then(() => true, () => false);
      record('M5', loaded, `${L} Premium: se cargan los planes (API simulada)`);
      await page.waitForTimeout(400);
      const dlg = await rectOf(page.locator(sel('premium-screen')));
      record('M5', Boolean(dlg) && dlg.top <= 1 && dlg.left <= 1 && dlg.bottom >= v.h - 1 && dlg.right >= v.w - 1, `${L} Premium a pantalla completa${dlg ? ` ((${Math.round(dlg.left)},${Math.round(dlg.top)})→(${Math.round(dlg.right)},${Math.round(dlg.bottom)}))` : ''}`);
      check('M5', await noHorizontalScroll(page, sel('premium-screen')), `${L} A4: Premium sin desplazamiento horizontal`);
      await shot(page, 'M5', 'premium', v);
      if (!loaded) return;
      for (const plan of PLANS) {
        await step('M5', `${L} plan ${plan}`, async () => {
          const buy = page.locator(sel(`premium-buy-${plan}`));
          if (!(await buy.count())) return record('M5', false, `${L} Premium: botón del plan ${plan} → no existe premium-buy-${plan}`);
          // Se desplaza el diálogo por dentro (como haría el usuario); el documento no debe moverse.
          await buy.first().evaluate((e) => e.scrollIntoView({ block: 'nearest' }));
          await page.waitForTimeout(150);
          const res = await fit(buy);
          const docScroll = await page.evaluate(() => document.scrollingElement.scrollTop);
          if (res.ok && docScroll > 0) Object.assign(res, { ok: false, why: `el documento se desplazó ${docScroll}px` });
          check('M5', res, `${L} Premium: plan ${plan} con su botón alcanzable`);
          const r = await rectOf(buy);
          record('M5', Boolean(r) && r.height >= 43.5, `${L} A4: botón del plan ${plan} ≥ 44 px de alto (${r ? Math.round(r.height) : 0}px)`);
          return undefined;
        });
      }
      record('M5', (await page.locator(sel('premium-refund-note')).count()) === 1, `${L} Premium: se mantiene el texto de reembolsos`);
    });

    await block('M5', `${v.label} bienvenida`, async (open) => {
      const { page } = await open(v, { welcome: true });
      const L = `${v.label} ·`;
      const shown = await visibleSoon(page, sel('welcome'), 10000);
      record('M5', shown, `${L} bienvenida: aparece en la primera visita`);
      if (!shown) return;
      await page.waitForTimeout(400);
      check('M5', await fit(page.locator(sel('welcome'))), `${L} bienvenida: el diálogo cabe en pantalla`);
      const res = await fit(page.locator(sel('welcome-start')));
      const docScroll = await page.evaluate(() => document.scrollingElement.scrollTop);
      if (res.ok && docScroll > 0) Object.assign(res, { ok: false, why: `el documento está desplazado ${docScroll}px` });
      check('M5', res, `${L} bienvenida: botón principal (welcome-start) visible sin desplazar`);
      const r = await rectOf(page.locator(sel('welcome-start')));
      record('M5', Boolean(r) && r.height >= 43.5, `${L} A4: botón principal de la bienvenida ≥ 44 px de alto`);
      await shot(page, 'M5', 'welcome', v);
    });
  }

  for (const v of SUMMARY_VARIANTS) {
    await block('M5', `${v.label} resumen de fin de partida`, async (open) => {
      const { page } = await open(v);
      const L = `${v.label} ·`;
      if (!(await page.locator(m.SCREEN_MARK.play).filter({ visible: true }).count())) await goTo(page, 'play');
      await m.startGame(page);
      await m.playMove(page, 'e2', 'e4');
      await page.waitForTimeout(800);
      // Abandonar: el botón puede estar a la vista o dentro de un menú «⋯» (M1): se pulsa por el DOM.
      const abandon = page.locator(sel('abandon')).filter({ visible: true });
      if (await abandon.count()) await press(abandon.first());
      else {
        const clicked = await page.evaluate(() => {
          const b = document.querySelector('[data-testid=abandon]');
          b?.click();
          return Boolean(b);
        });
        if (!clicked) {
          record('M5', false, `${L} resumen: no se encontró el botón de abandonar (abandon)`);
          return;
        }
      }
      const shown = await page.locator(sel('game-summary')).first().waitFor({ state: 'attached', timeout: 6000 }).then(() => true, () => false);
      record('M5', shown, `${L} resumen de fin de partida: aparece al abandonar`);
      if (!shown) return;
      await page.waitForTimeout(600);
      await resetScroll(page);
      check('M5', await fit(page.locator(sel('game-summary'))), `${L} resumen: cabe en pantalla sin desplazar el documento`);
      // «Botón principal»: el de jugar otra / cerrar el resumen, el primero que exista.
      let main = null;
      for (const id of ['summary-close', 'new-game', 'play-start']) {
        if (await page.locator(sel(id)).filter({ visible: true }).count()) {
          main = id;
          break;
        }
      }
      check('M5', main ? await fit(page.locator(sel(main))) : { ok: false, why: 'sin new-game, play-start ni summary-close' }, `${L} resumen: botón principal${main ? ` (${main})` : ''} visible sin desplazar`);
      await shot(page, 'M5', 'summary', v);
    });
  }
}

// =============================================================================================

(async () => {
  const t0 = Date.now();
  browser = await chromium.launch();
  console.log(`e2e-mobile contra ${URL_BASE}${only.size ? ` · solo ${[...only].join(', ')}` : ''}${quick ? ' · rápido' : ''} · pendientes: ${[...PENDING].join(', ') || 'ninguna'}`);
  const RUNNERS = { M0: runM0, M1: runM1, M2: runM2, M3: runM3, M4: runM4, M5: runM5 };
  for (const task of TASKS) {
    if (!runs(task)) continue;
    console.log(`\n== ${task} ==`);
    await RUNNERS[task]();
  }
  await browser.close();

  let failures = 0;
  console.log(`\nResumen (${Math.round((Date.now() - t0) / 1000)} s):`);
  for (const task of TASKS) {
    const t = tally[task];
    if (!t.ok && !t.fail && !t.pend) continue;
    failures += t.fail;
    console.log(`  ${task}${PENDING.has(task) ? ' (pendiente)' : ''}: ${t.ok} OK · ${t.fail} FALLO · ${t.pend} PEND`);
  }
  console.log(failures ? `\n${failures} comprobación(es) fallaron` : '\nSin fallos (los PEND son de tareas aún pendientes)');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error('FALLO:', e);
  await browser?.close().catch(() => {});
  process.exit(1);
});
