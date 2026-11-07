// Small synchronous application bus. UI producers need no storage or reward logic.
const listeners = new Set();

/** Subscribe to {type, data}. Returns an idempotent unsubscribe function. */
export function onRewardEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Emit one activity. A broken subscriber must not interrupt gameplay or other listeners. */
export function emitRewardEvent(type, data = {}) {
  const event = { type, data };
  for (const listener of [...listeners]) {
    try { listener(event); } catch (error) { console.error('Reward event listener failed', error); }
  }
  return event;
}
