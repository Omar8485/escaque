import { describe, it, expect, vi } from 'vitest';
import { createWorkerTransport } from './transport';
import { StockfishEngine } from './engine';
import { RivalEngine } from './rival';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
function fakeTransport({ boot = true } = {}) {
  const lines = new Set();
  const errors = new Set();
  const emit = (line) => [...lines].forEach((fn) => fn(line));
  return {
    emit,
    fail: (error) => [...errors].forEach((fn) => fn(error)),
    send: vi.fn((cmd) => {
      if (cmd === 'uci' && boot) queueMicrotask(() => emit('uciok'));
      if (cmd === 'isready') queueMicrotask(() => emit('readyok'));
      if (cmd.startsWith('go ')) queueMicrotask(() => {
        emit('info depth 15 score cp 30 nodes 123 time 5 pv e2e4 e7e5');
        emit('bestmove e2e4 ponder e7e5');
      });
    }),
    onLine: (fn) => { lines.add(fn); return () => lines.delete(fn); },
    onError: (fn) => { errors.add(fn); return () => errors.delete(fn); },
    terminate: vi.fn(),
    listenerCount: () => lines.size + errors.size,
  };
}

describe('transporte Web Worker', () => {
  it('mantiene comandos, divide líneas, comunica errores y elimina listeners al terminar', () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const transport = createWorkerTransport({ createWorker: () => worker });
    const line = vi.fn();
    const error = vi.fn();
    const off = transport.onLine(line);
    transport.onError(error);
    transport.send('uci');
    expect(worker.postMessage).toHaveBeenCalledWith('uci');
    worker.onmessage({ data: ' uciok\n\nreadyok\r\n' });
    expect(line.mock.calls).toEqual([['uciok'], ['readyok']]);
    const failure = { message: 'worker failed' };
    worker.onerror(failure);
    expect(error).toHaveBeenCalledWith(failure);
    off();
    worker.onmessage({ data: 'ignored' });
    expect(line).toHaveBeenCalledTimes(2);
    const late = worker.onmessage;
    transport.terminate(); transport.terminate();
    late({ data: 'late' });
    transport.send('stop');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });
});

describe('motores con transporte UCI inyectado', () => {
  it('el analista conserva secuencia, profundidad, evaluación y caché', async () => {
    const transport = fakeTransport();
    const engine = new StockfishEngine({ threads: 2, hash: 32, createTransport: () => transport });
    engine.start();
    const result = await engine.analyze(FEN, { depth: 15, multipv: 1 });
    expect(transport.send.mock.calls.map(([line]) => line)).toEqual([
      'uci', 'setoption name Threads value 2', 'setoption name Hash value 32', 'isready',
      `position fen ${FEN}`, 'isready', 'go depth 15',
    ]);
    expect(result.bestMove).toBe('e2e4');
    expect(result.lines[0].score).toEqual({ type: 'cp', value: 30 });
    expect(result.depth).toBe(15);
    await engine.analyze(FEN, { depth: 15 });
    expect(transport.send.mock.calls.filter(([line]) => line.startsWith('go '))).toHaveLength(1);
    engine.terminate();
    expect(transport.listenerCount()).toBe(0);
    transport.emit('bestmove a2a3');
    expect(engine.getStatus()).toBe('idle');
  });
  it('analista y rival tienen sesiones y opciones independientes', async () => {
    const first = fakeTransport(); const second = fakeTransport();
    const analyst = new StockfishEngine({ threads: 2, hash: 32, createTransport: () => first });
    const rival = new RivalEngine({ threads: 1, hash: 16, delay: false, createTransport: () => second });
    analyst.start(); rival.start();
    const analysis = analyst.analyze(FEN);
    await rival.newGame(6);
    const move = await rival.chooseMove(FEN);
    await analysis;
    expect(move.uci).toBe('e2e4');
    expect(first.send.mock.calls).toContainEqual(['setoption name Hash value 32']);
    expect(second.send.mock.calls).toContainEqual(['setoption name Hash value 16']);
    expect(second.send.mock.calls).toContainEqual(['ucinewgame']);
    expect(first.send.mock.calls).not.toContainEqual(['ucinewgame']);
    analyst.terminate();
    expect(second.terminate).not.toHaveBeenCalled();
    rival.terminate();
  });
  it.each([StockfishEngine, RivalEngine])('reintenta con otra sesión y conserva diagnóstico (%s)', async (Engine) => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = fakeTransport({ boot: false }); const healthy = fakeTransport();
    const createTransport = vi.fn().mockReturnValueOnce(broken).mockReturnValueOnce(healthy);
    const engine = new Engine({ createTransport, retries: 1, retryDelayMs: 10 });
    try {
      engine.start();
      broken.fail({ message: 'simulated native failure' });
      expect(broken.terminate).toHaveBeenCalledOnce();
      expect(broken.listenerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10);
      expect(createTransport).toHaveBeenCalledTimes(2);
      expect(engine.getStatus()).toBe('ready');
      expect(engine.getDiagnostics().lastError).toBe('simulated native failure');
      broken.emit('bestmove a2a3');
      expect(engine.getStatus()).toBe('ready');
    } finally { engine.terminate(); warning.mockRestore(); vi.useRealTimers(); }
  });
});
