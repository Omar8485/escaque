// Genera puzles en Node a partir de un archivo de partidas, con el mismo núcleo que usa el
// navegador (src/puzzles/generator/core.js). Sirve para regenerar a mano, medir y comparar.
//
//   node scripts/build-puzzles.mjs <partidas.pgn|partidas.json> --user jugador_demo
//        [--depth 12] [--deep 16] [--limit N] [--threads N] [--out puzzles-node.json] [--no-cache]
//
// Entrada: PGN con varias partidas, JSON con `Game[]` (src/storage/db.js) o el formato antiguo
// de partidas.json (campos en español). Se procesan de la más reciente a la más antigua.
// Salida: JSON `{ user, generatorVersion, depth, deep, stats, puzzles }` (se reescribe cada 10
// partidas, así un corte deja resultados parciales). Caché de evaluaciones en .puzzle-cache.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeEngine } from './lib/node-engine.mjs';
import { GENERATOR_DEFAULTS, GENERATOR_VERSION, addStats, analyzeGame, emptyStats, gameMeta, parseGameMoves } from '../src/puzzles/generator/core.js';
import { gamesFromText } from '../src/puzzles/generator/sources.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) positional.push(argv[i]);
  else if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) args[argv[i].slice(2)] = true;
  else args[argv[i].slice(2)] = argv[++i];
}
const INPUT = positional[0];
if (!INPUT) {
  console.error('Uso: node scripts/build-puzzles.mjs <partidas.pgn|partidas.json> --user <tu cuenta> [--depth 12] [--deep 16] [--limit N] [--out archivo.json]');
  process.exit(1);
}
const USER = args.user ?? '';
const OPTIONS = { depth: Number(args.depth ?? GENERATOR_DEFAULTS.depth), deep: Number(args.deep ?? GENERATOR_DEFAULTS.deep) };
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const THREADS = Number(args.threads ?? Math.max(1, os.cpus().length - 1));
const OUT = path.resolve(args.out ?? 'puzzles-node.json');
const CACHE = args['no-cache'] ? null : path.join(ROOT, '.puzzle-cache.json');

// ---------- Caché de la evaluación de todas las posiciones (MultiPV 1) ----------
const cache = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => CACHE && fs.writeFileSync(CACHE, JSON.stringify(cache));

function cachedAnalyzer(engine) {
  return async (fen, o) => {
    if (o.multipv !== 1) return engine.analyze(fen, o);
    const key = `${fen.split(' ').slice(0, 4).join(' ')}|${o.depth}`;
    let hit = cache[key];
    // Formato antiguo: solo la puntuación.
    if (hit && hit.type) hit = { score: hit, best: null };
    if (hit === undefined) {
      const res = await engine.analyze(fen, o);
      hit = res.lines[0] ? { score: res.lines[0].score, best: res.bestMove } : null;
      cache[key] = hit;
    }
    return hit ? { lines: [{ multipv: 1, score: hit.score, pv: hit.best ? [hit.best] : [] }], bestMove: hit.best } : { lines: [], bestMove: null };
  };
}

// ---------- Principal ----------
const games = gamesFromText(fs.readFileSync(path.resolve(INPUT), 'utf8'), { user: USER })
  .filter((g) => g.playerColor && g.variant === 'standard')
  .slice(0, LIMIT);
if (!games.length) {
  console.error(`No hay partidas de "${USER}" en ${INPUT} (¿falta --user?).`);
  process.exit(1);
}
const engine = new NodeEngine({ threads: THREADS, hash: 64 });
await engine.init();
const analyzer = cachedAnalyzer(engine);
const puzzles = [];
let stats = emptyStats();
const perGame = [];
const t0 = Date.now();
const write = (partial) =>
  fs.writeFileSync(OUT, JSON.stringify({ user: USER, generatedAt: new Date().toISOString(), partial, generatorVersion: GENERATOR_VERSION, ...OPTIONS, threads: THREADS, stats, perGame, puzzles }, null, 1));

for (const [k, game] of games.entries()) {
  const history = parseGameMoves(game.pgn);
  if (!history?.length) continue;
  const tg = Date.now();
  const res = await analyzeGame({ history, color: game.playerColor, analyzer, meta: gameMeta(game), options: OPTIONS });
  puzzles.push(...res.puzzles);
  stats = addStats(stats, res.stats);
  perGame.push({ gameId: game.id, ms: Date.now() - tg, plies: res.scores.length, puzzles: res.puzzles.length });
  if ((k + 1) % 10 === 0) {
    saveCache();
    write(true);
    console.log(`${k + 1}/${games.length} partidas · ${puzzles.length} puzles · ${((Date.now() - t0) / 60000).toFixed(1)} min · ${JSON.stringify(stats)}`);
  }
}

saveCache();
write(false);
console.log(JSON.stringify(stats));
console.log(`Listo: ${puzzles.length} puzles de ${games.length} partidas en ${((Date.now() - t0) / 60000).toFixed(1)} min → ${OUT}`);
engine.quit();
