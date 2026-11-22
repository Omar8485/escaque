import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLiveUpdates } from './liveUpdates';
afterEach(() => vi.useRealTimers());
const setup = () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const publish = vi.fn();
  return { publish, live: createLiveUpdates(publish, { now: () => Date.now() }) };
};
describe('actualizaciones de análisis en vivo', () => {
  it('agrupa ráfagas sin perder la última línea del intervalo', () => {
    const { publish, live } = setup();
    live.push({ depth: 1 });
    for (let depth = 2; depth <= 15; depth++) { vi.advanceTimersByTime(10); live.push({ depth }); }
    expect(publish.mock.calls).toEqual([[{ depth: 1 }]]);
    vi.advanceTimersByTime(60);
    expect(publish.mock.calls).toEqual([[{ depth: 1 }], [{ depth: 15 }]]);
  });
  it('el resultado final se publica inmediatamente y no lo pisa una línea provisional', () => {
    const { publish, live } = setup();
    live.push({ isFinal: false, depth: 1 });
    vi.advanceTimersByTime(20); live.push({ isFinal: false, depth: 14 });
    const result = { isFinal: true, depth: 15, bestMove: 'e2e4' };
    live.finish(result);
    expect(publish.mock.calls.at(-1)).toEqual([result]);
    vi.advanceTimersByTime(1000); live.push({ depth: 1 });
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it('cancelar por cambio de posición o desmontaje descarta líneas y finales tardíos', () => {
    const { publish, live } = setup();
    live.push('first'); live.push('queued'); live.cancel();
    vi.advanceTimersByTime(1000); live.finish('stale final'); live.push('late info');
    expect(publish.mock.calls).toEqual([['first']]);
  });
  it('un final sin info provisional también se entrega', () => {
    const { publish, live } = setup();
    live.finish('cached final');
    expect(publish.mock.calls).toEqual([['cached final']]);
  });
});
