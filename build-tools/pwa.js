// Plugin de Vite: genera dist/sw.js a partir de src/pwa/sw-template.js al terminar el build, con la
// lista de archivos a precargar y una versión ligada al contenido del build (si cambia cualquier
// archivo, cambia sw.js y el navegador ofrece la versión nueva). Sin dependencias.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const TEMPLATE = new URL('../src/pwa/sw-template.js', import.meta.url);
const PLACEHOLDER = '__ESCAQUE_SW_CONFIG__';

/** Archivos del motor: van en su propia caché, identificada por su contenido. */
export const ENGINE_FILES = ['/stockfish/stockfish.js', '/stockfish/stockfish.wasm'];

/**
 * Qué no se precarga: el propio SW, la configuración de Cloudflare, mapas de fuentes, y lo que solo
 * leen buscadores y redes sociales.
 * @param {string} path  ruta pública ('/assets/x.js')
 */
export function isExcluded(path) {
  return (
    path === '/sw.js' ||
    path === '/_headers' ||
    path === '/_redirects' ||
    path.endsWith('.map') ||
    path === '/robots.txt' ||
    path === '/sitemap.xml' ||
    path.startsWith('/og-image')
  );
}

const sha = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Lista de precarga y versión a partir de los archivos del build.
 * @param {{path: string, hash: string}[]} files  rutas públicas y hash de su contenido
 * @param {string} templateHash  hash de la plantilla del SW (cambiar su lógica también es versión nueva)
 * @returns {{build: string, shell: string[], engine: string[], engineHash: string, engineSha256: Record<string, string>}}
 */
export function precacheConfig(files, templateHash = '') {
  const kept = files.filter((f) => !isExcluded(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const engine = kept.filter((f) => ENGINE_FILES.includes(f.path));
  const shell = kept.filter((f) => !ENGINE_FILES.includes(f.path));
  const digest = (list) => sha(list.map((f) => `${f.path}:${f.hash}`).join('\n'));
  return {
    build: sha(`${digest(kept)}\n${templateHash}`).slice(0, 12),
    shell: shell.map((f) => f.path),
    engine: engine.map((f) => f.path),
    engineHash: digest(engine).slice(0, 12),
    // SHA-256 de cada archivo del motor: el SW lo comprueba al tomarlo de la caché HTTP.
    engineSha256: Object.fromEntries(engine.map((f) => [f.path, f.hash])),
  };
}

/** Contenido de sw.js con la configuración incrustada. */
export function renderServiceWorker(template, config) {
  if (!template.includes(PLACEHOLDER)) throw new Error(`La plantilla del SW no contiene ${PLACEHOLDER}`);
  return template.replace(PLACEHOLDER, JSON.stringify(config, null, 2));
}

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

/** @returns {import('vite').Plugin} */
export function escaquePwa() {
  let outDir = 'dist';
  return {
    name: 'escaque-pwa',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // closeBundle: ya están escritos el bundle y los archivos de public/ (y los ajustes de otros
    // plugins sobre ellos), así el hash refleja exactamente lo que se publica.
    closeBundle: {
      order: 'post',
      handler() {
        const files = walk(outDir).map((abs) => ({
          path: `/${relative(outDir, abs).split(sep).join('/')}`,
          hash: sha(readFileSync(abs)),
        }));
        const template = readFileSync(TEMPLATE, 'utf8');
        const config = precacheConfig(files, sha(template));
        writeFileSync(join(outDir, 'sw.js'), renderServiceWorker(template, config));
        this.info?.(`sw.js: versión ${config.build}, ${config.shell.length} archivos + motor`);
      },
    },
  };
}
