// Prueba en el navegador de los idiomas (docs/I18N.md).
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal
//   node scripts/e2e-i18n.cjs [URL] [carpeta-capturas]
// Comprueba: navegador en inglés → inglés; en español → español; en otro idioma (francés) →
// inglés; <html lang> sigue al idioma; el selector del menú cambia el idioma al momento y se
// recuerda al recargar (localStorage `escaque:lang`); "Automático" vuelve al del navegador y borra
// la clave; en inglés, ninguna pestaña muestra texto con caracteres españoles (salvo nombres
// propios: rivales, coaches, "Español" en el selector); 0 errores de consola.
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');

const URL_BASE = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || null;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};

// Nombres propios con tilde que pueden verse en inglés.
const PROPER = /(Kairós|Ícaro|Jasón|Héctor|Español)/g; // sin \b: no funciona con la Í inicial
const TABS = ['practice', 'puzzles', 'games', 'analysis', 'progress'];
// Caracteres españoles o palabras que solo existen en español (sin tilde no las vería la regla anterior).
const SPANISH = /[¿¡ñáéíóú]|\b(partidas?|jugadas?|blancas|negras|tablas|pistas?|entrenar|nuevas?|nivel|empezar|abandonar|pausa|girar|reiniciar|tu turno|juegas|ganas|pierdes|derrotas?|victorias?|importar|generar|cargando|aún|todavía|ningun[oa]|con el|de la|del)\b/i;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (locale) => {
    const context = await browser.newContext({ locale, viewport: { width: 1280, height: 800 } });
    await skipWelcome(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${locale}: ${e}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${locale}: ${m.text()}`));
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    await page.getByText(/^(Listo|Ready)$/).first().waitFor({ timeout: 60000 });
    return { context, page };
  };
  const heading = (page) => page.textContent('h1, h2').then((s) => s.trim());
  const htmlLang = (page) => page.evaluate(() => document.documentElement.lang);
  const nav = async (page, id) => {
    await page.click('[data-testid=menu-toggle]');
    await page.click(`[data-testid=nav-${id}]`);
    await page.waitForTimeout(300);
  };
  const setLang = async (page, value) => {
    await page.click('[data-testid=menu-toggle]');
    await page.selectOption('[data-testid=lang-select]', value);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  };
  /** Textos visibles (y etiquetas accesibles) con caracteres españoles, sin nombres propios. */
  const spanishLeftovers = (page) =>
    page.evaluate(([properSrc, spanishSrc]) => {
      const proper = new RegExp(properSrc, 'g');
      const spanish = new RegExp(spanishSrc, 'i');
      const out = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[aria-hidden=true], option, script, style') || !el.getClientRects().length) continue;
        const s = n.textContent.replace(proper, '').trim();
        if (spanish.test(s)) out.add(s.slice(0, 80));
      }
      for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
        if (!el.getClientRects().length) continue;
        for (const a of ['aria-label', 'title', 'placeholder']) {
          const s = (el.getAttribute(a) ?? '').replace(proper, '');
          if (spanish.test(s)) out.add(`[${a}] ${s.slice(0, 80)}`);
        }
      }
      return [...out];
    }, [PROPER.source, SPANISH.source]);

  // 1. Detección por el navegador
  {
    const { context, page } = await open('en-US');
    check((await htmlLang(page)) === 'en', `en-US → <html lang="${await htmlLang(page)}">`);
    check((await heading(page)) === 'Training', `en-US → título "${await heading(page)}"`);
    check((await page.evaluate(() => localStorage.getItem('escaque:lang'))) === null, 'en-US: sin preferencia guardada (Automático)');

    // 2. Barrido de pestañas en inglés (sin partidas importadas: estados vacíos y Entrenar)
    for (const tab of TABS) {
      await nav(page, tab);
      const left = await spanishLeftovers(page);
      check(left.length === 0, `en: pestaña ${tab} sin texto en español${left.length ? ` → ${JSON.stringify(left)}` : ''}`);
      if (OUT) await page.screenshot({ path: `${OUT}/en-${tab}.png` });
    }
    // Una partida en marcha (rival, coach, relojes) también en inglés.
    await nav(page, 'practice');
    await page.click('[data-testid=level-5]');
    await page.click('[data-testid=color-w]');
    await page.click('[data-testid=start-game]');
    await page.waitForTimeout(800);
    const leftGame = await spanishLeftovers(page);
    check(leftGame.length === 0, `en: partida en curso sin texto en español${leftGame.length ? ` → ${JSON.stringify(leftGame)}` : ''}`);
    if (OUT) await page.screenshot({ path: `${OUT}/en-partida.png` });

    // 3. El selector cambia al momento y se recuerda
    await setLang(page, 'es');
    check((await htmlLang(page)) === 'es', 'selector → Español: <html lang="es"> al momento');
    check((await page.textContent('main')).includes('Juegas') || (await heading(page)) === 'Entrenamiento', `selector → Español: textos en español ("${await heading(page)}")`);
    check((await page.evaluate(() => localStorage.getItem('escaque:lang'))) === 'es', 'la elección se guarda (escaque:lang=es)');
    await page.reload();
    await page.mouse.move(600, 300);
    await page.getByText(/^(Listo|Ready)$/).first().waitFor({ timeout: 60000 });
    check((await htmlLang(page)) === 'es' && (await heading(page)) === 'Entrenamiento', 'tras recargar sigue en español');
    await setLang(page, 'auto');
    check((await htmlLang(page)) === 'en' && (await heading(page)) === 'Training', 'Automático vuelve al idioma del navegador (inglés)');
    check((await page.evaluate(() => localStorage.getItem('escaque:lang'))) === null, 'Automático borra la preferencia');
    await context.close();
  }

  // 4. Navegador en español y en otro idioma
  {
    const { context, page } = await open('es-ES');
    check((await htmlLang(page)) === 'es' && (await heading(page)) === 'Entrenamiento', `es-ES → español ("${await heading(page)}")`);
    await context.close();
  }
  {
    const { context, page } = await open('fr-FR');
    check((await htmlLang(page)) === 'en' && (await heading(page)) === 'Training', `fr-FR → inglés ("${await heading(page)}")`);
    await context.close();
  }

  check(errors.length === 0, `sin errores de consola${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FALLO(S)` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
