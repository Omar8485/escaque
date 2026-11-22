import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPhoneLike, engineProfile, PHONE_ENGINE_URL, PHONE_ENGINE_WORKER_URL, DESKTOP_ENGINE_URL, PHONE_ENGINE_MAX_MB } from './deviceProfile.js';
import { ENGINE_FILES } from '../../build-tools/pwa.js';

const A13 = 'Mozilla/5.0 (Linux; Android 14; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC = IPAD;

describe('isPhoneLike', () => {
  it('teléfonos y tabletas', () => {
    expect(isPhoneLike({ userAgent: A13 })).toBe(true);
    expect(isPhoneLike({ userAgent: IPHONE })).toBe(true);
    expect(isPhoneLike({ userAgent: IPAD, maxTouchPoints: 5 })).toBe(true);
    expect(isPhoneLike({ userAgent: WIN, uaDataMobile: true })).toBe(true);
    expect(isPhoneLike({ userAgent: 'Mozilla/5.0 (Linux; Android 13; Tab)' })).toBe(true);
  });

  it('el escritorio no cambia: PC, Mac y portátiles táctiles con touchpad', () => {
    expect(isPhoneLike({ userAgent: WIN })).toBe(false);
    expect(isPhoneLike({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
    expect(isPhoneLike({ userAgent: WIN, maxTouchPoints: 10, coarsePointer: false, finePointer: true })).toBe(false);
    expect(isPhoneLike({ userAgent: WIN, maxTouchPoints: 10, coarsePointer: true, finePointer: true })).toBe(false);
    expect(isPhoneLike({})).toBe(false);
  });

  it('pantalla solo táctil sin UA móvil', () => {
    expect(isPhoneLike({ userAgent: WIN, maxTouchPoints: 5, coarsePointer: true, finePointer: false })).toBe(true);
  });
});

describe('engineProfile', () => {
  it('teléfono: motor con tope de memoria, un reintento y rival diferido', () => {
    expect(engineProfile({ userAgent: A13 })).toEqual({
      phone: true,
      analyst: { url: PHONE_ENGINE_WORKER_URL, retries: 1 },
      rival: { url: PHONE_ENGINE_WORKER_URL, retries: 1 },
      lazyRival: true,
    });
  });

  it('escritorio: exactamente lo de siempre', () => {
    expect(engineProfile({ userAgent: WIN })).toEqual({
      phone: false,
      analyst: { url: DESKTOP_ENGINE_URL, retries: 0 },
      rival: { url: DESKTOP_ENGINE_URL, retries: 0 },
      lazyRival: false,
    });
  });
});

describe('stockfish-movil.js', () => {
  const read = (f) => readFileSync(fileURLToPath(new URL(`../../public/stockfish/${f}`, import.meta.url)), 'utf8');
  it('es stockfish.js con SOLO el máximo de memoria compartida cambiado (2 GB → 512 MB)', () => {
    const original = read('stockfish.js');
    const movil = read('stockfish-movil.js');
    const pages = (PHONE_ENGINE_MAX_MB * 1024 * 1024) / 65536;
    expect(original.split('maximum:32768,shared:!0').length).toBe(2); // aparece una sola vez
    expect(movil).toBe(original.replace('maximum:32768,shared:!0', `maximum:${pages},shared:!0`));
  });

  it('el worker carga el stockfish.wasm de siempre (si no, buscaría stockfish-movil.wasm)', () => {
    expect(PHONE_ENGINE_WORKER_URL).toBe('/stockfish/stockfish-movil.js#%2Fstockfish%2Fstockfish.wasm');
    expect(decodeURIComponent(PHONE_ENGINE_WORKER_URL.split('#')[1].split(',')[0])).toBe('/stockfish/stockfish.wasm');
  });

  it('la PWA lo guarda para usarlo sin conexión', () => {
    expect(ENGINE_FILES).toContain(PHONE_ENGINE_URL);
  });
});
