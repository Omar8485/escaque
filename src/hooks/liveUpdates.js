// Actualizaciones provisionales: primera inmediata, última de cada intervalo y final sin demora.
// No modifica búsquedas, profundidad, MultiPV ni el resultado que reciben los consumidores.
export function createLiveUpdates(publish, { interval = 200, now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let active = true;
  let pending = null;
  let timer = null;
  let last = -Infinity;
  const clear = () => { if (timer !== null) unschedule(timer); timer = null; };
  const flush = () => {
    timer = null;
    if (!active || pending === null) return;
    const value = pending;
    pending = null;
    last = now();
    publish(value);
  };
  return {
    push(value) {
      if (!active) return;
      pending = value;
      const remaining = interval - (now() - last);
      if (remaining <= 0) { clear(); flush(); }
      else if (timer === null) timer = schedule(flush, remaining);
    },
    finish(value) {
      if (!active) return;
      clear(); pending = null; active = false;
      publish(value);
    },
    cancel() { active = false; clear(); pending = null; },
  };
}
