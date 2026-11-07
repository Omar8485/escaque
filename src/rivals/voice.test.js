import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import {
  COOLDOWN, PRIORITY, PROBABILITIES, choosePhrase, cooldownOver, createRng, createVoiceController, decide, displayMs,
  endEvent, fillTemplate, gatePlayerMove, initialVoiceState, isRivalGoodMove, playerMoveEvent, speechText, topEvent,
} from './voice.js';
import { getPersonality } from './personalities.js';

const always = () => 0; // rng que siempre "acierta" la probabilidad y elige la primera opción libre
const never = () => 0.999999;

/** Partida de prueba: jugadas SAN desde la posición inicial → history verbose. */
const historyOf = (sans) => {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.history({ verbose: true });
};
const keyOf = (m) => `${m.before}|${m.lan}`;

/** Reloj manual para el cooldown por tiempo. */
const manualClock = (t0 = 1_000_000) => {
  let t = t0;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
};

describe('reglas básicas', () => {
  it('createRng es reproducible con la misma semilla', () => {
    const a = createRng(42);
    const b = createRng(42);
    const xs = Array.from({ length: 5 }, a);
    expect(xs).toEqual(Array.from({ length: 5 }, b));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(Array.from({ length: 5 }, createRng(7))).not.toEqual(xs);
  });

  it('playerMoveEvent y endEvent', () => {
    expect(playerMoveEvent('Blunder')).toBe('player_blunder');
    expect(playerMoveEvent('Mistake')).toBe('player_mistake');
    expect(playerMoveEvent('Best')).toBe('player_good_move');
    expect(playerMoveEvent('Inaccuracy')).toBeNull();
    expect(playerMoveEvent('Good')).toBeNull();
    expect(endEvent({ reason: 'checkmate', winner: 'b' }, 'w')).toBe('rival_wins');
    expect(endEvent({ reason: 'timeout', winner: 'w' }, 'w')).toBe('rival_loses');
    expect(endEvent({ reason: 'abandon', winner: 'b' }, 'w')).toBe('rival_wins');
    expect(endEvent({ reason: 'stalemate', winner: null }, 'b')).toBe('draw');
    expect(endEvent(null, 'w')).toBeNull();
  });

  it('isRivalGoodMove: Mejor/Excelente con ventaja clara, o táctica con ventaja', () => {
    expect(isRivalGoodMove({ label: 'Best', winAfter: 70, moveSan: 'Nf3' })).toBe(true);
    expect(isRivalGoodMove({ label: 'Excellent', winAfter: 66, moveSan: 'e4' })).toBe(true);
    expect(isRivalGoodMove({ label: 'Best', winAfter: 50, moveSan: 'Nf3' })).toBe(false);
    expect(isRivalGoodMove({ label: 'Best', winAfter: 58, moveSan: 'Bxf7+' })).toBe(true);
    expect(isRivalGoodMove({ label: 'Good', winAfter: 90, moveSan: 'Qxd8' })).toBe(false);
    expect(isRivalGoodMove(null)).toBe(false);
  });

  it('fillTemplate sustituye {move} y devuelve null si falta', () => {
    expect(fillTemplate('¿{move}? Vaya.', { move: 'Qh5' })).toBe('¿Qh5? Vaya.');
    expect(fillTemplate('¿{move}? Vaya.', {})).toBeNull();
    expect(fillTemplate('Sin variables.', {})).toBe('Sin variables.');
  });

  it('choosePhrase no repite índices usados y salta plantillas sin datos', () => {
    const lines = ['a {move}', 'b', 'c'];
    expect(choosePhrase(lines, [], {}, always)).toEqual({ index: 1, text: 'b' });
    expect(choosePhrase(lines, [1], {}, always)).toEqual({ index: 2, text: 'c' });
    expect(choosePhrase(lines, [1, 2], {}, always)).toBeNull();
    expect(choosePhrase(lines, [1, 2], { move: 'e4' }, always)).toEqual({ index: 0, text: 'a e4' });
  });

  it('displayMs entre 4 y 8 s según la longitud', () => {
    expect(displayMs('corta')).toBe(4000);
    expect(displayMs('x'.repeat(90))).toBe(7500);
    expect(displayMs('x'.repeat(500))).toBe(8000);
  });
});

describe('cooldown', () => {
  const st = (lastAt, lastPly) => ({ ...initialVoiceState(), lastAt, lastPly });
  it('exige un mínimo de tiempo y, además, 3 jugadas o 15 s', () => {
    expect(cooldownOver(initialVoiceState(), { now: 0, ply: 0 })).toBe(true);
    expect(cooldownOver(st(0, 0), { now: COOLDOWN.minMs - 1, ply: 10 })).toBe(false); // demasiado pronto
    expect(cooldownOver(st(0, 0), { now: COOLDOWN.minMs, ply: 2 })).toBe(false); // 2 jugadas y 4 s
    expect(cooldownOver(st(0, 0), { now: COOLDOWN.minMs, ply: 3 })).toBe(true); // 3 jugadas
    expect(cooldownOver(st(0, 0), { now: COOLDOWN.maxMs, ply: 1 })).toBe(true); // 15 s
  });

  it('decide calla por cooldown salvo en eventos de inicio y fin', () => {
    let state = { ...initialVoiceState(), lastAt: 0, lastPly: 0 };
    const ctx = { level: 1, now: 1000, ply: 1, rng: always };
    expect(decide(state, [{ type: 'player_blunder', move: 'Qh5' }], ctx).speech).toBeNull();
    expect(decide(state, [{ type: 'rival_wins' }], ctx).speech?.event).toBe('rival_wins');
    expect(decide(state, [{ type: 'draw' }], ctx).speech?.event).toBe('draw');
    state = initialVoiceState();
    expect(decide(state, [{ type: 'player_blunder', move: 'Qh5' }], ctx).speech?.event).toBe('player_blunder');
  });
});

describe('probabilidad con semilla', () => {
  const rate = (type, seed, n = 4000, extra = {}) => {
    const rng = createRng(seed);
    let spoke = 0;
    for (let i = 0; i < n; i++) if (decide(initialVoiceState(), [{ type, move: 'e4', ...extra }], { level: 6, now: 0, ply: 0, rng }).speech) spoke++;
    return spoke / n;
  };
  it('fin de partida e inicio siempre; error grave siempre fuera de cooldown', () => {
    for (const t of ['game_start', 'rival_wins', 'rival_loses', 'draw', 'player_blunder']) expect(rate(t, 1, 200)).toBe(1);
  });
  it('error a veces, buena jugada del rival ocasionalmente, elogio raro (salvo gran jugada)', () => {
    expect(rate('player_mistake', 2)).toBeCloseTo(PROBABILITIES.player_mistake, 1);
    expect(rate('rival_good_move', 3)).toBeCloseTo(PROBABILITIES.rival_good_move, 1);
    expect(rate('player_good_move', 4)).toBeCloseTo(PROBABILITIES.player_good_move, 1);
    expect(rate('player_good_move', 5, 4000, { great: true })).toBeGreaterThan(0.5);
  });
  it('misma semilla → mismas decisiones y mismas frases', () => {
    const run = (seed) => {
      const rng = createRng(seed);
      let state = initialVoiceState();
      const out = [];
      for (let i = 0; i < 12; i++) {
        const r = decide(state, [{ type: i % 2 ? 'player_mistake' : 'rival_good_move', move: 'Nf3' }], { level: 7, now: i * 20000, ply: i * 4, rng });
        state = r.state;
        out.push(r.speech?.text ?? null);
      }
      return out;
    };
    expect(run(99)).toEqual(run(99));
    expect(run(99).some((x) => x === null)).toBe(true);
    expect(run(99).some((x) => x !== null)).toBe(true);
  });
  it('rng que nunca acierta: solo hablan los eventos con probabilidad 1', () => {
    expect(decide(initialVoiceState(), [{ type: 'player_mistake', move: 'e4' }], { level: 1, now: 0, ply: 0, rng: never }).speech).toBeNull();
    expect(decide(initialVoiceState(), [{ type: 'player_blunder', move: 'e4' }], { level: 1, now: 0, ply: 0, rng: never }).speech).not.toBeNull();
  });
});

describe('no repetición', () => {
  it('en una partida nunca repite una frase; al agotarlas, calla', () => {
    const lines = getPersonality(3).lines.player_blunder;
    let state = initialVoiceState();
    const said = [];
    const rng = createRng(5);
    for (let i = 0; i < lines.length + 3; i++) {
      const r = decide(state, [{ type: 'player_blunder', move: 'Qh5' }], { level: 3, now: i * 60000, ply: i * 10, rng });
      state = r.state;
      if (r.speech) said.push(r.speech.text);
    }
    expect(said).toHaveLength(lines.length);
    expect(new Set(said).size).toBe(said.length);
  });

  it('una partida nueva vuelve a permitir todas las frases', () => {
    const now = manualClock();
    const v = createVoiceController({ rng: always, now });
    v.startGame({ gameId: 1, level: 1, playerColor: 'w' });
    const first = v.flush();
    v.startGame({ gameId: 2, level: 1, playerColor: 'w' });
    expect(v.flush().text).toBe(first.text);
  });
});

describe('prioridad', () => {
  it('topEvent elige el de mayor prioridad (a igualdad, el primero)', () => {
    expect(topEvent([{ type: 'player_mistake' }, { type: 'player_blunder' }, { type: 'rival_good_move' }]).type).toBe('player_blunder');
    expect(topEvent([{ type: 'player_blunder' }, { type: 'rival_wins' }]).type).toBe('rival_wins');
    expect(topEvent([{ type: 'rival_good_move' }, { type: 'player_mistake' }]).type).toBe('rival_good_move');
    expect(topEvent([{ type: 'desconocido' }])).toBeNull();
    expect(PRIORITY.rival_wins).toBeGreaterThan(PRIORITY.player_blunder);
    expect(PRIORITY.player_blunder).toBeGreaterThan(PRIORITY.rival_good_move);
    expect(PRIORITY.rival_good_move).toBeGreaterThan(PRIORITY.player_mistake);
  });

  it('con eventos simultáneos dice UNA frase, la del más prioritario', () => {
    const r = decide(initialVoiceState(), [{ type: 'player_mistake', move: 'Nc3' }, { type: 'rival_wins' }, { type: 'rival_good_move', move: 'Qxf7#' }], { level: 8, now: 0, ply: 9, rng: always });
    expect(r.speech.event).toBe('rival_wins');
    expect(getPersonality(8).lines.rival_wins).toContain(r.speech.text);
  });

  it('si el más prioritario no pasa la probabilidad, no habla otro en su lugar', () => {
    const rng = () => 0.9; // falla player_mistake (0.5) y rival_good_move (0.35)
    expect(decide(initialVoiceState(), [{ type: 'player_mistake', move: 'Nc3' }, { type: 'player_good_move' }], { level: 2, now: 0, ply: 1, rng }).speech).toBeNull();
  });
});

describe('controlador: partida, coach y Retroceder', () => {
  const setup = (opts = {}) => {
    const now = manualClock();
    const v = createVoiceController({ rng: always, now, ...opts });
    v.startGame({ gameId: 1, level: 1, playerColor: 'w' });
    const start = v.flush();
    now.advance(20000);
    return { v, now, start };
  };

  it('saluda al empezar con una frase del rival correcto', () => {
    const { start } = setup();
    expect(start.event).toBe('game_start');
    expect(getPersonality(1).lines.game_start).toContain(start.text);
    const v2 = createVoiceController({ rng: always });
    v2.startGame({ gameId: 7, level: 10, playerColor: 'b' });
    expect(getPersonality(10).lines.game_start).toContain(v2.flush().text);
    expect(v2.startGame({ gameId: 7, level: 10, playerColor: 'b' })).toBe(false); // misma partida: no repite el saludo
  });

  it('sin coach: comenta tu error grave cuando llega la clasificación', () => {
    const { v } = setup();
    const h = historyOf(['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7+']);
    const h1 = h.slice(0, 3);
    v.observe({ history: h1, classified: null, coachHolding: false });
    expect(v.flush()).toBeNull(); // aún sin clasificación
    // El rival ya respondió cuando llega la clasificación de tu jugada: sigue valiendo.
    const h2 = h.slice(0, 4);
    expect(v.observe({ history: h2, classified: { key: keyOf(h[2]), label: 'Blunder', moveSan: 'Qh5' }, coachHolding: false })).toBe(true);
    const s = v.flush();
    expect(s.event).toBe('player_blunder');
    expect(s.text).not.toContain('{move}');
  });

  it('con el coach deteniendo la partida espera; tras Seguir comenta', () => {
    const { v } = setup();
    const h = historyOf(['e4', 'e5', 'Qh5']);
    const blunder = { key: keyOf(h[2]), label: 'Blunder', moveSan: 'Qh5' };
    // Coach analizando
    expect(v.observe({ history: h, classified: null, coachHolding: true })).toBe(false);
    // Coach detiene la partida (clasificación ya conocida)
    expect(v.observe({ history: h, classified: blunder, coachHolding: true })).toBe(false);
    expect(v.observe({ history: h, classified: blunder, coachHolding: true })).toBe(false);
    expect(v.flush()).toBeNull();
    // Seguir: el coach suelta la partida y entra la jugada del rival
    expect(v.observe({ history: h, classified: blunder, coachHolding: false })).toBe(true);
    expect(v.flush().event).toBe('player_blunder');
    // No vuelve a comentarla al seguir observando
    const h4 = historyOf(['e4', 'e5', 'Qh5', 'Nc6']);
    expect(v.observe({ history: h4, classified: blunder, coachHolding: false })).toBe(false);
  });

  it('si eliges Retroceder, no se burla de la jugada deshecha', () => {
    const { v } = setup();
    const h = historyOf(['e4', 'e5', 'Qh5']);
    const blunder = { key: keyOf(h[2]), label: 'Blunder', moveSan: 'Qh5' };
    v.observe({ history: h, classified: blunder, coachHolding: true });
    // Retroceder: se deshace tu jugada; la vista del coach pasa a tu jugada anterior (e4, Mejor)
    const back = h.slice(0, 2);
    expect(v.observe({ history: back, classified: { key: keyOf(h[0]), label: 'Best', moveSan: 'e4' }, coachHolding: false })).toBe(false);
    expect(v.flush()).toBeNull();
    expect(v.snapshot().pending).toBeNull();
    // Juegas otra jugada (buena): se puede comentar esa, no la deshecha
    const h2 = historyOf(['e4', 'e5', 'Nf3']);
    v.observe({ history: h2, classified: null, coachHolding: true });
    expect(v.observe({ history: h2, classified: { key: keyOf(h2[2]), label: 'Mistake', moveSan: 'Nf3' }, coachHolding: false })).toBe(true);
    const s = v.flush();
    expect(s.event).toBe('player_mistake');
  });

  it('tras Retroceder, repetir el mismo error y elegir Seguir sí se comenta', () => {
    const { v } = setup();
    const h = historyOf(['e4', 'e5', 'Qh5']);
    const blunder = { key: keyOf(h[2]), label: 'Blunder', moveSan: 'Qh5' };
    v.observe({ history: h, classified: blunder, coachHolding: true });
    v.observe({ history: h.slice(0, 2), classified: null, coachHolding: false });
    v.observe({ history: h, classified: blunder, coachHolding: true });
    expect(v.observe({ history: h, classified: blunder, coachHolding: false })).toBe(true);
    expect(v.flush().event).toBe('player_blunder');
  });

  it('navegar atrás y adelante no repite el comentario de una jugada ya comentada', () => {
    const { v, now } = setup();
    const h = historyOf(['e4', 'e5', 'Qh5']);
    const blunder = { key: keyOf(h[2]), label: 'Blunder', moveSan: 'Qh5' };
    v.observe({ history: h, classified: blunder, coachHolding: false });
    expect(v.flush()).not.toBeNull();
    now.advance(60000);
    v.observe({ history: h.slice(0, 1), classified: null, coachHolding: false });
    expect(v.observe({ history: h, classified: blunder, coachHolding: false })).toBe(false);
  });

  it('respeta el cooldown entre tus jugadas', () => {
    const now = manualClock();
    const v = createVoiceController({ rng: always, now });
    v.startGame({ gameId: 1, level: 5, playerColor: 'w' });
    v.flush(); // saludo en la jugada 0
    now.advance(1000);
    const h = historyOf(['e4', 'e5', 'Qh5']);
    v.observe({ history: h, classified: { key: keyOf(h[2]), label: 'Blunder', moveSan: 'Qh5' }, coachHolding: false });
    expect(v.flush()).toBeNull(); // 1 s después del saludo: calla
  });

  it('notifyRivalMove: presume de su buena jugada solo si sigue en el tablero', () => {
    const { v } = setup();
    const h = historyOf(['e4', 'e5', 'Nf3', 'Nc6']);
    v.observe({ history: h, classified: null, coachHolding: false });
    const rivalMove = h[3];
    const c = { label: 'Best', color: 'b', winAfter: 70, moveSan: 'Nc6', fenBefore: rivalMove.before, moveUci: rivalMove.lan };
    expect(v.notifyRivalMove({ ...c, label: 'Inaccuracy' })).toBe(false);
    expect(v.notifyRivalMove({ ...c, color: 'w' })).toBe(false); // no es del rival
    expect(v.notifyRivalMove(c)).toBe(true);
    const s = v.flush();
    expect(s.event).toBe('rival_good_move');
    expect(getPersonality(1).lines.rival_good_move.map((l) => l.replace('{move}', 'Nc6'))).toContain(s.text);
    // La frase guarda índice y jugada: en inglés es la misma frase adaptada, con la misma jugada.
    expect(s).toMatchObject({ move: 'Nc6', index: expect.any(Number) });
    expect(speechText(s, 'en')).toBe(getPersonality(1, 'en').lines.rival_good_move[s.index].replace('{move}', 'Nc6'));
    // Una jugada que ya no es la última (deshecha o ya respondida) no cuenta
    v.observe({ history: h.slice(0, 2), classified: null, coachHolding: false });
    expect(v.notifyRivalMove(c)).toBe(false);
  });

  it('fin de partida: siempre habla, una vez por final, aunque haya cooldown', () => {
    const { v, now } = setup();
    const h = historyOf(['f3', 'e5', 'g4', 'Qh4#']);
    v.observe({ history: h, classified: null, coachHolding: false });
    now.advance(10);
    const result = { reason: 'checkmate', winner: 'b' };
    expect(v.end(result)).toBe(true);
    expect(v.end(result)).toBe(false);
    const s = v.flush();
    expect(s.event).toBe('rival_wins');
    expect(getPersonality(1).lines.rival_wins).toContain(s.text);
    // Abandono en otra partida → rival_wins; tablas → draw; ganas tú → rival_loses
    v.startGame({ gameId: 2, level: 4, playerColor: 'b' });
    v.flush();
    v.end({ reason: 'abandon', winner: 'w' });
    expect(v.flush().event).toBe('rival_wins');
    v.startGame({ gameId: 3, level: 4, playerColor: 'b' });
    v.end({ reason: 'timeout', winner: 'b' });
    expect(v.flush().event).toBe('rival_loses'); // gana sobre el saludo pendiente (prioridad)
    v.startGame({ gameId: 4, level: 4, playerColor: 'w' });
    v.flush();
    v.end({ reason: 'stalemate', winner: null });
    expect(v.flush().event).toBe('draw');
  });

  it('gatePlayerMove: drop / wait / release', () => {
    const p = { key: 'k', ply: 3 };
    expect(gatePlayerMove(null, { plies: 3, lastPlayerKey: 'k', classified: null, coachHolding: false })).toBe('none');
    expect(gatePlayerMove(p, { plies: 2, lastPlayerKey: 'j', classified: null, coachHolding: false })).toBe('drop');
    expect(gatePlayerMove(p, { plies: 5, lastPlayerKey: 'z', classified: null, coachHolding: false })).toBe('drop');
    expect(gatePlayerMove(p, { plies: 3, lastPlayerKey: 'k', classified: null, coachHolding: false })).toBe('wait');
    expect(gatePlayerMove(p, { plies: 3, lastPlayerKey: 'k', classified: { key: 'other' }, coachHolding: false })).toBe('wait');
    expect(gatePlayerMove(p, { plies: 3, lastPlayerKey: 'k', classified: { key: 'k' }, coachHolding: true })).toBe('wait');
    expect(gatePlayerMove(p, { plies: 4, lastPlayerKey: 'k', classified: { key: 'k' }, coachHolding: false })).toBe('release');
  });
});
