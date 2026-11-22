import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getMetaGroup, setMeta } from '../storage/db.js';
import { DAY_PREFIX, SUMMARY_KEY, commitRewards, joinRewards, mergeRewardRecord, readRewards, splitRewards } from './store.js';
import { sameValue } from './merge.js';
import { applyXpEvent, emptyXpState, XP_RULES } from './xp.js';
import { applyDailyEvent, createDailyState, getDailyStatus, localDay } from './daily.js';
import { initialAchievements, reduceAchievements } from './achievements.js';

const TZ = 'America/Guayaquil';
const T0 = Date.UTC(2026, 0, 1, 17);
let n = 0;
/** 1 partida ganada + 3 puzles a la primera por día, como runtime.js. */
function simulate(days, model = { xp: emptyXpState(), daily: createDailyState(), achievements: initialAchievements() }, firstDay = 0) {
  let m = model;
  const step = (type, data, now) => {
    const daily = applyDailyEvent(m.daily, { ...data, type }, { now, timeZone: TZ });
    const status = getDailyStatus(daily, { now, timeZone: TZ });
    let xp = applyXpEvent(m.xp, { type, data }, { now, timeZone: TZ });
    if (status.goalComplete) xp = applyXpEvent(xp, { type: 'daily-goal', data: { day: status.date } }, { now });
    m = { ...m, xp, daily, achievements: reduceAchievements(m.achievements, { type, data: { ...data, daily: status }, at: now }, now).state };
  };
  for (let d = 0; d < days; d++) {
    const now = T0 + (firstDay + d) * 86400000;
    step('training-finished', { id: `escaque:${String(n++).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`, plies: 40, playerColor: 'w', level: 5, result: { reason: 'checkmate', winner: 'w' } }, now);
    for (let p = 0; p < 3; p++) step('puzzle-result', { id: `escaque:${String(n++).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd-${p + 10}`, solved: true, firstTry: true }, now + p * 1000);
    step('correction', { gameId: `s:${firstDay + d}`, key: `fen-${firstDay + d}` }, now + 5000);
  }
  return m;
}
const sizeOf = (v) => JSON.stringify(v).length;
const apply = (records, writes) => ({ ...records, ...writes });

describe('recompensas repartidas por día (store.js)', () => {
  it('ningún registro crece sin límite: 100 días caben holgados en el tope de sincronización (120 KB)', () => {
    // Como en la app: cada día se guarda lo de ese día.
    let records = {};
    let model;
    for (let d = 0; d < 100; d++) {
      model = simulate(1, joinRewards(records), d);
      records = apply(records, splitRewards(model, records, { today: localDay(T0 + d * 86400000, TZ), timeZone: TZ }));
    }
    expect(sizeOf(model)).toBeGreaterThan(150 * 1024); // un solo registro no se podría sincronizar
    const days = Object.keys(records).filter((k) => k.startsWith(DAY_PREFIX));
    expect(days).toHaveLength(100);
    expect(Math.max(...days.map((k) => sizeOf(records[k])))).toBeLessThan(6 * 1024);
    expect(sizeOf(records[SUMMARY_KEY])).toBeLessThan(4 * 1024);
    // Ida y vuelta sin pérdidas.
    const back = joinRewards(records);
    expect(back.xp.xp).toBe(model.xp.xp);
    expect(sameValue(back.xp.awards, model.xp.awards)).toBe(true);
    expect(sameValue(back.daily, model.daily)).toBe(true);
    expect(sameValue(back.achievements, model.achievements)).toBe(true);
  });

  it('escribe solo lo nuevo: el resumen y el día de hoy', () => {
    const first = simulate(5);
    const records = splitRewards(first, {}, { today: localDay(T0, TZ), timeZone: TZ });
    const more = simulate(1, joinRewards(records), 5); // el sexto día
    const today = localDay(T0 + 5 * 86400000, TZ);
    const writes = splitRewards(more, records, { today, timeZone: TZ });
    const touched = Object.keys(writes).sort();
    expect(touched.every((k) => k === SUMMARY_KEY || k === `${DAY_PREFIX}${today}`)).toBe(true);
    expect(joinRewards(apply(records, writes)).xp.xp).toBe(more.xp.xp);
    expect(splitRewards(joinRewards(apply(records, writes)), apply(records, writes), { today, timeZone: TZ })).toEqual({});
  });

  it('fusión de un mismo día de dos dispositivos: unión sin duplicar premios', () => {
    const a = { xp: { xp: 10, awards: { 'puzzle:p:solve': { amount: 10, awardedAt: 5 } } }, daily: { days: { '2026-01-01': { games: [], puzzles: ['p'], activities: ['puzzle:p'] } } }, achievements: { seen: { 'puzzle-result:p': true }, correctedPositions: {} } };
    const b = { xp: { xp: 25, awards: { 'puzzle:p:solve': { amount: 10, awardedAt: 3 }, 'puzzle:q:solve': { amount: 15, awardedAt: 4 } } }, daily: { days: { '2026-01-01': { games: [], puzzles: ['q'], activities: ['puzzle:q'] } } }, achievements: { seen: { 'puzzle-result:q': true }, correctedPositions: { x: true } } };
    const merged = mergeRewardRecord(`${DAY_PREFIX}2026-01-01`, a, b);
    expect(merged.xp.xp).toBe(25);
    expect(merged.xp.awards['puzzle:p:solve'].awardedAt).toBe(3);
    expect(merged.daily.days['2026-01-01'].puzzles.sort()).toEqual(['p', 'q']);
    expect(Object.keys(merged.achievements.seen).sort()).toEqual(['puzzle-result:p', 'puzzle-result:q']);
    expect(sameValue(mergeRewardRecord(`${DAY_PREFIX}2026-01-01`, merged, a), merged)).toBe(true);
  });

  it('un registro antiguo (todo en `rewards`) se lee igual y se reparte en la siguiente escritura', async () => {
    const legacy = { ...simulate(3), futureSetting: 'keep' };
    legacy.xp = { ...legacy.xp, xp: legacy.xp.xp + 7 }; // XP sin premio que la respalde: se conserva
    await setMeta(SUMMARY_KEY, legacy);
    const read = await readRewards();
    expect(read.xp.xp).toBe(legacy.xp.xp);
    expect(read.futureSetting).toBe('keep');
    await commitRewards((m) => ({ ...m, xp: applyXpEvent(m.xp, { type: 'puzzle-result', data: { id: 'new', solved: true } }, { now: T0 }) }), { now: T0 });
    const records = await getMetaGroup(SUMMARY_KEY, DAY_PREFIX);
    expect(Object.keys(records[SUMMARY_KEY].xp.awards)).toEqual([]);
    expect(Object.keys(records).filter((k) => k.startsWith(DAY_PREFIX)).length).toBeGreaterThanOrEqual(3);
    const after = await readRewards();
    expect(after.xp.xp).toBe(legacy.xp.xp + XP_RULES.puzzleSolved);
    expect(after.futureSetting).toBe('keep');
    expect(sameValue(after.daily.days, legacy.daily.days)).toBe(true);
  });
});
