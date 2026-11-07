import { describe, it, expect, afterEach } from 'vitest';
import { readRivalVoicePref, writeRivalVoicePref } from './useRivalVoice.js';

const original = globalThis.localStorage;
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

describe('preferencia "El rival habla"', () => {
  afterEach(() => {
    globalThis.localStorage = original;
  });

  it('por defecto habla; se guarda y se lee', () => {
    globalThis.localStorage = memoryStorage();
    expect(readRivalVoicePref()).toBe(true);
    writeRivalVoicePref(false);
    expect(globalThis.localStorage.getItem('escaque:rival-voice')).toBe('off');
    expect(readRivalVoicePref()).toBe(false);
    writeRivalVoicePref(true);
    expect(readRivalVoicePref()).toBe(true);
  });

  it('con el almacenamiento roto no falla (habla por defecto)', () => {
    globalThis.localStorage = {
      getItem() {
        throw new Error('bloqueado');
      },
      setItem() {
        throw new Error('bloqueado');
      },
    };
    expect(readRivalVoicePref()).toBe(true);
    expect(() => writeRivalVoicePref(false)).not.toThrow();
    globalThis.localStorage = undefined;
    expect(readRivalVoicePref()).toBe(true);
  });
});
