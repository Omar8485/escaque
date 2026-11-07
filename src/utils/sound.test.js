import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// AudioContext falso: registra los osciladores creados y sus frecuencias.
class FakeParam {
  constructor() {
    this.value = 0;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push(['exp', v, t]);
  }
}
class FakeNode {
  connect(n) {
    return n;
  }
}
class FakeContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.destination = new FakeNode();
    this.oscillators = [];
    FakeContext.last = this;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    const o = Object.assign(new FakeNode(), { frequency: new FakeParam(), start: vi.fn(), stop: vi.fn() });
    this.oscillators.push(o);
    return o;
  }
}

describe('campanillas', () => {
  let sound;
  beforeEach(async () => {
    vi.resetModules();
    globalThis.AudioContext = FakeContext;
    sound = await import('./sound.js');
  });
  afterEach(() => {
    delete globalThis.AudioContext;
  });

  const fundamentals = () =>
    FakeContext.last.oscillators.map((o) => o.frequency.events[0][1]).filter((_, i) => i % 4 === 0);

  it('la de inicio son dos notas ascendentes', () => {
    sound.playGameStartSound();
    expect(FakeContext.last.oscillators).toHaveLength(2 * 4);
    expect(fundamentals()).toEqual(sound.CHIMES.start.notes);
    expect(sound.CHIMES.start.notes[1]).toBeGreaterThan(sound.CHIMES.start.notes[0]);
  });

  it('la de fin son tres notas descendentes, distinta de la de inicio', () => {
    sound.playGameEndSound();
    expect(FakeContext.last.oscillators).toHaveLength(3 * 4);
    const notes = fundamentals();
    expect(notes).toEqual(sound.CHIMES.end.notes);
    expect([...notes].sort((a, b) => b - a)).toEqual(notes);
  });

  it('con el contexto suspendido espera a reanudarlo', async () => {
    sound.unlockAudio();
    FakeContext.last.state = 'suspended';
    sound.playGameStartSound();
    expect(FakeContext.last.oscillators).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeContext.last.oscillators).toHaveLength(8);
  });

  it('cada parcial se apaga (stop) tras su caída', () => {
    sound.playChime('end');
    for (const o of FakeContext.last.oscillators) expect(o.stop).toHaveBeenCalledTimes(1);
  });
});
