// Prueba en el navegador de lo necesario para el lanzamiento: bienvenida (primera visita, no en la
// segunda, "Acerca de"), título, descripción, Open Graph y Twitter Card en es/en (y al cambiar de
// idioma), robots.txt, sitemap.xml e imagen para redes.
// Uso: npm run build && npx wrangler dev --port 8787   (o: npx vite preview --port 4681)
//      node scripts/e2e-launch.cjs [URL]               (por defecto http://localhost:8787/)
// Con --configured, para un build hecho con VITE_CF_ANALYTICS_TOKEN y VITE_FEEDBACK_URL: comprueba
// el script de analítica, su párrafo en la privacidad y el enlace "Enviar comentarios" (sin esa
// opción comprueba lo contrario: por defecto no hay analítica, y el enlace va a los issues del repo).
const { chromium } = require('playwright');

const CONFIGURED = process.argv.includes('--configured');
const URL_BASE = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8787/').replace(/\/?$/, '/');
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${msg}`);
  if (!ok) failures++;
};
const pngSize = (buf) => (buf.readUInt32BE(12) === 0x49484452 ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);

const head = (page) =>
  page.evaluate(() => {
    const m = (sel) => document.querySelector(sel)?.getAttribute('content') ?? null;
    return {
      lang: document.documentElement.lang,
      title: document.title,
      description: m('meta[name="description"]'),
      ogTitle: m('meta[property="og:title"]'),
      ogDescription: m('meta[property="og:description"]'),
      ogImage: m('meta[property="og:image"]'),
      ogUrl: m('meta[property="og:url"]'),
      ogLocale: m('meta[property="og:locale"]'),
      twCard: m('meta[name="twitter:card"]'),
      twTitle: m('meta[name="twitter:title"]'),
      twImage: m('meta[name="twitter:image"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    };
  });

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // --- Bienvenida ---
  {
    const ctx = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    const welcome = page.locator('[data-testid=welcome]');
    check(await welcome.waitFor({ timeout: 15000 }).then(() => true).catch(() => false), 'primera visita: aparece la bienvenida');
    const text = await welcome.textContent();
    check(/Bienvenido a Escaque/.test(text) && /coach/i.test(text) && /10 rivales/.test(text) && /Lichess/.test(text) && /Chess\.com/.test(text) && /sin cuenta/.test(text),
      'la bienvenida explica coach, 10 rivales, importación, progreso y "sin cuenta"');
    check((await page.locator('[data-testid=welcome-start]').textContent()).includes('Empezar a jugar'), 'botón "Empezar a jugar"');
    await page.click('[data-testid=welcome-import]');
    check((await welcome.count()) === 0, '"Importar mis partidas" cierra la bienvenida');
    check(/Mis partidas/.test(await page.locator('header h2').first().textContent()), '… y abre Mis partidas');
    await page.reload();
    await page.mouse.move(600, 300);
    await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    check((await welcome.count()) === 0, 'segunda visita: sin bienvenida');
    await page.click('[data-testid=menu-toggle]');
    await page.click('[data-testid=menu-about]');
    check(await welcome.waitFor({ timeout: 5000 }).then(() => true).catch(() => false), '"Acerca de Escaque" en el menú la vuelve a mostrar');
    await page.keyboard.press('Escape');
    check((await welcome.count()) === 0, 'Esc la cierra');
    await page.click('[data-testid=menu-toggle]');
    await page.click('[data-testid=menu-about]');
    await page.click('[data-testid=welcome-start]');
    check(/Entrenamiento/.test(await page.locator('header h2').first().textContent()) && (await welcome.count()) === 0, '"Empezar a jugar" lleva a Entrenar');
    await ctx.close();

    // Inglés y móvil: textos traducidos y sin desbordar.
    const en = await browser.newContext({ locale: 'en-US', viewport: { width: 360, height: 640 } });
    const p2 = await en.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(URL_BASE);
    const w2 = p2.locator('[data-testid=welcome]');
    await w2.waitFor({ timeout: 15000 });
    const t2 = await w2.textContent();
    check(/Welcome to Escaque/.test(t2) && /Start playing/.test(t2) && /Import my games/.test(t2) && !/[¿¡ñáéíóú]/.test(t2), 'en: bienvenida en inglés');
    const box = await w2.boundingBox();
    check(box.x >= 0 && box.x + box.width <= 360 && (await p2.evaluate(() => document.documentElement.scrollWidth <= 360)), `360 px: la tarjeta cabe (${Math.round(box.width)} px de ancho)`);
    await p2.click('[data-testid=welcome-start]').catch(() => {});
    check((await w2.count()) === 0, '360 px: "Start playing" es pulsable');
    await en.close();
  }

  // --- Meta etiquetas por idioma ---
  const seen = {};
  for (const [locale, lang] of [['es-ES', 'es'], ['en-US', 'en']]) {
    const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    await page.waitForFunction((l) => document.documentElement.lang === l && document.title.includes('—'), lang);
    const h = await head(page);
    seen[lang] = h;
    const titleRe = lang === 'es' ? /entrenador de ajedrez/i : /chess trainer/i;
    check(titleRe.test(h.title), `${lang}: <title> "${h.title}"`);
    check(!!h.description && h.description.length >= 80 && h.description.length <= 240, `${lang}: meta description (${h.description?.length} caracteres)`);
    check(h.ogTitle === h.title && h.twTitle === h.title, `${lang}: og:title y twitter:title = título`);
    check(h.ogDescription === h.description, `${lang}: og:description = description`);
    check(h.ogLocale === (lang === 'es' ? 'es_ES' : 'en_US'), `${lang}: og:locale ${h.ogLocale}`);
    check(h.twCard === 'summary_large_image', `${lang}: twitter:card summary_large_image`);
    check(/^https?:\/\/[^%]+\/og-image\.png$/.test(h.ogImage) && h.twImage === h.ogImage, `${lang}: og:image absoluta ${h.ogImage}`);
    check(/^https?:\/\/[^%]+\/$/.test(h.canonical) && h.ogUrl === h.canonical, `${lang}: canonical = og:url = ${h.canonical}`);
    await ctx.close();
  }
  check(seen.es.title !== seen.en.title && seen.es.description !== seen.en.description, 'es y en tienen título y descripción distintos');

  // Cambiar de idioma en el menú actualiza el título sin recargar.
  {
    const ctx = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    await page.click('[data-testid=menu-toggle]');
    await page.selectOption('[data-testid=lang-select]', 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    const h = await head(page);
    check(h.title === seen.en.title && h.description === seen.en.description, `al elegir English en el menú: "${h.title}"`);
    check((await page.evaluate(() => document.querySelector('link[rel=manifest]').getAttribute('href'))) === '/manifest.en.webmanifest', 'al elegir English: manifiesto en inglés');
    await ctx.close();
  }

  // --- robots.txt, sitemap.xml e imagen para redes ---
  const req = (await browser.newContext()).request;
  const robots = await req.get(`${URL_BASE}robots.txt`);
  const robotsText = await robots.text();
  check(robots.ok() && /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robotsText), `robots.txt con Sitemap (${robotsText.match(/Sitemap: (\S+)/)?.[1]})`);
  const sitemap = await req.get(`${URL_BASE}sitemap.xml`);
  const sitemapText = await sitemap.text();
  check(sitemap.ok() && sitemapText.includes('<urlset') && sitemapText.includes(`${seen.es.canonical}</loc>`), 'sitemap.xml con la URL pública');
  const og = await req.get(`${URL_BASE}og-image.png`);
  const ogSize = og.ok() ? pngSize(await og.body()) : null;
  check(ogSize?.w === 1200 && ogSize?.h === 630, `og-image.png 1200×630 (${ogSize ? `${ogSize.w}×${ogSize.h}` : og.status()})`);

  // --- Páginas legales (versión 1.0, vigentes: sin marca de borrador, con responsable y correo) ---
  for (const [file, title, version] of [
    ['privacidad.html', /Política de privacidad/, /Versión 1\.0 · Vigente desde el 7 de noviembre de 2026/],
    ['privacy.html', /Privacy policy/, /Version 1\.0 · Effective from 7 November 2026/],
    ['terminos.html', /Términos de uso/, /Versión 1\.0 · Vigente desde el 7 de noviembre de 2026/],
    ['terms.html', /Terms of use/, /Version 1\.0 · Effective from 7 November 2026/],
  ]) {
    const r = await req.get(URL_BASE + file);
    const html = await r.text();
    check(r.ok() && title.test(html) && version.test(html), `${file}: accesible, título y versión 1.0 vigente`);
    check(!/Borrador|Draft|pendiente de revisión|pending legal review|<mark>|%CONTACT_EMAIL%/.test(html), `${file}: sin marca de borrador ni pendientes`);
    check(!html.includes('%CONTROLLER%') && /<strong>[^<]+<\/strong>, (persona natural|an individual)/.test(html) && html.includes('Quito, Ecuador') && html.includes('noindex') && html.includes('<a href="mailto:escaque.ec@gmail.com">escaque.ec@gmail.com</a>'),
      `${file}: nombre del responsable y correo de contacto`);
  }
  {
    const ctx = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
    const page = await ctx.newPage();
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    await page.click('[data-testid=menu-toggle]');
    await Promise.all([page.waitForURL(/privacidad/), page.click('[data-testid=menu-privacy]')]);
    check(/Política de privacidad/.test(await page.locator('h1').textContent()), 'menú → Privacidad abre la política');
    const body = await page.locator('main').textContent();
    check(/Lichess/.test(body) && /Chess\.com/.test(body) && /clave/.test(body) && /cookies/.test(body), 'la política cubre importación, IA con tu clave y cookies');
    check(/titular de Escaque|persona natural/.test(body) && /escaque\.ec@gmail\.com/.test(body) && /16 años o más/.test(body), 'en el navegador: responsable, correo y edad mínima visibles');
    await Promise.all([page.waitForURL(/privacy/), page.click('a[hreflang=en]')]);
    check(/Privacy policy/.test(await page.locator('h1').textContent()), 'enlace a la versión en inglés');
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    await page.click('[data-testid=menu-toggle]');
    await Promise.all([page.waitForURL(/terminos/), page.click('[data-testid=menu-terms]')]);
    check(/Términos de uso/.test(await page.locator('h1').textContent()), 'menú → Términos abre los términos');
    await page.goto(`${URL_BASE}terminos.html#reembolsos`);
    check(await page.locator('#reembolsos').isVisible() && /14 días/.test(await page.locator('#reembolsos').textContent()), 'términos: ancla #reembolsos (enlace de la pantalla Premium)');
    await page.goto(`${URL_BASE}terms.html#refunds`);
    check(await page.locator('#refunds').isVisible() && /14 days/.test(await page.locator('#refunds').textContent()), 'terms: anchor #refunds');
    await ctx.close();
  }

  // --- Analítica opcional y enlace de comentarios ---
  {
    const ctx = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL_BASE);
    await page.mouse.move(600, 300);
    await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
    const beacon = await page.evaluate(() => document.querySelector('script[src*="cloudflareinsights"]')?.getAttribute('data-cf-beacon') ?? null);
    check(CONFIGURED ? /"token"/.test(beacon || '') : beacon === null, CONFIGURED ? `analítica activada: script con token (${beacon})` : 'por defecto: sin script de analítica');
    check(await page.evaluate(() => crossOriginIsolated), 'con o sin analítica: crossOriginIsolated === true y motor "Listo"');
    await page.click('[data-testid=menu-toggle]');
    const fb = page.locator('[data-testid=menu-feedback]');
    // Siempre hay enlace: por defecto, los issues del repositorio público (VITE_FEEDBACK_URL lo cambia).
    const fbHref = await fb.getAttribute('href').catch(() => null)
    check((await fb.count()) === 1 && (await fb.getAttribute('target')) === '_blank' && /comentarios/.test(await fb.textContent())
      && (CONFIGURED || fbHref === 'https://github.com/Omar8485/escaque/issues'), `enlace "Enviar comentarios" → ${fbHref}`);
    const priv = await (await req.get(`${URL_BASE}privacidad.html`)).text();
    check(CONFIGURED ? /Cloudflare Web Analytics/.test(priv) && !/data-no-analytics/.test(priv) : /no usa ninguna herramienta de analítica/.test(priv) && !/Cloudflare Web Analytics/.test(priv),
      CONFIGURED ? 'la privacidad menciona Cloudflare Web Analytics' : 'la privacidad dice que no hay analítica');
    await ctx.close();
  }

  check(errors.length === 0, `sin errores de página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
