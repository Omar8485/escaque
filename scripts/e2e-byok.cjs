// Prueba de punta a punta de la IA opcional con la clave del usuario (BYOK).
// Uso: npm run build && npx vite preview --port 4173   y en otra terminal:
//   node scripts/e2e-byok.cjs [URL]        (por defecto http://localhost:4173/)
// Requiere Playwright con Chromium (no es dependencia del proyecto).
//
// (a) Sin clave: partida contra el rival y un error grave → el coach detiene con plantilla y no hay
//     ninguna petición a proveedores de IA.
// (b) Con Gemini simulado (page.route sobre la URL real del proveedor, respuesta con 1,5 s de
//     retraso): durante la espera el coach está "pensando" y NO aparece la plantilla antes que la
//     IA; el comentario aparece marcado como IA; el selector alterna IA ↔ plantilla y se recuerda;
//     "¿Por qué?" llega en la misma llamada con la línea de Stockfish y el mini tablero avanza;
//     el panel de IA muestra el consumo; si la respuesta menciona una jugada no permitida, cae a la
//     plantilla.
// (c) "Probar conexión" con un 401 simulado de Anthropic muestra un error claro; el panel de IA se
//     pliega al guardar y se despliega/pliega a voluntad (estado recordado).
// (d) 0 errores de consola en (a)–(c).
// Extra: COEP require-corp no bloquea fetch con CORS a otro origen (servidor local en otro
// puerto), sí bloquea uno sin cabeceras CORS; y "Probar conexión" real contra ese servidor.
const http = require('node:http');
const { chromium } = require('playwright');
const { skipWelcome } = require('./lib/welcome.cjs');
const { Chess } = require('chess.js');

const URL_BASE = process.argv[2] || 'http://localhost:4173/';
const MOCK_PORT = 8899;
const PROVIDER_HOSTS = ['generativelanguage.googleapis.com', 'api.openai.com', 'api.anthropic.com', 'openrouter.ai', `127.0.0.1:${MOCK_PORT}`];
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK ' : 'FALLO'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// Servidor "compatible con OpenAI" en otro origen: /cors responde con CORS, /nocors sin él.
function startMockServer() {
  const server = http.createServer((req, res) => {
    const cors = req.url.startsWith('/cors/');
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'mock-local', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

/** Respuesta de Gemini a partir de los hechos que envía la app (forma reducida v1.1). */
function geminiReply(coachRequest, { invalid }) {
  const san = coachRequest.classification?.moveSan;
  const allowed = new Set(coachRequest.allowedMoves);
  const bogus = ['Ke2', 'Kd2', 'Kf1', 'Qh5', 'Nf3'].find((m) => !allowed.has(m));
  const line = coachRequest.refutationLine?.san ?? [];
  const whyText = line.length ? `IA-SIMULADA-WHY: sigue la línea ${line.map((m) => `[[${m}]]`).join(' ')} y verás qué gana el rival.` : null;
  let data;
  if (coachRequest.requestType === 'hint') data = { hint: 'IA-SIMULADA: busca la jugada más activa.', tone: 'neutral' };
  else if (coachRequest.requestType === 'why') data = { comment: whyText ?? 'IA-SIMULADA-WHY: mira la respuesta del rival.', tone: 'alerta' };
  else {
    data = { comment: invalid ? `Mejor era [[${bogus}]].` : san ? `IA-SIMULADA: tras [[${san}]] tu posición empeora.` : '', tone: 'alerta', question: null };
    if (coachRequest.policy?.explainWhy) data.why = whyText;
  }
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 60 },
    modelVersion: 'gemini-3.5-flash-lite',
  };
}

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

async function newPage(browser, { aiConfig, contextOptions = {} } = {}) {
  const context = await browser.newContext({ locale: 'es-ES', viewport: { width: 1500, height: 950 }, ...contextOptions });
  await skipWelcome(context);
  if (aiConfig) {
    await context.addInitScript((cfg) => {
      try {
        if (!sessionStorage.getItem('e2e-seeded')) {
          localStorage.setItem('escaque:ia', JSON.stringify(cfg));
          sessionStorage.setItem('e2e-seeded', '1');
        }
      } catch {
        // ignorar
      }
    }, aiConfig);
  }
  const page = await context.newPage();
  const errors = [];
  const networkLogs = [];
  const providerRequests = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (process.env.E2E_DEBUG && m.type() === 'warning') console.log('   [aviso de la página]', m.text());
    if (m.type() !== 'error') return;
    // Chromium registra en consola cada respuesta HTTP ≥ 400 ("Failed to load resource"), aunque la
    // app la maneje. Las de los proveedores (p. ej. el 401 simulado de (c)) se listan aparte.
    const from = m.location()?.url ?? '';
    if (/^Failed to load resource/.test(m.text()) && PROVIDER_HOSTS.some((h) => from.includes(h))) networkLogs.push(`${m.text()} [${from}]`);
    else errors.push(m.text());
  });
  page.on('request', (r) => {
    if (PROVIDER_HOSTS.some((h) => r.url().includes(h))) providerRequests.push(`${r.method()} ${r.url()}`);
  });
  await page.goto(URL_BASE);
  await page.mouse.move(600, 300); // el puntero empieza en (0,0), sobre el borde que abre el menú
  return { context, page, errors, networkLogs, providerRequests };
}

const readFen = (page) =>
  page.evaluate(() => {
    const rows = [];
    for (let r = 8; r >= 1; r--) {
      let row = '';
      let empty = 0;
      for (const f of 'abcdefgh') {
        const el = document.querySelector(`[data-square="${f}${r}"] [data-piece]`);
        if (!el) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        const k = el.getAttribute('data-piece');
        row += k[0] === 'w' ? k[1].toUpperCase() : k[1];
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return `${rows.join('/')} w - - 0 1`;
  });
const move = async (page, uci) => {
  await page.click(`[data-square="${uci.slice(0, 2)}"]`);
  await page.click(`[data-square="${uci.slice(2, 4)}"]`);
};
const waitTurn = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno', null, { timeout: 60000 });

async function startGame(page) {
  await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.click('[data-testid=level-1]');
  await page.click('[data-testid=color-w]');
  await page.click('[data-testid=start-game]');
  await page.waitForSelector('[data-testid=coach-panel]');
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Jugada que deja una pieza en prise: material que el rival gana de inmediato (aprox.). */
function hangingGain(fen, m) {
  const c = new Chess(fen);
  c.move(m);
  let best = 0;
  for (const r of c.moves({ verbose: true })) {
    if (!r.captured) continue;
    const defended = c.attackers(r.to, 'w').length > 0;
    best = Math.max(best, VALUE[r.captured] - (defended ? VALUE[r.piece] : 0));
  }
  return best;
}

/** Juega bien (la mejor del motor) hasta poder colgar una pieza; la cuelga y espera el aviso. */
async function playBlunder(page, exclude = []) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await waitTurn(page);
    const chess = new Chess(await readFen(page));
    const legal = chess.moves({ verbose: true });
    if (process.env.E2E_DEBUG) console.log('   posición', chess.fen());
    const blunder = legal
      .filter((m) => !m.captured && m.piece !== 'k' && !exclude.includes(m.san))
      .map((m) => ({ m, gain: hangingGain(chess.fen(), m) }))
      .filter((x) => x.gain >= 3)
      .sort((a, b) => b.gain - a.gain)[0]?.m;
    if (blunder) {
      await move(page, blunder.lan);
      try {
        await page.waitForSelector('[data-testid=coach-takeback]', { timeout: 30000 });
        return blunder.san;
      } catch {
        // No lo clasificó como error (p. ej. compensación): seguir jugando.
        const label = await page.$eval('[data-testid=coach-feedback]', (e) => e.dataset.label).catch(() => '?');
        if (process.env.E2E_DEBUG) console.log('   intento', attempt, blunder.san, '→', label);
        continue;
      }
    }
    // Jugada buena: la mejor del motor (el panel la guarda oculta en data-san).
    const bestSan = await page
      .waitForFunction(() => document.querySelector('[data-testid=best-move]')?.dataset.san, null, { timeout: 30000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    const good = legal.find((m) => m.san === bestSan) ?? legal.find((m) => m.piece === 'p' && !m.captured) ?? legal[0];
    await move(page, good.lan);
    await page.waitForFunction(() => document.querySelector('[data-testid=match-state]')?.textContent === 'Tu turno' || document.querySelector('[data-testid=coach-takeback]'), null, { timeout: 60000 });
    if (await page.$('[data-testid=coach-continue]')) await page.click('[data-testid=coach-continue]');
  }
  throw new Error('no se encontró un error grave que jugar');
}

const settled = (page) =>
  page.waitForFunction(() => document.querySelector('[data-testid=coach-feedback]') && !document.querySelector('[data-testid=coach-thinking]'), null, { timeout: 15000 });
const feedback = (page) =>
  page.$eval('[data-testid=coach-feedback]', (e) => ({
    label: e.dataset.label,
    source: e.querySelector('[data-testid=coach-source]')?.dataset.source,
    text: e.querySelector('[data-testid=coach-text]')?.textContent,
  }));

async function openAiSettings(page) {
  if (!(await page.$('[data-testid=coach-prefs]'))) await page.click('[aria-label^="Preferencias de"]');
  if ((await page.getAttribute('[data-testid=ai-settings]', 'data-open')) !== 'true') await page.click('[data-testid=ai-settings-toggle]');
}
const aiOpen = (page) => page.getAttribute('[data-testid=ai-settings]', 'data-open');

(async () => {
  const server = await startMockServer();
  const browser = await chromium.launch();
  const allErrors = [];

  // ---------- (a) Sin clave ----------
  {
    const { context, page, errors, providerRequests } = await newPage(browser);
    console.log('crossOriginIsolated =', await page.evaluate(() => crossOriginIsolated));
    await startGame(page);
    check('(a) modo inicial "Plantillas (sin IA)"', (await page.textContent('[data-testid=coach-mode]')) === 'Plantillas (sin IA)');
    const san = await playBlunder(page);
    await settled(page);
    const fb = await feedback(page);
    check('(a) el coach detiene la partida tras un error grave', ['Mistake', 'Blunder'].includes(fb.label), `${san} → ${fb.label}`);
    check('(a) el aviso viene de plantilla', fb.source === 'plantilla', fb.text);
    await page.click('[data-testid=coach-why-btn]');
    await page.waitForSelector('[data-testid=coach-why-text]');
    const whyA = await page.$eval('[data-testid=coach-why]', (e) => ({ text: e.querySelector('[data-testid=coach-why-text]').textContent, source: e.querySelector('[data-testid=coach-source]')?.dataset.source, moves: e.querySelectorAll('[data-testid^=why-line-move-]').length }));
    await page.click('[data-testid=mini-next]');
    check('(a) "¿Por qué?" sin clave: plantilla con la línea y mini tablero', whyA.source === 'plantilla' && whyA.moves >= 1 && (await page.getAttribute('[data-testid=mini-board]', 'data-ply')) === '1', `${whyA.moves} jugadas · ${whyA.text}`);
    check('(a) 0 peticiones a proveedores de IA', providerRequests.length === 0, providerRequests.join(', ') || 'ninguna');
    allErrors.push(...errors);
    await context.close();
  }

  // ---------- (b) Gemini simulado, con 1,5 s de retraso ----------
  {
    const { context, page, errors, providerRequests } = await newPage(browser, {
      aiConfig: { provider: 'gemini', model: '', baseUrl: '', apiKey: 'AIza-e2e-simulada', remember: true, enabled: true },
    });
    let mode = 'valid';
    const seen = [];
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
      const body = JSON.parse(req.postData());
      const text = body.contents[0].parts[0].text;
      const coachRequest = JSON.parse(text.slice(text.indexOf('\n') + 1));
      seen.push({ type: coachRequest.requestType, why: Boolean(coachRequest.policy?.explainWhy), line: coachRequest.refutationLine?.san?.length ?? 0, key: req.headers()['x-goog-api-key'], mode, chars: body.systemInstruction.parts[0].text.length + text.length });
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 200, headers: { ...CORS_HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(geminiReply(coachRequest, { invalid: mode === 'invalid' })) }).catch(() => {});
    });
    await startGame(page);
    check('(b) modo "IA activa · Gemini · gemini-3.5-flash-lite"', (await page.textContent('[data-testid=coach-mode]')).includes('IA activa · Gemini · gemini-3.5-flash-lite'));
    const san1 = await playBlunder(page);
    // Durante la espera (1,5 s): estado "pensando", sin texto de plantilla.
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const snap = await page.evaluate(() => ({
        thinking: Boolean(document.querySelector('[data-testid=coach-thinking]')),
        source: document.querySelector('[data-testid=coach-feedback] [data-testid=coach-source]')?.dataset.source ?? null,
        text: document.querySelector('[data-testid=coach-text]')?.textContent ?? null,
      }));
      samples.push(snap);
      if (snap.source === 'ia') break;
      await page.waitForTimeout(100);
    }
    const firstText = samples.find((x) => x.text !== null);
    check('(b) durante la espera de la IA el coach está "pensando"', samples[0].thinking && samples.filter((x) => x.thinking).length >= 5, `${samples.filter((x) => x.thinking).length} muestras en "pensando" de ${samples.length}`);
    check('(b) NO aparece la plantilla antes que la IA', Boolean(firstText) && firstText.source === 'ia' && !samples.some((x) => x.source === 'plantilla'), firstText?.text);
    await settled(page);
    const fb1 = await feedback(page);
    check('(b) respuesta válida → mensaje marcado como IA', fb1.source === 'ia' && fb1.text.startsWith('IA-SIMULADA'), `${san1}: ${fb1.text}`);
    check('(b) la clave viaja solo en x-goog-api-key al proveedor', seen.length > 0 && seen.every((s) => s.key === 'AIza-e2e-simulada'));
    check('(b) el error pide el "¿Por qué?" en la misma llamada, con la línea de Stockfish', seen[0]?.why === true && seen[0].line >= 1, JSON.stringify(seen[0]));

    // Alternar IA ↔ plantilla (y se recuerda).
    await page.click('[data-testid=coach-feedback] [data-testid=coach-source-toggle]');
    const fbT = await feedback(page);
    const storedView = await page.evaluate(() => localStorage.getItem('escaque:coach-view'));
    check('(b) el selector muestra la plantilla de la misma jugada', fbT.source === 'plantilla' && !fbT.text.includes('IA-SIMULADA') && storedView === 'plantilla', fbT.text);
    await page.click('[data-testid=coach-feedback] [data-testid=coach-source-toggle]');
    const fbI = await feedback(page);
    check('(b) …y vuelve a la IA', fbI.source === 'ia' && (await page.evaluate(() => localStorage.getItem('escaque:coach-view'))) === 'ia');

    // "¿Por qué?": sin llamada extra, con la línea y el mini tablero.
    const callsBeforeWhy = seen.length;
    await page.click('[data-testid=coach-why-btn]');
    await page.waitForSelector('[data-testid=coach-why-text]');
    const why = await page.$eval('[data-testid=coach-why]', (e) => ({ text: e.querySelector('[data-testid=coach-why-text]').textContent, source: e.querySelector('[data-testid=coach-source]')?.dataset.source, moves: e.querySelectorAll('[data-testid^=why-line-move-]').length }));
    check('(b) "¿Por qué?" de la IA sin otra llamada', why.source === 'ia' && why.text.startsWith('IA-SIMULADA-WHY') && seen.length === callsBeforeWhy, why.text);
    const ply0 = await page.$eval('[data-testid=mini-board]', (e) => ({ ply: e.dataset.ply, fen: e.dataset.fen }));
    await page.click('[data-testid=mini-next]');
    const ply1 = await page.$eval('[data-testid=mini-board]', (e) => ({ ply: e.dataset.ply, fen: e.dataset.fen }));
    await page.click('[data-testid=mini-last]');
    const plyN = await page.$eval('[data-testid=mini-board]', (e) => e.dataset.ply);
    check('(b) la línea se ve y el mini tablero avanza', why.moves >= 1 && ply0.ply === '0' && ply1.ply === '1' && ply1.fen !== ply0.fen && Number(plyN) === why.moves, `${why.moves} jugadas; ply ${ply0.ply}→${ply1.ply}→${plyN}`);

    // Consumo en el panel de IA (plegado).
    await page.click('[aria-label^="Preferencias de"]');
    const usage = await page.textContent('[data-testid=ai-usage]');
    check('(b) el panel de IA muestra el consumo de la partida', /Esta partida: 1 solicitud · 900 tokens de entrada · 60 de salida · ≈ 0,0004 USD \(aprox\.\)/.test(usage), usage);
    await page.click('[aria-label^="Preferencias de"]');

    // Retroceder y otro error distinto: el "LLM" menciona una jugada no permitida → validación §5.3 → plantilla.
    mode = 'invalid';
    await page.click('[data-testid=coach-takeback]');
    const before = seen.length;
    const san2 = await playBlunder(page, [san1]);
    await settled(page);
    const fb2 = await feedback(page);
    const asked = seen.slice(before).some((s) => s.mode === 'invalid');
    if (process.env.E2E_DEBUG && !asked) {
      await page.click('[aria-label^="Preferencias de"]');
      console.log('   [debug] consumo:', await page.textContent('[data-testid=ai-usage]'), '| modo:', await page.textContent('[data-testid=coach-mode]').catch(() => '?'));
      await page.click('[aria-label^="Preferencias de"]');
    }
    check('(b) jugada no permitida en la respuesta → cae a plantilla', asked && fb2.source === 'plantilla' && !fb2.text.includes('IA-SIMULADA'), `${san2}: ${fb2.text}`);
    console.log('   peticiones al proveedor simulado:', seen.map((s) => `${s.type}${s.why ? '+why' : ''}/${s.mode} (${s.chars} car.)`).join(', '));
    console.log('   URLs:', [...new Set(providerRequests.map((u) => u.replace(/\?.*$/, '')))].join(', '));
    allErrors.push(...errors);
    await context.close();
  }

  // ---------- (c) Probar conexión con 401 ----------
  {
    const { context, page, errors, networkLogs } = await newPage(browser);
    await page.route('https://api.anthropic.com/**', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
      return route.fulfill({
        status: 401,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' }, request_id: 'req_e2e' }),
      });
    });
    await startGame(page);
    await openAiSettings(page);
    await page.selectOption('[data-testid=ai-provider]', 'anthropic');
    await page.fill('[data-testid=ai-key]', 'sk-ant-e2e-mala');
    await page.click('[data-testid=ai-test]');
    await page.waitForSelector('[data-testid=ai-test-result]', { timeout: 20000 });
    const r = await page.$eval('[data-testid=ai-test-result]', (e) => ({ ok: e.dataset.ok, kind: e.dataset.kind, text: e.textContent.trim() }));
    check('(c) 401 simulado → error claro', r.ok === 'false' && r.kind === 'auth' && /clave no es válida/.test(r.text), r.text);
    check('(c) probar no activa la IA', (await page.textContent('[data-testid=ai-status]')) === 'Plantillas (sin IA)');

    // Guardar sin recordar: el panel se pliega solo y queda la línea de resumen.
    await page.uncheck('[data-testid=ai-remember]');
    await page.click('[data-testid=ai-save]');
    const stored = await page.evaluate(() => localStorage.getItem('escaque:ia'));
    check('(c) "no recordar": la clave no queda en localStorage', !stored.includes('sk-ant-e2e-mala'), stored);
    check('(c) al guardar, el panel de IA se pliega', (await aiOpen(page)) === 'false' && !(await page.$('[data-testid=ai-key]')) && (await page.getAttribute('[data-testid=ai-settings-toggle]', 'aria-expanded')) === 'false');
    check('(c) línea de resumen "IA activa · Claude · claude-haiku-5-5"', (await page.textContent('[data-testid=ai-status]')) === 'IA activa · Claude · claude-haiku-5-5');
    await page.click('[data-testid=ai-settings-toggle]');
    const reopened = (await aiOpen(page)) === 'true' && Boolean(await page.$('[data-testid=ai-key]'));
    await page.click('[data-testid=ai-settings-toggle]');
    const reclosed = (await aiOpen(page)) === 'false';
    await page.click('[data-testid=ai-settings-toggle]');
    check('(c) el panel se despliega y pliega a voluntad; el estado se recuerda', reopened && reclosed && (await page.evaluate(() => localStorage.getItem('escaque:ia-panel'))) === 'open');
    await page.click('[data-testid=ai-clear]');
    check('(c) "Borrar clave" vuelve a plantillas', (await page.textContent('[data-testid=ai-status]')) === 'Plantillas (sin IA)');

    // COEP: "Probar conexión" REAL (sin page.route) contra un servidor compatible en otro origen con CORS.
    await page.selectOption('[data-testid=ai-provider]', 'custom');
    await page.fill('[data-testid=ai-base-url]', `http://127.0.0.1:${MOCK_PORT}/cors/v1`);
    await page.fill('[data-testid=ai-model]', 'mock-local');
    await page.click('[data-testid=ai-test]');
    await page.waitForSelector('[data-testid=ai-test-result]', { timeout: 20000 });
    const r2 = await page.$eval('[data-testid=ai-test-result]', (e) => ({ ok: e.dataset.ok, text: e.textContent.trim() }));
    check('(COEP) fetch real con CORS a otro origen funciona bajo COEP require-corp', r2.ok === 'true', r2.text);
    console.log('   registro de red del navegador (esperado, no es error de la app):', networkLogs.join(' | ') || 'ninguno');
    allErrors.push(...errors);
    await context.close();
  }

  // ---------- COEP: sin cabeceras CORS el navegador bloquea (se espera un error de consola aquí) ----------
  {
    const { context, page } = await newPage(browser);
    await page.getByText('Listo', { exact: true }).first().waitFor({ timeout: 60000 });
    const out = await page.evaluate(async (port) => {
      const call = async (path) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: '{}' });
          return `HTTP ${res.status}`;
        } catch (e) {
          return `${e.name}: ${e.message}`;
        }
      };
      return { isolated: crossOriginIsolated, cors: await call('/cors/v1/chat/completions'), nocors: await call('/nocors/v1/chat/completions') };
    }, MOCK_PORT);
    check('(COEP) página aislada (crossOriginIsolated)', out.isolated === true);
    check('(COEP) con CORS → HTTP 200; sin CORS → TypeError (CORS, no COEP)', out.cors === 'HTTP 200' && out.nocors.startsWith('TypeError'), JSON.stringify(out));
    await context.close();
  }

  // ---------- Extra: Anthropic REAL con clave inválida (solo si hay red hacia api.anthropic.com) ----------
  if (process.env.E2E_REAL_ANTHROPIC === '1') {
    // La sesión intercepta TLS con su propia CA: solo este contexto ignora errores de certificado.
    const { context, page, errors, networkLogs } = await newPage(browser, { contextOptions: { ignoreHTTPSErrors: true } });
    await startGame(page);
    await openAiSettings(page);
    await page.selectOption('[data-testid=ai-provider]', 'anthropic');
    await page.fill('[data-testid=ai-key]', 'sk-ant-invalida-de-prueba');
    await page.click('[data-testid=ai-test]');
    await page.waitForSelector('[data-testid=ai-test-result]', { timeout: 20000 });
    const r = await page.$eval('[data-testid=ai-test-result]', (e) => ({ kind: e.dataset.kind, text: e.textContent.trim() }));
    console.log('   (real) Anthropic desde el navegador con clave inválida →', r.kind, '|', r.text, '| errores de consola:', errors, '| red:', networkLogs);
    await context.close();
  }

  check('(d) 0 errores de consola en (a)–(c)', allErrors.length === 0, allErrors.join(' | ') || 'ninguno');
  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FALLO:', e);
  process.exit(1);
});
