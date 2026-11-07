// Almacenamiento de la clave: recordar / no recordar / borrar, y almacenamiento roto.
import { getT } from '../i18n/core.js';
import { describe, expect, it, vi } from 'vitest';
import { AI_STORAGE_KEY, AiSettingsStore, aiStatusText } from './settings.js';

class MemoryStorage {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

const stored = (storage) => JSON.parse(storage.getItem(AI_STORAGE_KEY));

describe('AiSettingsStore', () => {
  it('sin configuración: plantillas (sin IA) y getConfig() = null', () => {
    const store = new AiSettingsStore({ storage: new MemoryStorage() });
    expect(store.getConfig()).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ configured: false, hasKey: false });
    expect(aiStatusText(store.getSnapshot())).toBe('Plantillas (sin IA)');
  });

  it('recordar: la clave queda en localStorage y sobrevive a una recarga', () => {
    const storage = new MemoryStorage();
    const store = new AiSettingsStore({ storage });
    const listener = vi.fn();
    store.subscribe(listener);
    store.save({ provider: 'anthropic', model: '', apiKey: '  sk-ant-1  ', remember: true });
    expect(listener).toHaveBeenCalled();
    expect(store.getConfig()).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5', baseUrl: '', apiKey: 'sk-ant-1' });
    expect(stored(storage).apiKey).toBe('sk-ant-1');
    expect(aiStatusText(store.getSnapshot())).toBe('IA activa · Claude · claude-haiku-5-5');
    expect(aiStatusText(store.getSnapshot(), getT('en'))).toBe('AI on · Claude · claude-haiku-5-5');
    // El snapshot de la UI no expone la clave.
    expect(JSON.stringify(store.getSnapshot())).not.toContain('sk-ant-1');

    const reloaded = new AiSettingsStore({ storage });
    expect(reloaded.getConfig()?.apiKey).toBe('sk-ant-1');
  });

  it('no recordar: la clave solo vive en memoria (no se escribe y se pierde al recargar)', () => {
    const storage = new MemoryStorage();
    const store = new AiSettingsStore({ storage });
    store.save({ provider: 'gemini', apiKey: 'AIza-secreta', remember: false });
    expect(store.getConfig()?.apiKey).toBe('AIza-secreta');
    expect(storage.getItem(AI_STORAGE_KEY)).not.toContain('AIza-secreta');
    expect(stored(storage)).toMatchObject({ provider: 'gemini', remember: false });

    const reloaded = new AiSettingsStore({ storage });
    expect(reloaded.getConfig()).toBeNull();
    expect(reloaded.getSnapshot()).toMatchObject({ provider: 'gemini', remember: false, hasKey: false });
  });

  it('pasar de recordar a no recordar borra la clave guardada', () => {
    const storage = new MemoryStorage();
    const store = new AiSettingsStore({ storage });
    store.save({ provider: 'openai', apiKey: 'sk-1', remember: true });
    store.save({ remember: false });
    expect(storage.getItem(AI_STORAGE_KEY)).not.toContain('sk-1');
    expect(store.getConfig()?.apiKey).toBe('sk-1');
  });

  it('borrar clave: desaparece de memoria y del navegador y vuelven las plantillas', () => {
    const storage = new MemoryStorage();
    const store = new AiSettingsStore({ storage });
    store.save({ provider: 'openrouter', apiKey: 'sk-or-1', remember: true });
    store.clearKey();
    expect(store.getConfig()).toBeNull();
    expect(storage.getItem(AI_STORAGE_KEY)).not.toContain('sk-or-1');
    expect(new AiSettingsStore({ storage }).getConfig()).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ provider: 'openrouter', configured: false });
  });

  it('servidor compatible sin clave: activo solo tras guardarlo', () => {
    const storage = new MemoryStorage();
    const store = new AiSettingsStore({ storage });
    store.save({ provider: 'custom', model: 'llama3.2', baseUrl: 'http://localhost:11434/v1', apiKey: '' });
    expect(store.getConfig()).toMatchObject({ provider: 'custom', model: 'llama3.2', apiKey: '' });
    expect(new AiSettingsStore({ storage }).getConfig()).toMatchObject({ provider: 'custom' });
    store.clearKey();
    expect(store.getConfig()).toBeNull();
  });

  it('almacenamiento corrupto o que lanza: no rompe, queda en memoria', () => {
    expect(new AiSettingsStore({ storage: new MemoryStorage({ [AI_STORAGE_KEY]: '{no json' }) }).getConfig()).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const store = new AiSettingsStore({ storage: throwing });
    store.save({ provider: 'gemini', apiKey: 'k' });
    expect(store.getConfig()?.apiKey).toBe('k');
    expect(new AiSettingsStore({ storage: null }).getConfig()).toBeNull();
  });
});
