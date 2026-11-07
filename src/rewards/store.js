// Persistencia de las recompensas en `meta` (integración v1.3, Claude).
//
// En memoria el modelo es uno solo ({ xp, daily, achievements }, ver runtime.js), pero guardado en un
// único registro crecía sin límite (≈2 KB por día con la meta por defecto: 214 KB en 100 días) y la
// sincronización Premium no sube registros de más de 120 KB. Por eso se guarda repartido:
//   - `rewards`              resumen acotado: meta diaria, logros desbloqueados, contadores, XP sin
//                            premio que la respalde (estados antiguos) y cualquier campo desconocido;
//   - `rewards:day:AAAA-MM-DD` lo que crece con la actividad de ese día local: premios de XP (por su
//                            fecha), el día de la racha/meta y las marcas de eventos ya vistos y de
//                            posiciones corregidas que se registraron ese día.
// Los registros por día solo crecen (se añaden claves), así que la fusión entre dispositivos
// (merge.js, aplicada por src/sync/local.js) es siempre una unión. Un registro `rewards` antiguo
// (todo junto, como lo guardaba Codex) se lee igual y se reparte en la siguiente escritura.
import { getMetaGroup, updateMetaGroup } from '../storage/db.js';
import { mergeRewards } from './merge.js';
import { emptyXpState } from './xp.js';
import { createDailyState, localDay } from './daily.js';
import { initialAchievements } from './achievements.js';

export const SUMMARY_KEY = 'rewards';
export const DAY_PREFIX = 'rewards:day:';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const dayKey = (date) => `${DAY_PREFIX}${DATE.test(date) ? date : '0000-00-00'}`;
const amountOf = (award) => (Number.isFinite(award?.amount) ? award.amount : 0);

/** Modelo completo con valores por defecto (lo que usan los reductores puros). */
export const normalizeRewards = (raw) => ({
  ...raw,
  xp: raw?.xp ?? emptyXpState(),
  daily: raw?.daily ?? createDailyState(),
  achievements: raw?.achievements ?? initialAchievements(),
});

/**
 * Une los registros guardados en el modelo. Lineal en el número de entradas; un premio repetido en
 * dos días (lo dieron dos dispositivos) cuenta una vez, con su fecha más antigua.
 * @param {Record<string, any>} records clave de meta → valor
 */
export function joinRewards(records = {}) {
  const summary = isObj(records[SUMMARY_KEY]) ? records[SUMMARY_KEY] : {};
  const parts = [summary, ...Object.keys(records).filter((k) => k.startsWith(DAY_PREFIX)).sort().map((k) => records[k]).filter(isObj)];
  const awards = {};
  const days = {};
  const seen = {};
  const correctedPositions = {};
  for (const part of parts) {
    for (const [key, award] of Object.entries(part.xp?.awards ?? {})) {
      const prev = awards[key];
      if (!prev || (award?.awardedAt ?? Infinity) < (prev.awardedAt ?? Infinity)) awards[key] = award;
    }
    for (const [date, day] of Object.entries(part.daily?.days ?? {})) {
      const prev = days[date];
      days[date] = !prev ? day : Object.fromEntries(['games', 'puzzles', 'activities'].map((k) => [k, [...new Set([...(prev[k] ?? []), ...(day?.[k] ?? [])])]]));
    }
    Object.assign(seen, part.achievements?.seen);
    Object.assign(correctedPositions, part.achievements?.correctedPositions);
  }
  const sum = Object.values(awards).reduce((n, a) => n + amountOf(a), 0);
  // XP del resumen que no respaldan premios propios (registro antiguo o importado): se conserva.
  const summaryAwards = Object.values(summary.xp?.awards ?? {}).reduce((n, a) => n + amountOf(a), 0);
  const extra = Math.max(0, (Number.isFinite(summary.xp?.xp) ? summary.xp.xp : 0) - summaryAwards);
  const base = normalizeRewards(summary);
  const corrections = Math.max(base.achievements.counters?.corrections ?? 0, Object.keys(correctedPositions).length);
  return {
    ...base,
    xp: { ...base.xp, xp: sum + extra, awards },
    daily: { ...base.daily, days },
    achievements: { ...base.achievements, seen, correctedPositions, counters: { ...base.achievements.counters, corrections } },
  };
}

/** Resumen acotado del modelo (lo que no crece con la actividad). */
export function summaryOf(model) {
  const sum = Object.values(model.xp?.awards ?? {}).reduce((n, a) => n + amountOf(a), 0);
  return {
    ...model,
    xp: { xp: Math.max(0, (model.xp?.xp ?? 0) - sum), awards: {} },
    daily: { ...model.daily, days: {} },
    achievements: { ...model.achievements, seen: {}, correctedPositions: {} },
  };
}

const emptyShard = () => ({ xp: { xp: 0, awards: {} }, daily: { days: {} }, achievements: { seen: {}, correctedPositions: {} } });

/**
 * Registros que hay que escribir para pasar de lo guardado (`records`) al modelo `model`. Solo
 * añade: lo que ya está en algún registro por día no se mueve ni se borra.
 * @param {object} model
 * @param {Record<string, any>} records
 * @param {{today: string, timeZone?: string}} o  día local de hoy (para marcas sin fecha)
 * @returns {Record<string, any>} clave → valor nuevo (solo lo que cambia)
 */
export function splitRewards(model, records = {}, { today, timeZone } = {}) {
  const writes = {};
  const shard = (date) => {
    const key = dayKey(date);
    if (!writes[key]) {
      const old = records[key];
      writes[key] = isObj(old)
        ? { xp: { xp: old.xp?.xp ?? 0, awards: { ...old.xp?.awards } }, daily: { days: { ...old.daily?.days } }, achievements: { seen: { ...old.achievements?.seen }, correctedPositions: { ...old.achievements?.correctedPositions } } }
        : emptyShard();
    }
    return writes[key];
  };
  const stored = { awards: new Set(), seen: new Set(), positions: new Set() };
  for (const [key, value] of Object.entries(records)) {
    if (!key.startsWith(DAY_PREFIX) || !isObj(value)) continue;
    for (const k of Object.keys(value.xp?.awards ?? {})) stored.awards.add(k);
    for (const k of Object.keys(value.achievements?.seen ?? {})) stored.seen.add(k);
    for (const k of Object.keys(value.achievements?.correctedPositions ?? {})) stored.positions.add(k);
  }
  for (const [key, award] of Object.entries(model.xp?.awards ?? {})) {
    if (stored.awards.has(key)) continue;
    const date = Number.isFinite(award?.awardedAt) ? localDay(award.awardedAt, timeZone) : today;
    const s = shard(date);
    s.xp.awards[key] = award;
    s.xp.xp += amountOf(award);
  }
  for (const [date, day] of Object.entries(model.daily?.days ?? {})) {
    const old = records[dayKey(date)]?.daily?.days?.[date];
    if (!old || JSON.stringify(old) !== JSON.stringify(day)) shard(date).daily.days[date] = day;
  }
  for (const key of Object.keys(model.achievements?.seen ?? {})) if (!stored.seen.has(key)) shard(today).achievements.seen[key] = true;
  for (const key of Object.keys(model.achievements?.correctedPositions ?? {})) if (!stored.positions.has(key)) shard(today).achievements.correctedPositions[key] = true;
  // Solo los registros por día que de verdad cambian.
  for (const key of Object.keys(writes)) if (JSON.stringify(writes[key]) === JSON.stringify(records[key])) delete writes[key];
  const summary = summaryOf(model);
  if (JSON.stringify(summary) !== JSON.stringify(records[SUMMARY_KEY])) writes[SUMMARY_KEY] = summary;
  return writes;
}

/** Lee el modelo completo. */
export const readRewards = async () => joinRewards(await getMetaGroup(SUMMARY_KEY, DAY_PREFIX));

/**
 * Lee, calcula y guarda en UNA transacción. `compute(model)` es síncrona y devuelve el modelo nuevo
 * (el mismo objeto = no escribir).
 * @returns {Promise<{before: object, after: object}>}
 */
export async function commitRewards(compute, { now = Date.now() } = {}) {
  let before;
  let after;
  await updateMetaGroup(SUMMARY_KEY, DAY_PREFIX, (records) => {
    before = joinRewards(records);
    after = compute(before);
    return after === before ? undefined : splitRewards(after, records, { today: localDay(now) });
  });
  return { before, after };
}

/** Fusión por registro para la sincronización (src/sync/local.js). */
export function mergeRewardRecord(key, preferred, other) {
  if (key === SUMMARY_KEY) return mergeRewards(preferred, other);
  if (!isObj(other)) return preferred;
  if (!isObj(preferred)) return other;
  const joined = joinRewards({ [`${DAY_PREFIX}a`]: preferred, [`${DAY_PREFIX}b`]: other });
  return { xp: { xp: joined.xp.xp, awards: joined.xp.awards }, daily: { days: joined.daily.days },
    achievements: { seen: joined.achievements.seen, correctedPositions: joined.achievements.correctedPositions } };
}
export const isRewardKey = (key) => key === SUMMARY_KEY || String(key).startsWith(DAY_PREFIX);
