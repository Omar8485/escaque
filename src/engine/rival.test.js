import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Chess } from 'chess.js';
import { RivalEngine } from './rival.js';
import {
  RIVAL_LEVELS,
  DEFAULT_RIVAL_LEVEL,
  getRivalLevel,
  levelOptionCommands,
  levelGoCommand,
} from './rivalLevels.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
// Mate del pastor ya dado: negras no tienen jugadas.
const MATED = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';

/**
 * Worker simulado: registra los comandos y responde a `uci`/`isready` automáticamente
 * (en un microtask). Las respuestas a `go` las da el test con `reply()`.
 */
class FakeWorker {
  constructor({ autoBestMove = null } = {}) {
    this.sent = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.autoBestMove = autoBestMove; // (fen) => 'bestmove ...'
    this.position = null;
  }

  postMessage(cmd) {
    this.sent.push(cmd);
    if (cmd === 'uci') this._later('id name Fake\nuciok');
    else if (cmd === 'isready') this._later('readyok');
    else if (cmd.startsWith('position fen ')) this.position = cmd.slice('position fen '.length);
    else if (cmd.startsWith('go') && this.autoBestMove) this._later(this.autoBestMove(this.position));
  }

  reply(line) {
    this.onmessage?.({ data: line });
  }

  _later(line) {
    queueMicrotask(() => this.onmessage?.({ data: line }));
  }

  terminate() {
    this.terminated = true;
  }
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Primera jugada legal en UCI (para respuestas simuladas legales). */
const firstLegal = (fen) => {
  const m = new Chess(fen).moves({ verbose: true })[0];
  return m ? `${m.from}${m.to}${m.promotion ?? ''}` : '(none)';
};

function setup(opts = {}) {
  const worker = new FakeWorker(opts.worker);
  const rival = new RivalEngine({ createWorker: () => worker, delay: false, ...opts.rival });
  rival.start();
  return { worker, rival };
}

describe('rivalLevels', () => {
  it('define los 10 personajes con Héctor (nivel 6, ≈1500) por defecto', () => {
    expect(RIVAL_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(RIVAL_LEVELS.map((l) => l.name)).toEqual(['Ícaro', 'Narciso', 'Perseo', 'Jasón', 'Teseo', 'Héctor', 'Odiseo', 'Aquiles', 'Heracles', 'Atenea']);
    expect(DEFAULT_RIVAL_LEVEL).toBe(6);
    expect(getRivalLevel(6)).toMatchObject({ label: 'Héctor', nominalElo: '≈1500', elo: 1850 });
    expect(() => getRivalLevel(0)).toThrow(RangeError);
    expect(() => getRivalLevel(11)).toThrow(RangeError);
  });

  it('cada nivel produce exactamente las opciones y el go de la tabla', () => {
    const expected = {
      1: [false, 'Skill Level value 0', 'go depth 1'],
      2: [false, 'Skill Level value 3', 'go depth 3'],
      3: [false, 'Skill Level value 6', 'go depth 5'],
      4: [true, 'UCI_Elo value 1450', 'go movetime 800'],
      5: [true, 'UCI_Elo value 1650', 'go movetime 800'],
      6: [true, 'UCI_Elo value 1850', 'go movetime 1000'],
      7: [true, 'UCI_Elo value 2050', 'go movetime 1000'],
      8: [true, 'UCI_Elo value 2300', 'go movetime 1200'],
      9: [true, 'UCI_Elo value 2600', 'go movetime 1500'],
      10: [false, 'Skill Level value 20', 'go movetime 1500'],
    };
    for (const def of RIVAL_LEVELS) {
      const [limit, option, go] = expected[def.level];
      expect(levelOptionCommands(def)).toEqual([
        `setoption name UCI_LimitStrength value ${limit}`,
        `setoption name ${option}`,
      ]);
      expect(levelGoCommand(def)).toBe(go);
    }
  });

  it('retardo mínimo: 600–1200 ms en niveles 1–3 y 600 ms en el resto', () => {
    for (const def of RIVAL_LEVELS) {
      expect(def.delayMs).toEqual(def.level <= 3 ? [600, 1200] : [600, 600]);
    }
  });
});

describe('RivalEngine', () => {
  let worker;
  let rival;

  beforeEach(() => {
    ({ worker, rival } = setup());
  });

  it('inicializa con Threads=1 y Hash=16 y queda listo', async () => {
    ({ worker, rival } = setup());
    expect(rival.getStatus()).toBe('loading');
    await flush();
    expect(worker.sent.slice(0, 4)).toEqual([
      'uci',
      'setoption name Threads value 1',
      'setoption name Hash value 16',
      'isready',
    ]);
    expect(rival.getStatus()).toBe('ready');
  });

  it.each(RIVAL_LEVELS.map((l) => [l.level]))('nivel %i: ucinewgame + opciones del nivel + isready', async (level) => {
    await flush();
    worker.sent = [];
    await rival.newGame(level);
    const def = getRivalLevel(level);
    expect(worker.sent).toEqual(['ucinewgame', ...levelOptionCommands(def), 'isready']);
    expect(rival.level).toBe(level);
  });

  it('chooseMove sincroniza position + isready → readyok → go del nivel y devuelve UCI + SAN', async () => {
    await rival.newGame(1);
    worker.sent = [];
    const p = rival.chooseMove(START);
    await flush();
    expect(worker.sent).toEqual([`position fen ${START}`, 'isready', 'go depth 1']);
    worker.reply('info depth 1 seldepth 1 multipv 1 score cp 20 nodes 20 nps 1000 time 1 pv e2e4');
    worker.reply('bestmove e2e4 ponder e7e5');
    const move = await p;
    expect(move).toMatchObject({ uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4', promotion: null, fen: START, level: 1 });
    expect(move.thinkMs).toBeGreaterThanOrEqual(0);
  });

  it('usa go movetime en niveles con UCI_Elo y no cachea: misma posición, nueva búsqueda', async () => {
    await rival.newGame(5);
    const p1 = rival.chooseMove(AFTER_E4);
    await flush();
    worker.reply('bestmove e7e5');
    expect((await p1).san).toBe('e5');
    worker.sent = [];
    const p2 = rival.chooseMove(AFTER_E4);
    await flush();
    expect(worker.sent).toEqual([`position fen ${AFTER_E4}`, 'isready', 'go movetime 800']);
    worker.reply('bestmove c7c5');
    expect((await p2).san).toBe('c5');
  });

  it('abortar durante la búsqueda envía stop, rechaza al instante y descarta ese bestmove', async () => {
    await rival.newGame(10);
    const controller = new AbortController();
    const p = rival.chooseMove(START, { signal: controller.signal });
    await flush();
    expect(worker.sent.at(-1)).toBe('go movetime 1500');

    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.sent.at(-1)).toBe('stop');

    // Una petición nueva espera al bestmove del stop antes de enviar su position.
    const p2 = rival.chooseMove(AFTER_E4);
    await flush();
    expect(worker.sent.filter((c) => c.startsWith('position')).length).toBe(1);

    worker.reply('bestmove e2e4'); // bestmove del stop: se descarta
    await flush();
    expect(worker.sent.slice(-3)).toEqual([`position fen ${AFTER_E4}`, 'isready', 'go movetime 1500']);
    worker.reply('bestmove g8f6');
    expect((await p2).san).toBe('Nf6');
  });

  it('abortar antes de readyok no envía go', async () => {
    await rival.newGame(3);
    worker.sent = [];
    const controller = new AbortController();
    const p = rival.chooseMove(START, { signal: controller.signal });
    controller.abort(); // la operación ya está en curso (position + isready enviados)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    expect(worker.sent).toEqual([`position fen ${START}`, 'isready']);
    expect(worker.sent.some((c) => c.startsWith('go') || c === 'stop')).toBe(false);
  });

  it('abortar una petición en cola la quita sin tocar el worker', async () => {
    await rival.newGame(2);
    const p1 = rival.chooseMove(START);
    const controller = new AbortController();
    const p2 = rival.chooseMove(AFTER_E4, { signal: controller.signal });
    controller.abort();
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    worker.reply('bestmove d2d4');
    expect((await p1).san).toBe('d4');
    await flush();
    expect(worker.sent.some((c) => c === `position fen ${AFTER_E4}`)).toBe(false);
  });

  it('signal ya abortado rechaza sin enviar nada', async () => {
    await rival.newGame(5);
    worker.sent = [];
    const controller = new AbortController();
    controller.abort();
    await expect(rival.chooseMove(START, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.sent).toEqual([]);
  });

  it('bestmove (none) resuelve null', async () => {
    await rival.newGame(1);
    const p = rival.chooseMove(MATED);
    await flush();
    worker.reply('info depth 0 score mate 0');
    worker.reply('bestmove (none)');
    expect(await p).toBeNull();
  });

  it('rechaza una jugada ilegal del motor', async () => {
    await rival.newGame(1);
    const p = rival.chooseMove(START);
    await flush();
    worker.reply('bestmove e2e5');
    await expect(p).rejects.toThrow(/ilegal/);
  });

  it('exige newGame antes de chooseMove y valida el nivel', async () => {
    await expect(rival.chooseMove(START)).rejects.toThrow(/newGame/);
    await expect(rival.newGame(12)).rejects.toThrow(RangeError);
  });

  it('cambiar de nivel entre partidas reenvía ucinewgame y todas las opciones del nuevo nivel', async () => {
    await rival.newGame(5);
    worker.sent = [];
    await rival.newGame(10);
    expect(worker.sent).toEqual([
      'ucinewgame',
      'setoption name UCI_LimitStrength value false',
      'setoption name Skill Level value 20',
      'isready',
    ]);
  });

  it('las operaciones pedidas antes de readyok inicial esperan a la inicialización', async () => {
    const w = new FakeWorker();
    const r = new RivalEngine({ createWorker: () => w, delay: false });
    r.start();
    const p = r.newGame(4);
    expect(w.sent).toEqual(['uci']);
    await p;
    expect(w.sent).toEqual([
      'uci',
      'setoption name Threads value 1',
      'setoption name Hash value 16',
      'isready',
      'ucinewgame',
      'setoption name UCI_LimitStrength value true',
      'setoption name UCI_Elo value 1450',
      'isready',
    ]);
  });

  it('terminate() rechaza lo pendiente con AbortError y cierra el worker', async () => {
    await rival.newGame(5);
    const p = rival.chooseMove(START);
    await flush();
    rival.terminate();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    expect(rival.getStatus()).toBe('idle');
    expect(rival.level).toBeNull();
  });

  it('un error del worker deja el estado en error y rechaza lo pendiente', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rival.newGame(5);
    const p = rival.chooseMove(START);
    await flush();
    worker.onerror(new Error('boom'));
    await expect(p).rejects.toThrow(/falló/);
    expect(rival.getStatus()).toBe('error');
    errSpy.mockRestore();
  });

  it('juega partidas enteras de jugadas legales en los niveles 1 y 9 (worker simulado)', async () => {
    const w = new FakeWorker({ autoBestMove: (fen) => `bestmove ${firstLegal(fen)}` });
    const r = new RivalEngine({ createWorker: () => w, delay: false });
    r.start();
    for (const level of [1, 10]) {
      await r.newGame(level);
      const chess = new Chess();
      for (let ply = 0; ply < 40 && !chess.isGameOver(); ply++) {
        const move = await r.chooseMove(chess.fen());
        expect(chess.move(move.san)).toBeTruthy();
      }
      expect(w.sent).toContain(level === 1 ? 'go depth 1' : 'go movetime 1500');
    }
  });
});

describe('RivalEngine: retardo mínimo visible', () => {
  it('espera hasta completar el retardo del nivel (sorteado entre mín y máx)', async () => {
    let clock = 0;
    const sleeps = [];
    const { worker, rival } = setup({
      rival: {
        delay: true,
        random: () => 0.5,
        now: () => clock,
        sleep: (ms) => {
          sleeps.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      },
    });
    await rival.newGame(1); // [600, 1200] → 900 con random 0.5
    const p = rival.chooseMove(START);
    await flush();
    clock += 100; // el motor tarda 100 ms
    worker.reply('bestmove e2e4');
    const move = await p;
    expect(sleeps).toEqual([800]);
    expect(move.elapsedMs).toBe(900);
    expect(move.thinkMs).toBe(100);
  });

  it('no espera si el motor ya tardó más que el retardo', async () => {
    let clock = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const { worker, rival } = setup({ rival: { delay: true, now: () => clock, sleep } });
    await rival.newGame(10);
    const p = rival.chooseMove(START);
    await flush();
    clock += 1500;
    worker.reply('bestmove e2e4');
    await p;
    expect(sleep).not.toHaveBeenCalled();
  });

  it('abortar durante el retardo rechaza con AbortError', async () => {
    const { worker, rival } = setup({ rival: { delay: true } });
    await rival.newGame(5);
    const controller = new AbortController();
    const p = rival.chooseMove(START, { signal: controller.signal });
    await flush();
    worker.reply('bestmove e2e4');
    await flush();
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
