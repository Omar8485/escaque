// Genera las imágenes de marca de public/ a partir del logo propio (src/components/Logo.jsx):
// iconos de la PWA (192/512, "maskable" y apple-touch-icon), el favicon SVG y la imagen para redes
// (Open Graph / Twitter Card, 1200×630).
// Se renderizan con Playwright (Chromium), así no entra ninguna dependencia nueva en el bundle.
// Uso: node scripts/gen-brand-images.cjs   (vuelve a escribir los PNG; súbelos al repo)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');

// Fondo crema (ink-50) y terracota oscura (brand-800): los mismos de tailwind.config.js.
const CREAM = '#faf6f0';

/** Extrae el `<g>` del logo de Logo.jsx (atributos ya en sintaxis SVG). */
function logoGroup() {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/Logo.jsx'), 'utf8');
  const m = src.match(/<g[\s\S]*?<\/g>/);
  if (!m) throw new Error('No encuentro el <g> del logo en Logo.jsx');
  return m[0];
}

/**
 * SVG del logo en un lienzo de 40×40 unidades, con el logo escalado a `scale` y centrado.
 * @param {{background?: string, scale?: number, radius?: number}} opts
 */
function logoSvg({ background = null, scale = 1, radius = 0 } = {}) {
  const offset = 20 - 20 * scale;
  const bg = background ? `<rect width="40" height="40" rx="${radius}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${bg}<g transform="translate(${offset} ${offset}) scale(${scale})">${logoGroup()}</g></svg>`;
}

const ICONS = [
  // El rombo del logo (cuadrado de 26 girado 45°) llega a 18,4 unidades del centro en un lienzo de 40.
  // "any": logo sobre transparente, casi a sangre.
  { file: 'icons/icon-192.png', size: 192, svg: logoSvg({ scale: 1.05 }) },
  { file: 'icons/icon-512.png', size: 512, svg: logoSvg({ scale: 1.05 }) },
  // "maskable": fondo opaco a sangre y logo dentro de la zona segura (círculo de radio 40 %:
  // 16 unidades ≥ 18,4 × 0,82).
  { file: 'icons/maskable-192.png', size: 192, svg: logoSvg({ background: CREAM, scale: 0.82 }) },
  { file: 'icons/maskable-512.png', size: 512, svg: logoSvg({ background: CREAM, scale: 0.82 }) },
  // iOS rellena de negro la transparencia y redondea él mismo las esquinas: fondo opaco.
  { file: 'icons/apple-touch-icon.png', size: 180, svg: logoSvg({ background: CREAM, scale: 0.95 }) },
];

(async () => {
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), `${logoSvg({ scale: 1.05 })}\n`);
  console.log('escrito public/favicon.svg');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `)}</body></html>`,
    );
    await page.screenshot({ path: path.join(OUT, icon.file), omitBackground: true });
    console.log(`escrito public/${icon.file} (${icon.size}×${icon.size})`);
  }

  // Imagen para redes: logo + nombre + lema (español, con el inglés debajo). Fuente Inter si está
  // instalada; si no, la sans-serif del sistema.
  await page.setViewportSize({ width: 1200, height: 630 });
  const checker = Array.from({ length: 8 * 8 }, (_, i) => {
    const r = Math.floor(i / 8);
    const c = i % 8;
    return `<rect x="${c * 60}" y="${r * 60}" width="60" height="60" fill="${(r + c) % 2 ? '#e8d7bf' : '#f2e8da'}"/>`;
  }).join('');
  await page.setContent(`<!doctype html><html><head><style>
    body { margin:0; width:1200px; height:630px; overflow:hidden; background:${CREAM}; font-family: Inter, 'Inter Display', system-ui, sans-serif; color:#221d19; position:relative; }
    .board { position:absolute; right:-120px; top:-60px; transform:rotate(12deg); opacity:.55; }
    .card { position:absolute; left:80px; top:0; bottom:0; display:flex; align-items:center; gap:48px; }
    h1 { margin:0; font-size:132px; font-weight:900; letter-spacing:-4px; line-height:1; }
    p { margin:22px 0 0; font-size:40px; font-weight:600; color:#4e443b; max-width:640px; line-height:1.2; }
    p.en { margin-top:14px; font-size:26px; font-weight:500; color:#857565; max-width:none; white-space:nowrap; }
    .bar { position:absolute; left:0; right:0; bottom:0; height:14px; background:#bf4b24; }
  </style></head><body>
    <svg class="board" width="480" height="480" viewBox="0 0 480 480">${checker}</svg>
    <div class="card">
      ${logoSvg({ scale: 1.05 }).replace('<svg ', '<svg width="260" height="260" ')}
      <div><h1>Escaque</h1><p>Entrena ajedrez con un coach que te detiene ante tus errores</p><p class="en">Chess training with a coach that stops you on mistakes</p></div>
    </div>
    <div class="bar"></div>
  </body></html>`);
  await page.screenshot({ path: path.join(OUT, 'og-image.png') });
  console.log('escrito public/og-image.png (1200×630)');

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
