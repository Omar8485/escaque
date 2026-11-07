import { describe, expect, it } from 'vitest';
import { applyDailyEvent, configureDailyGoal, createDailyState, DEFAULT_DAILY_GOAL, getDailyStatus, localDay } from './daily.js';

const clock = (date, timeZone = 'America/Guayaquil') => ({ now: `${date}T17:00:00Z`, timeZone });
const puzzle = (id = 'p1', solved = false) => ({ type: 'puzzle-result', id, solved });
const onDay = (state, date, event = puzzle()) => applyDailyEvent(state, event, clock(date));
const status = (state, date) => getDailyStatus(state, clock(date));

describe('racha y meta diaria', () => {
  it('usa la fecha civil local y cambia de día sin depender del host', () => {
    const now = '2026-11-03T04:59:59Z';
    expect(localDay(now, 'America/Guayaquil')).toBe('2026-11-02');
    expect(localDay(now, 'Asia/Tokyo')).toBe('2026-11-03');
    expect(localDay('2026-11-03T05:00:00Z', 'America/Guayaquil')).toBe('2026-11-03');
    const state = applyDailyEvent(createDailyState(), puzzle(), { now, timeZone: 'America/Guayaquil' });
    expect(getDailyStatus(state, { now, timeZone: 'America/Guayaquil' }).trainedToday).toBe(true);
    expect(getDailyStatus(state, { now, timeZone: 'Asia/Tokyo' }).trainedToday).toBe(false);
  });

  it('mantiene días consecutivos durante el cambio DST de 23 y 25 horas', () => {
    for (const timestamps of [
      ['2026-03-07T17:00:00Z', '2026-03-08T16:00:00Z', '2026-03-09T16:00:00Z'],
      ['2026-10-31T16:00:00Z', '2026-11-01T17:00:00Z', '2026-11-02T17:00:00Z'],
    ]) {
      let state = createDailyState();
      for (const now of timestamps) state = applyDailyEvent(state, puzzle(), { now, timeZone: 'America/New_York' });
      expect(getDailyStatus(state, { now: timestamps[2], timeZone: 'America/New_York' }).currentStreak).toBe(3);
    }
  });

  it('un fallo entrena, pero la meta exige partidas y puzles resueltos únicos', () => {
    let state = createDailyState();
    expect(state.goal).toEqual(DEFAULT_DAILY_GOAL);
    state = onDay(state, '2026-11-02');
    expect(status(state, '2026-11-02')).toMatchObject({ currentStreak: 1, progress: { games: 0, puzzles: 0 }, goalComplete: false });
    state = onDay(state, '2026-11-02', puzzle('p1', true));
    const duplicate = onDay(state, '2026-11-02', puzzle('p1', true));
    expect(duplicate).toBe(state);
    state = onDay(state, '2026-11-02', puzzle('p2', true));
    state = onDay(state, '2026-11-02', puzzle('p3', true));
    state = onDay(state, '2026-11-02', { type: 'training-finished', id: 'g1', plies: 20, reason: 'checkmate' });
    state = onDay(state, '2026-11-02', { type: 'training-finished', id: 'g1', plies: 20, reason: 'checkmate' });
    expect(status(state, '2026-11-02')).toMatchObject({ progress: { games: 1, puzzles: 3 }, goalComplete: true, goalEventId: 'daily:2026-11-02' });
    expect(status(state, '2026-11-03').progress).toEqual({ games: 0, puzzles: 0 });
  });

  it('el repaso entrena sin regalar partidas o puzles; ignora abandonos tempranos', () => {
    let state = createDailyState();
    for (const event of [
      { type: 'training-finished', id: 'g0', plies: 0, reason: 'abandoned' },
      { type: 'training-finished', id: 'g1', plies: 1, reason: 'resignation' },
      { type: 'other', id: 'x' }, puzzle(''),
    ]) expect(onDay(state, '2026-11-02', event)).toBe(state);
    state = onDay(state, '2026-11-02', { type: 'review-completed', id: 'session1' });
    expect(status(state, '2026-11-02')).toMatchObject({ trainedToday: true, progress: { games: 0, puzzles: 0 } });
    expect(onDay(state, '2026-11-02', { type: 'review-completed', id: 'session1' })).toBe(state);
  });

  it('cubre un día por semana local y no repone el comodín al releer o repetir', () => {
    let state = onDay(createDailyState(), '2026-11-02'); // lunes
    state = onDay(state, '2026-11-04'); // martes cubierto
    const first = status(state, '2026-11-04');
    expect(first).toMatchObject({ currentStreak: 3, bestStreak: 3, wildcardAvailable: false,
      wildcardsUsed: { '2026-11-02': '2026-11-03' } });
    expect(status(state, '2026-11-04')).toEqual(first);
    state = onDay(state, '2026-11-06'); // segundo hueco en esa semana rompe
    expect(status(state, '2026-11-06')).toMatchObject({ currentStreak: 1, bestStreak: 3 });
    state = onDay(state, '2026-11-07');
    state = onDay(state, '2026-11-08');
    state = onDay(state, '2026-11-10'); // lunes de la semana siguiente cubierto
    expect(status(state, '2026-11-10')).toMatchObject({ currentStreak: 5, bestStreak: 5,
      wildcardsUsed: { '2026-11-02': '2026-11-03', '2026-11-09': '2026-11-09' } });
  });

  it('el comodín pertenece a la semana del día faltante, no al día de regreso', () => {
    let state = onDay(createDailyState(), '2026-11-07');
    state = onDay(state, '2026-11-09');
    expect(status(state, '2026-11-09')).toMatchObject({ currentStreak: 3, wildcardAvailable: true,
      wildcardsUsed: { '2026-11-02': '2026-11-08' } });
    state = onDay(state, '2026-11-11');
    expect(status(state, '2026-11-11')).toMatchObject({ currentStreak: 5, wildcardAvailable: false });
  });

  it('huecos de dos días rompen incluso cruzando semanas, conservando la mejor', () => {
    let state = createDailyState();
    for (const date of ['2026-11-05', '2026-11-06', '2026-11-07']) state = onDay(state, date);
    expect(status(state, '2026-11-08').currentStreak).toBe(3); // día actual abierto
    state = onDay(state, '2026-11-10'); // domingo y lunes faltaron
    expect(status(state, '2026-11-10')).toMatchObject({ currentStreak: 1, bestStreak: 4, wildcardsUsed: { '2026-11-02': '2026-11-08' } });
    expect(status(state, '2026-11-13')).toMatchObject({ currentStreak: 0, bestStreak: 4 });
  });

  it('proyecta el comodín del día perdido sin crear actividad ni completar metas', () => {
    const state = onDay(createDailyState(), '2026-11-02');
    const before = structuredClone(state);
    expect(status(state, '2026-11-04')).toMatchObject({ currentStreak: 2, trainedToday: false,
      goalComplete: false, wildcardAvailable: false, progress: { games: 0, puzzles: 0 } });
    expect(state).toEqual(before);
    expect(status(state, '2026-11-05').currentStreak).toBe(0);
  });

  it('configura metas sin borrar progreso, rechaza cero total y límites inválidos', () => {
    const original = onDay(createDailyState(), '2026-11-02', puzzle('p1', true));
    let state = configureDailyGoal(original, { games: 0, puzzles: 1 });
    expect(status(state, '2026-11-02').goalComplete).toBe(true);
    expect(state.days).toBe(original.days);
    expect(configureDailyGoal(state, { games: 0, puzzles: 0 })).toBe(state);
    state = configureDailyGoal(state, { games: -1, puzzles: 101 });
    expect(state.goal).toEqual({ games: 0, puzzles: 1 });
    expect(configureDailyGoal(state, { games: 2.5, puzzles: '3' }).goal).toEqual(state.goal);
    expect(original.goal).toEqual(DEFAULT_DAILY_GOAL);
  });
});


it('la mejor racha no baja ni se repone el comodín después de varios días sin volver', () => {
  let state = onDay(createDailyState(), '2026-11-02');
  expect(status(state, '2026-11-04')).toMatchObject({ currentStreak: 2, bestStreak: 2, wildcardAvailable: false });
  expect(status(state, '2026-11-05')).toMatchObject({ currentStreak: 0, bestStreak: 2, wildcardAvailable: false });
  state = onDay(state, '2026-11-06');
  expect(status(state, '2026-11-06')).toMatchObject({ currentStreak: 1, bestStreak: 2, wildcardAvailable: false });
});

it('la semana local cruza el año sin regalar un segundo comodín', () => {
  let state = onDay(createDailyState(), '2026-12-28');
  state = onDay(state, '2026-12-30');
  state = onDay(state, '2027-01-01');
  expect(status(state, '2027-01-01')).toMatchObject({ currentStreak: 1, bestStreak: 3,
    wildcardAvailable: false, wildcardsUsed: { '2026-12-28': '2026-12-29' } });
});

it('no mantiene la racha abandonando tras una sola jugada propia y la respuesta rival', () => {
  const now = Date.UTC(2026, 10, 2, 16);
  const clock = { now, timeZone: 'America/Guayaquil' };
  const initial = createDailyState();
  for (const event of [{ id: 'white', playerColor: 'w', plies: 2 }, { id: 'black', playerColor: 'b', plies: 3 }]) {
    expect(applyDailyEvent(initial, { type: 'training-finished', reason: 'abandon', ...event }, clock)).toBe(initial);
  }
});
