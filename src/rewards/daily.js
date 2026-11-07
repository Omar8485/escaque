import { eligibleTraining } from './activity.js';

// Calendario local puro (sin almacenamiento). Los ordinales son fechas civiles,
// no intervalos de 24 horas: un cambio DST no suma ni resta días de entrenamiento.
const DAY_MS = 86_400_000;
export const DEFAULT_DAILY_GOAL = Object.freeze({ games: 1, puzzles: 3 });

export function createDailyState() {
  return { goal: { ...DEFAULT_DAILY_GOAL }, days: {} };
}

/** Fecha civil ISO en la zona del usuario; `now` y `timeZone` son inyectables. */
export function localDay(now = Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const ordinal = (date) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateAt = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const weekOf = (day) => dateAt(day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7));
const emptyDay = () => ({ games: [], puzzles: [], activities: [] });
const validId = (id) => typeof id === 'string' && id.trim().length > 0;

/** Metas pequeñas configurables; al menos una actividad debe seguir siendo necesaria. */
export function configureDailyGoal(state = createDailyState(), goal = {}) {
  const current = { ...DEFAULT_DAILY_GOAL, ...state.goal };
  const next = { ...current };
  for (const key of ['games', 'puzzles']) {
    if (Number.isInteger(goal[key]) && goal[key] >= 0 && goal[key] <= 100) next[key] = goal[key];
  }
  if (next.games === 0 && next.puzzles === 0) return state;
  return { ...state, goal: next };
}

/**
 * Una actividad por id/tipo/día; los puzles fallados cuentan para la racha pero
 * solo los resueltos cuentan para la meta. Resolver después del fallo añade el
 * mismo id una vez. Abandonar tras una sola jugada propia no cuenta, aunque responda el rival.
 * @param {object} state
 * @param {{type:string,id:string,plies?:number,reason?:string,solved?:boolean}} event
 * @param {{now?:number|Date|string,timeZone?:string}} [clock]
 */
export function applyDailyEvent(state = createDailyState(), event, clock = {}) {
  if (!event || !validId(event.id)) return state;
  const date = localDay(clock.now, clock.timeZone);
  const day = state.days?.[date] ?? emptyDay();
  let gameId = null;
  let puzzleId = null;
  let activity;
  if (event.type === 'training-finished') {
    if (!eligibleTraining(event)) return state;
    gameId = event.id;
    activity = `game:${event.id}`;
  } else if (event.type === 'puzzle-result') {
    if (event.solved === true) puzzleId = event.id;
    activity = `puzzle:${event.id}`;
  } else if (event.type === 'review-completed') {
    activity = `review:${event.id}`;
  } else return state;
  const add = (list, id) => id && !list.includes(id) ? [...list, id] : list;
  const next = {
    games: add(day.games, gameId), puzzles: add(day.puzzles, puzzleId), activities: add(day.activities, activity),
  };
  if (next.games === day.games && next.puzzles === day.puzzles && next.activities === day.activities) return state;
  return { ...state, days: { ...state.days, [date]: next } };
}

/**
 * Un comodín automático por semana civil local (lunes-domingo), asignado a la
 * fecha que faltó. Solo cubre huecos de un día, nunca dos días seguidos, incluso
 * si cambia la semana. El día cubierto conserva/suma un día a la racha, sin
 * actividad, avance de meta ni XP. Se deriva del historial completo en orden;
 * releer el estado, repetir eventos o cambiar la meta no repone el comodín.
 * Se consume en el primer día perdido aunque luego falten más días: el segundo
 * rompe la racha, pero no devuelve el comodín ni reduce la mejor racha alcanzada.
 * El día actual está abierto: ayer basta para mantener la racha hasta medianoche.
 */
export function getDailyStatus(state = createDailyState(), clock = {}) {
  const date = localDay(clock.now, clock.timeZone);
  const today = ordinal(date);
  const dates = Object.entries(state.days ?? {}).filter(([key, value]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(key) && ordinal(key) <= today && value.activities?.length > 0,
  ).map(([key]) => ordinal(key)).sort((a, b) => a - b);
  const wildcardsUsed = {};
  let streak = 0;
  let bestStreak = 0;
  let last = null;
  for (const day of dates) {
    const gap = last === null ? null : day - last;
    if (gap === 1) streak += 1;
    else if (gap === 2 && !wildcardsUsed[weekOf(last + 1)]) {
      wildcardsUsed[weekOf(last + 1)] = dateAt(last + 1);
      streak += 2;
    } else {
      if (gap > 2 && !wildcardsUsed[weekOf(last + 1)]) {
        wildcardsUsed[weekOf(last + 1)] = dateAt(last + 1);
        bestStreak = Math.max(bestStreak, streak + 1);
      }
      streak = 1;
    }
    bestStreak = Math.max(bestStreak, streak);
    last = day;
  }
  if (last !== null && today - last > 1) {
    if (!wildcardsUsed[weekOf(last + 1)]) {
      wildcardsUsed[weekOf(last + 1)] = dateAt(last + 1);
      bestStreak = Math.max(bestStreak, streak + 1);
      streak = today - last === 2 ? streak + 1 : 0;
    } else streak = 0;
  }
  const day = state.days?.[date] ?? emptyDay();
  const goal = { ...DEFAULT_DAILY_GOAL, ...state.goal };
  const progress = { games: day.games.length, puzzles: day.puzzles.length };
  return {
    date, currentStreak: streak, bestStreak, goal, progress,
    trainedToday: day.activities.length > 0,
    goalComplete: progress.games >= goal.games && progress.puzzles >= goal.puzzles,
    goalEventId: `daily:${date}`,
    wildcardAvailable: !wildcardsUsed[weekOf(today)], wildcardsUsed,
  };
}
