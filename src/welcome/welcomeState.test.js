import { afterEach, describe, expect, it, vi } from 'vitest';
import { WELCOME_KEY, markWelcomeSeen, readWelcomeSeen } from './welcomeState.js';

describe('bienvenida vista', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('primera visita: no vista; tras marcarla, vista', () => {
    const m = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) });
    expect(readWelcomeSeen()).toBe(false);
    markWelcomeSeen();
    expect(m.get(WELCOME_KEY)).toBe('1');
    expect(readWelcomeSeen()).toBe(true);
  });
  it('sin almacenamiento no rompe (se mostraría otra vez)', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
    expect(readWelcomeSeen()).toBe(false);
    expect(() => markWelcomeSeen()).not.toThrow();
  });
});
