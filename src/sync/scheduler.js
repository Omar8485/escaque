// Cuándo sincronizar: al activarse, tras cambios locales (agrupados), cada pocos minutos, al volver
// la conexión o la pestaña. Respeta el cupo diario del servidor (no reintenta hasta medianoche UTC).
import { onLocalChange } from '../storage/db.js';
import { getSyncStatus, markSyncOff, runSync } from './engine.js';

let current = null;
/** «Sincronizar ahora» desde la interfaz (si la sincronización está activa). */
export const syncNow = () => (current ? current.now() : Promise.resolve(false));

export const SYNC_TIMING = Object.freeze({ debounceMs: 4000, intervalMs: 5 * 60 * 1000, focusMinGapMs: 60 * 1000, errorRetryMs: 2 * 60 * 1000 });

/**
 * @param {{getContext:()=>null|{userId:string, csrf:string}, onData?:Function, timing?:typeof SYNC_TIMING}} o
 * @returns {{stop:()=>void, now:()=>Promise<boolean>}}
 */
export function startSyncScheduler({ getContext, onData, timing = SYNC_TIMING }) {
  let stopped = false;
  let timer = null;
  let running = null;
  let again = false;
  let lastRun = 0;
  let blockedUntil = 0;

  const schedule = (ms) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(() => { trigger(); }, ms);
  };

  async function trigger({ force = false } = {}) {
    if (stopped) return false;
    if (!force && Date.now() < blockedUntil) return false;
    if (running) { again = true; return running; }
    const ctx = getContext();
    if (!ctx) return false;
    lastRun = Date.now();
    running = runSync({ ...ctx, onData }).finally(() => { running = null; });
    const ok = await running;
    const s = getSyncStatus();
    if (s.state === 'quota') blockedUntil = Date.now() + (s.retryAfter ?? 3600) * 1000;
    if (again) { again = false; schedule(timing.debounceMs); } else schedule(ok ? timing.intervalMs : timing.errorRetryMs);
    return ok;
  }

  const offChange = onLocalChange(() => schedule(timing.debounceMs));
  const onOnline = () => trigger();
  const onVisible = () => {
    if (globalThis.document?.visibilityState === 'visible' && Date.now() - lastRun > timing.focusMinGapMs) trigger();
  };
  globalThis.addEventListener?.('online', onOnline);
  globalThis.document?.addEventListener?.('visibilitychange', onVisible);
  trigger();

  const handle = {
    now: () => trigger({ force: true }),
    stop() {
      if (current === handle) current = null;
      stopped = true;
      clearTimeout(timer);
      offChange();
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
      markSyncOff();
    },
  };
  current = handle;
  return handle;
}
