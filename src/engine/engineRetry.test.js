import { describe, it, expect, vi, afterEach } from 'vitest';
import { StockfishEngine } from './engine.js';
import { RivalEngine } from './rival.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Worker simulado: `fail` = falla al arrancar (como una reserva de memoria rechazada). */
class FakeWorker {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.sent = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }
  postMessage(cmd) {
    this.sent.push(cmd);
    if (this.fail) {
      queueMicrotask(() => this.onerror?.({ message: 'RangeError: WebAssembly.Memory(): could not allocate memory' }));
      return;
    }
    const reply = (line) => queueMicrotask(() => this.onmessage?.({ data: line }));
    if (cmd === 'uci') reply('uciok');
    else if (cmd === 'isready') reply('readyok');
    else if (cmd.startsWith('go')) reply('info depth 15 multipv 1 score cp 20 pv e2e4\nbestmove e2e4');
  }
  terminate() {
    this.terminated = true;
  }
}

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe('StockfishEngine: reintento al arrancar (perfil de teléfono)', () => {
  it('si el primer worker falla, espera y arranca otro; lo pedido mientras tanto se resuelve', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker({ fail: true }), new FakeWorker()];
    const engine = new StockfishEngine({ createWorker: () => workers.shift(), threads: 1, retries: 1, retryDelayMs: 2000 });
    engine.start();
    const pending = engine.analyze(START, { depth: 15 });
    await flush();
    expect(engine.getStatus()).toBe('loading'); // no muestra «Error de worker» todavía
    expect(engine.getDiagnostics().lastError).toMatch(/could not allocate memory/);
    vi.advanceTimersByTime(2000);
    await flush();
    expect(engine.getStatus()).toBe('ready');
    await expect(pending).resolves.toMatchObject({ bestMove: 'e2e4', depth: 15 });
    expect(engine.getDiagnostics()).toMatchObject({ retriesUsed: 0, lastSearch: { depth: 15, multipv: 1 } });
  });

  it('sin reintentos (escritorio) falla como siempre', async () => {
    const engine = new StockfishEngine({ createWorker: () => new FakeWorker({ fail: true }), threads: 1 });
    engine.start();
    await flush();
    expect(engine.getStatus()).toBe('error');
  });

  it('agotados los reintentos queda en error; «Reintentar» (restart) vuelve a probar', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker({ fail: true }), new FakeWorker({ fail: true }), new FakeWorker()];
    const engine = new StockfishEngine({ createWorker: () => workers.shift(), threads: 1, retries: 1, retryDelayMs: 10 });
    engine.start();
    await flush();
    vi.advanceTimersByTime(10);
    await flush();
    expect(engine.getStatus()).toBe('error');
    engine.restart();
    await flush();
    expect(engine.getStatus()).toBe('ready');
  });

  it('terminate cancela un reintento pendiente', async () => {
    vi.useFakeTimers();
    const create = vi.fn(() => new FakeWorker({ fail: true }));
    const engine = new StockfishEngine({ createWorker: create, threads: 1, retries: 1, retryDelayMs: 100 });
    engine.start();
    await flush();
    engine.terminate();
    vi.advanceTimersByTime(500);
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toBe('idle');
  });
});

describe('RivalEngine: reintento al arrancar', () => {
  it('reintenta una vez y queda listo', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker({ fail: true }), new FakeWorker()];
    const rival = new RivalEngine({ createWorker: () => workers.shift(), delay: false, retries: 1, retryDelayMs: 50 });
    rival.start();
    await flush();
    expect(rival.getStatus()).toBe('loading');
    vi.advanceTimersByTime(50);
    await flush();
    expect(rival.getStatus()).toBe('ready');
  });
});
