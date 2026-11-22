// Stockfish WASM del repo (public/stockfish) como proceso de Node, con la interfaz de analizador
// del generador de puzles: `analyze(fen, {depth, multipv})` → `{lines, bestMove}` (blancas).
// Lo usan scripts/build-puzzles.mjs y la validación de scripts/e2e-puzzles.cjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInfo, parseBestMove, toWhitePerspective } from '../../src/engine/uci.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class NodeEngine {
  /** @param {{threads?:number, hash?:number}} [o] */
  constructor({ threads = Math.max(1, os.cpus().length - 1), hash = 64 } = {}) {
    this.threads = threads;
    this.hash = hash;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'escaque-sf-'));
    fs.copyFileSync(path.join(ROOT, 'public/stockfish/stockfish.wasm'), path.join(dir, 'stockfish.wasm'));
    // El paquete es "type": "module": el motor (CommonJS) necesita extensión .cjs.
    fs.copyFileSync(path.join(ROOT, 'public/stockfish/stockfish.js'), path.join(dir, 'stockfish.cjs'));
    this.proc = spawn(process.execPath, [path.join(dir, 'stockfish.cjs')], { cwd: dir });
    this.buf = '';
    this.listener = null;
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      const lines = this.buf.split('\n');
      this.buf = lines.pop();
      for (const l of lines) this.listener?.(l.trim());
    });
  }
  send(cmd) {
    this.proc.stdin.write(`${cmd}\n`);
  }
  waitFor(pred) {
    return new Promise((resolve) => {
      this.listener = (l) => {
        if (pred(l)) {
          this.listener = null;
          resolve(l);
        }
      };
    });
  }
  async init() {
    const ok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await ok;
    this.send(`setoption name Threads value ${this.threads}`);
    this.send(`setoption name Hash value ${this.hash}`);
    await this.ready();
  }
  async ready() {
    const r = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await r;
  }
  /** Analizador para el núcleo: `{lines, bestMove}`, puntuaciones de blancas. Una búsqueda a la vez. */
  async analyze(fen, { depth, multipv = 1 }) {
    const turn = fen.split(' ')[1];
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    await this.ready();
    const lines = new Map();
    let bestMove = null;
    const done = new Promise((resolve) => {
      this.listener = (l) => {
        if (l.startsWith('info')) {
          const info = parseInfo(l);
          if (info && !info.bound && info.pv?.length) {
            lines.set(info.multipv, { multipv: info.multipv, score: toWhitePerspective(info.score, turn), pv: info.pv });
          }
        } else {
          const best = parseBestMove(l);
          if (best) {
            bestMove = best.bestMove;
            this.listener = null;
            resolve();
          }
        }
      };
    });
    this.send(`go depth ${depth}`);
    await done;
    return { lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv), bestMove };
  }
  quit() {
    this.send('quit');
    setTimeout(() => this.proc.kill(), 500);
  }
}
