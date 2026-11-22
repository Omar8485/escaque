// Durable reward service. UI events are serialized; Web Locks prevent cross-tab lost updates.
// Integración v1.3 (Claude): el modelo se guarda repartido por días (store.js) y cada
// lectura-cálculo-escritura va en UNA transacción, así la sincronización (que fusiona con merge.js)
// u otra pestaña no pueden colarse entre medias; al llegar recompensas de otro dispositivo se relee.
import { STORES, getAll } from '../storage/db.js';
import { commitRewards, readRewards } from './store.js';
import { mergeRewards } from './merge.js';
import { onGamesChanged } from '../import/store.js';
import { reduceAchievements } from './achievements.js';
import { recognizeHistory } from './history.js';
import { readProgress } from '../puzzles/puzzleLogic.js';
import { onRewardEvent } from './events.js';
import { applyDailyEvent, getDailyStatus, configureDailyGoal } from './daily.js';
import { applyXpEvent, emptyXpState, levelProgress } from './xp.js';

const session = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
const listeners = new Set();
const watched = new Set();
const trainingFingerprints = new Map();
let snapshot = { ready: false, model: { xp: emptyXpState() }, gain: null, error: false };
let started = false;
let queue = Promise.resolve();
let channel;
let knownPuzzles = null;
let reviewIds = [];
const reviewAttempts = new Set();
export const subscribeRewards = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getRewardsSnapshot = () => snapshot;
const publish = (patch) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); };
const lock = (fn) => globalThis.navigator?.locks?.request ? navigator.locks.request('escaque:rewards', fn) : fn();
const read = readRewards;
/** Lee, calcula y guarda atómicamente. `compute(model)` es síncrona; devolver el mismo modelo = no escribir. */
const commit = (compute) => commitRewards(compute);
const gameId = (id) => String(id).startsWith('escaque:') ? String(id) : `escaque:${id}`;

/** All producers are validated by pure reducers; only committed awards appear in the UI. */
async function processEvent(event) {
  await lock(async () => {
    let status;
    let unlocked = [];
    const { before: model, after: next } = await commit((model) => {
      const activityAt = event.type === 'training-finished' ? model.xp.awards?.[`training:${event.data.id}:base`]?.awardedAt ?? event.at : event.at;
      const daily = applyDailyEvent(model.daily, { ...event.data, type: event.type }, { now: activityAt });
      status = getDailyStatus(daily, { now: Date.now() });
      let xp = applyXpEvent(model.xp, event, { now: event.at });
      if (status.goalComplete) xp = applyXpEvent(xp, { type: 'daily-goal', data: { day: status.date } }, { now: event.at });
      const evaluated = reduceAchievements(model.achievements, { ...event, data: { ...event.data, daily: status } }, event.at);
      unlocked = evaluated.unlocked;
      if (xp === model.xp && daily === model.daily && evaluated.state === model.achievements) return model;
      return { ...model, xp, daily, achievements: evaluated.state };
    });
    const { xp } = next;
    const evaluated = { unlocked };
    const amount = xp.xp - model.xp.xp;
    publish({ ready: true, model: next, error: false, ...(evaluated.unlocked.length ? { achievementNotice: { ids: evaluated.unlocked, at: Date.now() } } : {}), ...(amount > 0 ? { gain: { amount, levelUp: levelProgress(xp.xp).level > levelProgress(model.xp.xp).level, goalCompleted: status.goalComplete && !model.xp.awards?.[`goal:${status.date}`], at: Date.now() } } : {}) });
    if (next !== model) channel?.postMessage('changed');
  });
}
function receive(event) {
  const data = { ...event.data };
  if (event.type === 'review-started') { reviewIds = [...(data.ids ?? [])]; reviewAttempts.clear(); return; }
  if (event.type === 'puzzle-result' && reviewIds.includes(data.puzzleId ?? data.id)) reviewAttempts.add(data.puzzleId ?? data.id);
  if (event.type === 'review-completed') {
    if (!reviewIds.length || !reviewIds.every((id) => reviewAttempts.has(id))) return;
    data.completed = true; data.count = reviewIds.length;
  }
  if (event.type === 'puzzle-result' && (data.puzzleId ?? data.id) != null) data.id = String(data.puzzleId ?? data.id);
  if (event.type === 'training-finished') {
    data.id = gameId(data.id ?? data.gameId);
    data.reason = data.reason ?? data.result?.reason ?? data.game?.termination;
    delete data.gameId;
    watched.add(data.id);
  }
  if (event.type === 'correction') { data.gameId = `${session}:${data.gameId}`; data.id = `${data.gameId}:${data.key}`; }
  const normalized = { type: event.type, data, at: Date.now() };
  queue = queue.catch(() => {}).then(() => processEvent(normalized)).catch(() => publish({ error: true }));
}
async function refreshTraining() {
  try {
    const [games, ledgers] = await Promise.all([getAll(STORES.games), getAll(STORES.moves)]);
    const byId = new Map(ledgers.map((m) => [m.gameId, m.moves]));
    for (const game of games) if (watched.has(game.id)) {
      const moves = byId.get(game.id) ?? [];
      const fingerprint = JSON.stringify([game.result, game.termination, game.rivalLevel, game.playerColor,
        moves.map((move) => [move.ply, move.color, move.label, move.evalBefore, move.evalAfter])]);
      if (trainingFingerprints.get(game.id) === fingerprint) continue;
      trainingFingerprints.set(game.id, fingerprint);
      receive({ type: 'training-finished', data: { id: game.id, game, moves, plies: moves.length,
        startColor: moves[0]?.color, level: game.rivalLevel, playerColor: game.playerColor,
        result: game.result, reason: game.termination } });
    }
  } catch { publish({ error: true }); }
}
export function startRewardsRuntime() {
  if (started) return;
  started = true;
  queue = initializeHistory().catch(() => publish({ ready: true, error: true }));
  onRewardEvent(receive);
  onGamesChanged(refreshTraining);
  const reload = () => { queue = queue.catch(() => {}).then(async () => publish({ model: await read() })).catch(() => publish({ error: true })); };
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('escaque:rewards');
    channel.onmessage = reload;
  }
  // Recompensas llegadas de otro dispositivo (src/account/AccountSection.jsx → onSyncedData).
  globalThis.addEventListener?.('escaque:data-synced', (e) => { if (e.detail?.stores?.includes(STORES.meta)) reload(); });
}

/** Espera las escrituras de eventos ya recibidos (útil para pruebas). */
export const rewardsSettled = () => queue;

/** User preference updates share the same durable queue and daily bonus identity. */
export function updateRewardsGoal(goal) {
  queue = queue.catch(() => {}).then(() => lock(async () => {
    let status;
    const { before: model, after: next } = await commit((model) => {
      const configured = configureDailyGoal(model.daily, goal);
      // goalSetAt: la meta más reciente gana al fusionar dispositivos (merge.js).
      const daily = configured === model.daily ? model.daily : { ...configured, goalSetAt: Date.now() };
      status = getDailyStatus(daily);
      const xp = status.goalComplete ? applyXpEvent(model.xp, { type: 'daily-goal', data: { day: status.date } }) : model.xp;
      return daily === model.daily && xp === model.xp ? model : { ...model, daily, xp };
    });
    const { xp } = next;
    const amount = xp.xp - model.xp.xp;
    publish({ model: next, error: false, ...(amount > 0 ? { gain: { amount, levelUp: levelProgress(xp.xp).level > levelProgress(model.xp.xp).level, goalCompleted: status.goalComplete && !model.xp.awards?.[`goal:${status.date}`], at: Date.now() } } : {}) });
    channel?.postMessage('changed');
  })).catch(() => publish({ error: true }));
  return queue;
}

async function historicalModel(model, snapshot) {
  const now = Date.now();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof Worker === 'undefined') return recognizeHistory(model, snapshot, now, timeZone);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./history.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error('Historical recognition failed')) : resolve(data.model); };
    worker.onerror = () => { worker.terminate(); reject(new Error('Historical worker failed')); };
    worker.postMessage({ model, snapshot, now, timeZone });
  });
}
async function initializeHistory() {
  const model = await read();
  publish({ model });
  const puzzles = await getAll(STORES.puzzles);
  knownPuzzles = new Set(puzzles.map((p) => p.id));
  if (model.achievements.hydrated) { publish({ ready: true }); return; }
  const [games, moves] = await Promise.all([getAll(STORES.games), getAll(STORES.moves)]);
  const recognized = await historicalModel(model, { games, moves, puzzles, puzzleProgress: readProgress() });
  await lock(async () => {
    // Otra pestaña (o la sincronización) pudo reconocer el historial o registrar eventos entretanto:
    // se fusiona con lo último guardado en vez de pisarlo (lo reconocido manda en la cadena de puzles).
    const { after } = await commit((latest) => (latest.achievements.hydrated ? latest
      : mergeRewards({ ...recognized, achievements: { ...recognized.achievements, hydrated: true } }, latest)));
    publish({ ready: true, model: after });
  });
}
/** Generator observation stays in rewards/, without edits to its concurrent source files. */
export async function observeGeneratedPuzzles(version) {
  try {
    startRewardsRuntime();
    await queue;
    const puzzles = await getAll(STORES.puzzles);
    const ids = new Set(puzzles.map((p) => p.id));
    const fresh = knownPuzzles ? puzzles.filter((p) => !knownPuzzles.has(p.id) && p.gameId) : [];
    knownPuzzles = ids;
    if (fresh.length) receive({ type: 'puzzles-generated', data: { id: `generation:${session}:${version}`, count: fresh.length } });
  } catch { publish({ error: true }); }
}
