import { afterEach, describe, expect, it } from 'vitest';
import { _setTrackEnv, daysBetween, FIRST_SEEN_KEY, localDay, markVisit, track } from './track.js';
import { EVENTS, isEvent } from '../../shared/events.js';

class Mem {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}

function env({ now = Date.parse('2026-11-22T12:00:00'), sink = null, lang = 'es' } = {}) {
  const sent = [];
  const e = { local: new Mem(), session: new Mem(), sink, send: (b) => sent.push(JSON.parse(b)), lang: () => lang, now: () => now };
  _setTrackEnv(e);
  return { e, sent };
}

afterEach(() => _setTrackEnv(null));

describe('eventos del embudo', () => {
  it('lista cerrada, sin duplicados', () => {
    expect(new Set(EVENTS).size).toBe(EVENTS.length);
    expect(isEvent('report_done')).toBe(true);
    expect(isEvent('email')).toBe(false);
  });

  it('track envía solo el evento y el idioma; ignora eventos desconocidos', () => {
    const { sent } = env({ lang: 'en-US' });
    expect(track('report_done')).toBe(true);
    expect(track('nope')).toBe(false);
    expect(sent).toEqual([{ e: 'report_done', l: 'en' }]);
  });

  it('once: session / day / ever', () => {
    const { e, sent } = env();
    track('premium_view', { once: 'session' });
    track('premium_view', { once: 'session' });
    track('report_start', { once: 'day' });
    track('report_start', { once: 'day' });
    e.now = () => Date.parse('2026-11-23T09:00:00');
    track('report_start', { once: 'day' });
    track('install', { once: 'ever' });
    track('install', { once: 'ever' });
    expect(sent.map((x) => x.e)).toEqual(['premium_view', 'report_start', 'report_start', 'install']);
  });

  it('en pruebas (sink) no envía: acumula en la lista', () => {
    const sink = [];
    const { sent } = env({ sink });
    track('game_end');
    expect(sink).toEqual(['game_end']);
    expect(sent).toEqual([]);
  });

  it('markVisit: primera visita, retorno a 1 y a 7 días, una sola vez cada uno', () => {
    const { e, sent } = env({ now: Date.parse('2026-11-01T10:00:00') });
    expect(markVisit()).toBe('first');
    expect(e.local.getItem(FIRST_SEEN_KEY)).toBe('2026-11-01');
    expect(markVisit()).toBe(null); // mismo día
    e.now = () => Date.parse('2026-11-03T10:00:00');
    expect(markVisit()).toBe('d1');
    expect(markVisit()).toBe(null);
    e.now = () => Date.parse('2026-11-09T10:00:00');
    expect(markVisit()).toBe('d7');
    e.now = () => Date.parse('2026-11-30T10:00:00');
    expect(markVisit()).toBe(null);
    expect(sent.map((x) => x.e)).toEqual(['first_visit', 'return_d1', 'return_d7']);
  });

  it('fechas locales y diferencia en días (cruce de mes y año)', () => {
    expect(localDay(Date.parse('2026-12-31T23:30:00'))).toBe('2026-12-31');
    expect(daysBetween('2026-12-28', '2027-01-04')).toBe(7);
  });

  it('sin almacenamiento disponible no lanza', () => {
    _setTrackEnv({ local: null, session: null, sink: null, send: () => { throw new Error('x'); }, lang: () => 'es', now: () => 0 });
    expect(() => markVisit()).not.toThrow();
    expect(track('game_end', { once: 'ever' })).toBe(true);
  });
});
