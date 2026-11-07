import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DICTIONARIES, LANG_KEY, createT, detectLang, flatten, formatDuration, formatNumber, getT,
  interpolate, isPluralNode, readLangPref, resolveLang, writeLangPref,
} from './core.js';

describe('detectLang', () => {
  it('toma el primer idioma soportado de la lista del navegador', () => {
    expect(detectLang(['es-EC', 'en-US'])).toBe('es');
    expect(detectLang(['en-GB', 'es'])).toBe('en');
    expect(detectLang(['fr-FR', 'es-MX', 'en'])).toBe('es');
    expect(detectLang(['ES_es'])).toBe('es');
  });
  it('sin coincidencias (o sin datos) cae al inglés', () => {
    expect(detectLang(['fr-FR', 'de'])).toBe('en');
    expect(detectLang([])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
  it('la elección manual manda sobre el navegador', () => {
    expect(resolveLang('es', ['en-US'])).toBe('es');
    expect(resolveLang('en', ['es-EC'])).toBe('en');
    expect(resolveLang('auto', ['es-EC'])).toBe('es');
    expect(resolveLang('auto', ['fr-FR'])).toBe('en');
  });
});

describe('preferencia guardada', () => {
  afterEach(() => vi.unstubAllGlobals());
  const fakeStorage = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
  };
  it('guarda es/en y borra la clave en automático', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    expect(readLangPref()).toBe('auto');
    writeLangPref('en');
    expect(s.m.get(LANG_KEY)).toBe('en');
    expect(readLangPref()).toBe('en');
    writeLangPref('auto');
    expect(s.m.has(LANG_KEY)).toBe(false);
    expect(readLangPref()).toBe('auto');
  });
  it('sin almacenamiento (o si lanza) no rompe nada', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } });
    expect(readLangPref()).toBe('auto');
    expect(() => writeLangPref('es')).not.toThrow();
  });
});

describe('t', () => {
  it('traduce por clave con espacio de nombres e interpola variables', () => {
    expect(createT('es')('lang.auto')).toBe('Automático');
    expect(createT('en')('lang.auto')).toBe('Automatic');
    expect(createT('en')('lang.autoHint', { lang: 'English' })).toBe('Automatic (English)');
  });
  it('clave inexistente devuelve la clave; idioma desconocido usa inglés', () => {
    expect(createT('es')('no.existe')).toBe('no.existe');
    expect(createT('fr')('lang.auto')).toBe('Automatic');
  });
  it('plurales con Intl.PluralRules', () => {
    expect(createT('es')('common.moves', { n: 1 })).toBe('1 jugada');
    expect(createT('es')('common.moves', { n: 3 })).toBe('3 jugadas');
    expect(createT('es')('common.moves', { n: 1_000_000 })).toBe('1000000 jugadas'); // 'many' → other
    expect(createT('en')('common.moves', { n: 1 })).toBe('1 move');
    expect(createT('en')('common.moves', { n: 0 })).toBe('0 moves');
  });
  it('getT reutiliza el traductor', () => {
    expect(getT('en')).toBe(getT('en'));
    expect(getT('en').lang).toBe('en');
  });
  it('interpolate deja intactos los marcadores sin valor', () => {
    expect(interpolate('{a} y {b}', { a: 1 })).toBe('1 y {b}');
  });
});

describe('formatos Intl', () => {
  it('números según el idioma', () => {
    expect(formatNumber('en', 1234.5)).toBe('1,234.5');
    expect(formatNumber('es', 12345.5)).toMatch(/12.345,5/);
  });
  it('duraciones con unidades', () => {
    expect(formatDuration('en', 65_000)).toMatch(/1 min.*5 sec/);
    expect(formatDuration('es', 3_600_000)).toMatch(/1 h/);
    expect(formatDuration('es', 0)).toMatch(/0 s/);
  });
});

// --- Paridad de los diccionarios: mismas claves, mismo tipo y mismas variables {…} ---------

const varsOf = (value) => {
  const texts = typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.values(value);
  const set = new Set();
  for (const s of texts) for (const m of s.matchAll(/\{(\w+)\}/g)) set.add(m[1]);
  return [...set].sort();
};
const kindOf = (v) => (typeof v === 'string' ? 'text' : Array.isArray(v) ? 'list' : isPluralNode(v) ? 'plural' : 'other');

describe('paridad es/en', () => {
  const es = flatten(DICTIONARIES.es);
  const en = flatten(DICTIONARIES.en);

  it('las mismas claves en ambos idiomas', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });
  it('cada clave tiene el mismo tipo (texto, lista o plural) y las mismas variables', () => {
    const problems = [];
    for (const key of Object.keys(es)) {
      if (!(key in en)) continue;
      if (kindOf(es[key]) !== kindOf(en[key])) problems.push(`${key}: tipo ${kindOf(es[key])} ≠ ${kindOf(en[key])}`);
      else if (varsOf(es[key]).join() !== varsOf(en[key]).join()) problems.push(`${key}: {${varsOf(es[key])}} ≠ {${varsOf(en[key])}}`);
    }
    expect(problems).toEqual([]);
  });
  it('ningún texto vacío y ninguna lista vacía', () => {
    for (const [lang, flat] of [['es', es], ['en', en]]) {
      for (const [key, v] of Object.entries(flat)) {
        const texts = typeof v === 'string' ? [v] : Array.isArray(v) ? v : Object.values(v);
        expect(texts.length, `${lang}:${key}`).toBeGreaterThan(0);
        for (const s of texts) expect(s.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });
  it('los plurales tienen al menos one y other', () => {
    for (const flat of [es, en]) {
      for (const v of Object.values(flat)) if (isPluralNode(v)) expect(Object.keys(v)).toEqual(expect.arrayContaining(['one', 'other']));
    }
  });
});

// --- Claves usadas en el código ---------------------------------------------------------------
// Busca en src/ los textos con forma de clave ('ns.algo', "ns.algo", `ns.algo`) y los prefijos de
// claves dinámicas (`speed.${x}`): todos deben existir en el diccionario. Así una clave mal
// escrita o borrada falla aquí y no aparece en pantalla como "puzzles.algo".

const SRC = fileURLToPath(new URL('..', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const sourceFiles = walk(SRC).filter((f) => /\.(jsx?|mjs)$/.test(f) && !/\.test\.|[\\/]i18n[\\/](es|en)\.js$/.test(f));

describe('claves usadas en el código', () => {
  const flat = flatten(DICTIONARIES.es);
  const keys = Object.keys(flat);
  const ns = Object.keys(DICTIONARIES.es).join('|');
  const literal = new RegExp(`['"\`]((?:${ns})\\.[A-Za-z0-9_.]+)['"\`]`, 'g');
  const dynamic = new RegExp(`\`((?:${ns})\\.[A-Za-z0-9_.]*)\\$\\{`, 'g');
  const used = [];
  const prefixes = [];
  for (const f of sourceFiles) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(literal)) used.push([f.slice(SRC.length), m[1]]);
    for (const m of src.matchAll(dynamic)) prefixes.push([f.slice(SRC.length), m[1]]);
  }

  it('la búsqueda encuentra las claves (sanidad)', () => {
    expect(used.length).toBeGreaterThan(300);
    expect(prefixes.length).toBeGreaterThan(10);
  });
  it('toda clave literal existe (como texto o como grupo de claves)', () => {
    const missing = used.filter(([, k]) => !(k in flat) && !keys.some((x) => x.startsWith(`${k}.`)));
    expect(missing.map(([f, k]) => `${f}: ${k}`)).toEqual([]);
  });
  it('todo prefijo de clave dinámica existe', () => {
    const missing = prefixes.filter(([, p]) => !keys.some((x) => x.startsWith(p)));
    expect(missing.map(([f, p]) => `${f}: ${p}…`)).toEqual([]);
  });
});

describe('textos en inglés', () => {
  it('sin restos en español (salvo el nombre del idioma en el selector)', () => {
    const allowed = new Set(['lang.es']);
    const leftovers = [];
    for (const [key, v] of Object.entries(flatten(DICTIONARIES.en))) {
      if (allowed.has(key)) continue;
      const texts = typeof v === 'string' ? [v] : Array.isArray(v) ? v : Object.values(v);
      for (const s of texts) if (/[¿¡ñáéíóú]/.test(s)) leftovers.push(`${key}: ${s}`);
    }
    expect(leftovers).toEqual([]);
  });
});
