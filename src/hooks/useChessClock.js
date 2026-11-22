import { useEffect, useRef, useState } from 'react';

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * Reloj de ajedrez independiente de la pantalla: vive en App, así sigue corriendo aunque el
 * usuario esté en otra pestaña del menú. Mide tiempo real transcurrido (no cuenta ticks), de
 * modo que no se desvía si el navegador frena los temporizadores en segundo plano.
 *
 * @param {object} p
 * @param {number} p.initialSeconds  tiempo inicial por bando
 * @param {boolean} p.running
 * @param {'w'|'b'} p.turn  bando cuyo reloj corre
 * @param {number|string} p.resetKey  al cambiar, ambos relojes vuelven a `initialSeconds`
 * @param {(flagged: 'w'|'b') => void} [p.onTimeOut]
 * @param {number} [p.tickMs]
 * @returns {{w: number, b: number, ms: {w: number, b: number}}}  segundos restantes (redondeados
 *   hacia arriba) y, en `ms`, los milisegundos exactos (para el tiempo usado en el resumen)
 */
export function useChessClock({ initialSeconds, running, turn, resetKey, onTimeOut, tickMs = 200 }) {
  const fresh = { key: resetKey, initial: initialSeconds, w: initialSeconds * 1000, b: initialSeconds * 1000 };
  const [stored, setStored] = useState(fresh);
  const isCurrent = (s) => s.key === resetKey && s.initial === initialSeconds;
  const state = isCurrent(stored) ? stored : fresh;

  useEffect(() => {
    if (!running) return undefined;
    let last = nowMs();
    const spend = () => {
      const now = nowMs();
      const dt = now - last;
      last = now;
      setStored((s) => {
        const base = s.key === resetKey && s.initial === initialSeconds ? s : { key: resetKey, initial: initialSeconds, w: initialSeconds * 1000, b: initialSeconds * 1000 };
        return { ...base, [turn]: Math.max(0, base[turn] - dt) };
      });
    };
    const id = setInterval(spend, tickMs);
    return () => {
      clearInterval(id);
      spend(); // el tramo desde el último tick también cuenta
    };
  }, [running, turn, resetKey, initialSeconds, tickMs]);

  const onTimeOutRef = useRef(onTimeOut);
  useEffect(() => {
    onTimeOutRef.current = onTimeOut;
  });
  const flagged = state.w <= 0 ? 'w' : state.b <= 0 ? 'b' : null;
  useEffect(() => {
    if (flagged && running) onTimeOutRef.current?.(flagged);
  }, [flagged, running]);

  return { w: Math.ceil(state.w / 1000), b: Math.ceil(state.b / 1000), ms: { w: state.w, b: state.b } };
}

/**
 * Cuenta atrás de abandono: mientras `armed` sea true, descuenta `graceMs`; si llega a 0 llama
 * a `onExpire` una vez. Al desarmarse (el usuario volvió) se reinicia.
 * @returns {number|null}  segundos que quedan (null si no está armada)
 */
export function useAbandonCountdown({ armed, graceMs = 30_000, onExpire, tickMs = 250 }) {
  const [left, setLeft] = useState(null);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!armed) return undefined;
    const start = nowMs();
    let done = false;
    const tick = () => {
      const ms = Math.max(0, graceMs - (nowMs() - start));
      setLeft(ms);
      if (ms <= 0 && !done) {
        done = true;
        clearInterval(id);
        onExpireRef.current?.();
      }
    };
    const id = setInterval(tick, tickMs);
    return () => {
      clearInterval(id);
      setLeft(null);
    };
  }, [armed, graceMs, tickMs]);

  if (!armed) return null;
  return Math.ceil((left ?? graceMs) / 1000);
}
