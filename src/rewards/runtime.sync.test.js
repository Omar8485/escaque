// Recompensas + sincronización (integración v1.3): lo que llega de otro dispositivo se fusiona con
// lo local (src/sync/local.js → merge.js) y el runtime vuelve a leerlo; los eventos posteriores no
// pisan lo recibido porque cada evento lee y escribe en una sola transacción (updateMetaGroup).
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';

// En Node, globalThis no es un EventTarget: se simula el de la ventana antes de cargar el runtime.
const target = new EventTarget();
globalThis.addEventListener = target.addEventListener.bind(target);
globalThis.dispatchEvent = target.dispatchEvent.bind(target);

const { readRewards, summaryOf } = await import('./store.js');
const { applyRemote } = await import('../sync/local.js');
const { emitRewardEvent } = await import('./events.js');
const { getRewardsSnapshot, rewardsSettled, startRewardsRuntime } = await import('./runtime.js');
const { XP_RULES } = await import('./xp.js');

const remoteRewards = (base) => ({
  ...base,
  xp: { xp: base.xp.xp + 10, awards: { ...base.xp.awards, 'puzzle:remote:solve': { amount: 10, kind: 'puzzle', id: 'remote', awardedAt: 1 } } },
  daily: { ...base.daily, days: { ...base.daily.days, '2026-01-05': { games: [], puzzles: ['remote'], activities: ['puzzle:remote'] } } },
  achievements: { ...base.achievements, unlocked: { ...base.achievements.unlocked, rival3: { unlockedAt: 1 } } },
});

it('lo sincronizado se fusiona, se refleja en la cabecera y sobrevive a los eventos siguientes', async () => {
  startRewardsRuntime();
  await rewardsSettled();
  emitRewardEvent('puzzle-result', { id: 'p1', solved: true, firstTry: true });
  await rewardsSettled();
  const local = await readRewards();
  const solved = XP_RULES.puzzleSolved + XP_RULES.puzzleFirstTry;
  expect(local.xp.xp).toBe(solved);

  // Llegan del servidor copias MÁS ANTIGUAS que no tienen lo local: el resumen (con un logro ajeno) y
  // un día de otro dispositivo (con un premio) — como los guarda store.js.
  const remote = remoteRewards({ ...local, xp: { xp: 0, awards: {} } });
  const remoteDay = { xp: { xp: 10, awards: { 'puzzle:remote:solve': remote.xp.awards['puzzle:remote:solve'] } },
    daily: { days: { '2026-01-05': remote.daily.days['2026-01-05'] } }, achievements: { seen: { 'puzzle-result:remote': true }, correctedPositions: {} } };
  const { stores } = await applyRemote([
    { store: 'meta', key: 'rewards', updatedAt: 2, deleted: false, data: { key: 'rewards', value: summaryOf(remote) } },
    { store: 'meta', key: 'rewards:day:2026-01-05', updatedAt: 2, deleted: false, data: { key: 'rewards:day:2026-01-05', value: remoteDay } },
  ]);
  expect([...stores]).toEqual(['meta']);
  globalThis.dispatchEvent(new CustomEvent('escaque:data-synced', { detail: { stores: [...stores] } }));
  await expect.poll(() => getRewardsSnapshot().model.xp.xp).toBe(solved + 10);
  expect(getRewardsSnapshot().model.achievements.unlocked.rival3).toEqual({ unlockedAt: 1 });

  emitRewardEvent('puzzle-result', { id: 'p2', solved: true, firstTry: false });
  await rewardsSettled();
  const after = await readRewards();
  expect(after.xp.xp).toBe(solved + 10 + XP_RULES.puzzleSolved);
  expect(after.xp.awards['puzzle:remote:solve']).toBeDefined();
  expect(after.daily.days['2026-01-05'].puzzles).toEqual(['remote']);
});
