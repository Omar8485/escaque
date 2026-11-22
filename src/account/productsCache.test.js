import { describe, expect, it } from 'vitest';
import { cachedTrial, readProductsCache, trialNote, trialOf, trialText, writeProductsCache } from './productsCache.js';
import { getT } from '../i18n/core.js';

class Mem {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}

const catalog = {
  products: [
    { plan: 'yearly', prices: [{ amount: 2999 }], trial: { interval: 'day', count: 7 } },
    { plan: 'monthly', prices: [{ amount: 499 }], trial: { interval: 'day', count: 7 } },
    { plan: 'founder', prices: [{ amount: 5999 }], trial: null },
  ],
  sandbox: false,
  founder: { limit: 500, remaining: 500 },
};

describe('caché del catálogo y prueba gratis', () => {
  it('guarda y lee; caduca a las 24 h; tolera basura', () => {
    const st = new Mem();
    writeProductsCache(catalog, st, 1000);
    expect(readProductsCache(st, 2000).products).toHaveLength(3);
    expect(readProductsCache(st, 1000 + 25 * 3600_000)).toBeNull();
    st.setItem('escaque:products', '{nope');
    expect(readProductsCache(st)).toBeNull();
  });

  it('trialOf valida; trialText usa el plural del idioma', () => {
    expect(trialOf({ trial: { interval: 'day', count: 7 } })).toEqual({ interval: 'day', count: 7 });
    for (const bad of [null, { interval: 'hour', count: 1 }, { interval: 'day', count: 0 }, { interval: 'day', count: 1.5 }]) expect(trialOf({ trial: bad })).toBeNull();
    expect(trialText({ interval: 'day', count: 7 }, getT('es'))).toBe('7 días gratis');
    expect(trialText({ interval: 'day', count: 1 }, getT('es'))).toBe('1 día gratis');
    expect(trialText({ interval: 'week', count: 2 }, getT('en'))).toBe('2 weeks free');
  });

  it('nota de los bloqueos Premium: con prueba conocida la menciona; sin caché, genérica', () => {
    const st = new Mem();
    expect(trialNote(getT('es'), st)).toBe('Mira los planes de Premium. Cancela cuando quieras.');
    writeProductsCache(catalog, st);
    expect(cachedTrial(st)).toEqual({ interval: 'day', count: 7 });
    expect(trialNote(getT('es'), st)).toBe('Prueba Premium: 7 días gratis. Cancela antes de que termine y no pagas nada.');
    expect(trialNote(getT('en'), st)).toBe('Try Premium: 7 days free. Cancel before it ends and you pay nothing.');
  });
});
