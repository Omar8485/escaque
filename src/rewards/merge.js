// Fusión de dos copias de las recompensas (meta `rewards`) que llegan de dispositivos distintos.
// La sincronización usa «última escritura gana» por registro; con un único registro para todas las
// recompensas eso perdería la XP, los días de racha o los logros conseguidos en el otro dispositivo
// (p. ej. un navegador nuevo que inicia sesión escribe su estado vacío y pisaría el del servidor).
// Por eso src/sync/local.js llama a mergeRewards() y se unen:
//  - premios de XP por clave estable (partida, puzle, corrección, día): la XP total es su suma, así
//    que un premio conseguido en los dos dispositivos cuenta una sola vez;
//  - días de la racha y meta: unión de las listas de cada fecha;
//  - logros: unión (gana la fecha de desbloqueo más antigua), marcas de eventos vistos y posiciones
//    corregidas;
//  - la meta diaria configurada gana por su propia fecha (`goalSetAt`), no por la del registro;
//  - lo que es «estado actual» (cadena de puzles a la primera) se toma de la copia preferida.
// Sin efectos ni dependencias de almacenamiento: probado en merge.test.js.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const amountOf = (award) => (Number.isFinite(award?.amount) ? award.amount : 0);
const sumAwards = (awards) => Object.values(awards ?? {}).reduce((sum, award) => sum + amountOf(award), 0);
/** XP que no está respaldada por premios (estados antiguos o importados): se conserva la mayor. */
const unbacked = (xp) => Math.max(0, (Number.isFinite(xp?.xp) ? xp.xp : 0) - sumAwards(xp?.awards));
const time = (v, field) => (Number.isFinite(v?.[field]) ? v[field] : Infinity);
/** De dos registros con fecha, el más antiguo (con empate, el primero). */
const older = (a, b, field) => (time(b, field) < time(a, field) ? b : a);
const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])].sort();

/** Une dos mapas clave → registro con fecha quedándose con el más antiguo por clave. */
function unionByKey(a = {}, b = {}, field) {
  const out = { ...(isObj(b) ? b : {}) };
  for (const [key, value] of Object.entries(isObj(a) ? a : {})) out[key] = Object.hasOwn(out, key) ? older(value, out[key], field) : value;
  return out;
}

function mergeXp(pref = {}, other = {}) {
  const awards = unionByKey(pref.awards, other.awards, 'awardedAt');
  return { ...other, ...pref, awards, xp: sumAwards(awards) + Math.max(unbacked(pref), unbacked(other)) };
}

function mergeDaily(pref = {}, other = {}) {
  const days = {};
  for (const source of [other.days, pref.days]) {
    for (const [date, day] of Object.entries(isObj(source) ? source : {})) {
      const prev = days[date] ?? {};
      days[date] = { ...prev, ...day, games: union(prev.games, day?.games), puzzles: union(prev.puzzles, day?.puzzles), activities: union(prev.activities, day?.activities) };
    }
  }
  // La meta la decide quien la cambió por última vez; sin fecha, la copia preferida.
  const goalFrom = (other.goalSetAt ?? 0) > (pref.goalSetAt ?? 0) ? other : pref;
  const out = { ...other, ...pref, days };
  if (goalFrom.goal) out.goal = goalFrom.goal;
  if (goalFrom.goalSetAt != null) out.goalSetAt = goalFrom.goalSetAt;
  return out;
}

function mergeAchievements(pref = {}, other = {}) {
  const correctedPositions = { ...other.correctedPositions, ...pref.correctedPositions };
  const counters = { ...other.counters, ...pref.counters };
  counters.corrections = Math.max(other.counters?.corrections ?? 0, pref.counters?.corrections ?? 0, Object.keys(correctedPositions).length);
  return {
    ...other,
    ...pref,
    unlocked: unionByKey(pref.unlocked, other.unlocked, 'unlockedAt'),
    seen: { ...other.seen, ...pref.seen },
    correctedPositions,
    counters,
    hydrated: Boolean(pref.hydrated || other.hydrated),
  };
}

/**
 * Une dos copias de las recompensas. `preferred` aporta lo que no se puede unir (estado actual);
 * es la copia más reciente. Idempotente y conmutativa en todo lo acumulable.
 * @param {object|undefined} preferred
 * @param {object|undefined} other
 */
export function mergeRewards(preferred, other) {
  if (!isObj(other)) return preferred;
  if (!isObj(preferred)) return other;
  return {
    ...other,
    ...preferred,
    xp: mergeXp(preferred.xp, other.xp),
    daily: mergeDaily(preferred.daily, other.daily),
    achievements: mergeAchievements(preferred.achievements, other.achievements),
  };
}

/**
 * Serialización estable para saber si una fusión cambió algo: claves ordenadas y listas de valores
 * simples ordenadas (en las recompensas son conjuntos de ids: el orden no significa nada).
 */
function canonical(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    return `[${(value.every((v) => !isObj(v) && !Array.isArray(v)) ? items.sort() : items).join(',')}]`;
  }
  if (isObj(value)) return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const sameValue = (a, b) => canonical(a) === canonical(b);
