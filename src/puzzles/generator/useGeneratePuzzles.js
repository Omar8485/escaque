// Estado global de la generación de puzles en el navegador y hooks de React.
//
// La generación vive fuera de los componentes (módulo único): sigue corriendo si cambias de
// pestaña dentro de la app (p. ej. a Entrenar) y la vuelves a ver al regresar a Puzles.
// En `meta` se guarda si quedó una generación a medias (pestaña cerrada) para reanudarla.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getMeta, setMeta } from '../../storage/db.js';
import { DEFAULT_LIMIT, generationSummary, loadPuzzles, runGeneration } from './runner.js';

export const GENERATOR_META_KEY = 'puzzleGenerator';
const LOCK_NAME = 'escaque:puzzle-generator';

/**
 * @typedef {{status:'idle'|'running'|'cancelling', limit:number, progress:import('./runner.js').GenerationProgress|null,
 *   result:import('./runner.js').GenerationResult|null, error:string|null, busy:boolean, version:number}} GeneratorState
 */

/** @type {GeneratorState} */
let state = { status: 'idle', limit: DEFAULT_LIMIT, progress: null, result: null, error: null, busy: false, version: 0 };
const listeners = new Set();
let controller = null;
let running = null;

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

const saveMeta = (value) => setMeta(GENERATOR_META_KEY, value).catch(() => {});

/** Ejecuta `fn` con un candado entre pestañas (Web Locks) si el navegador lo tiene. */
function withLock(fn) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fn();
  return locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? fn() : { status: 'busy' }));
}

/**
 * Arranca la generación (si ya corre, devuelve la misma promesa).
 * @param {{limit?:number}} [o]
 */
export function startPuzzleGeneration({ limit = state.limit } = {}) {
  if (running) return running;
  controller = new AbortController();
  const { signal } = controller;
  set({ status: 'running', limit, progress: null, result: null, error: null, busy: false });
  running = withLock(async () => {
    await saveMeta({ status: 'running', limit, startedAt: Date.now() });
    const res = await runGeneration({
      limit,
      signal,
      onProgress: (progress) => set({ progress }),
      onGame: ({ puzzles }) => puzzles.length && set({ version: state.version + 1 }),
    });
    await saveMeta({ status: res.status, limit, finishedAt: Date.now() });
    return res;
  })
    .then((res) => {
      if (res?.status === 'busy') set({ status: 'idle', busy: true });
      else set({ status: 'idle', result: res, version: state.version + 1 });
      return res;
    })
    .catch((err) => {
      console.error('No se pudieron generar los puzles:', err);
      saveMeta({ status: 'error', limit, message: String(err?.message ?? err) });
      set({ status: 'idle', error: String(err?.message ?? err), version: state.version + 1 });
      return null;
    })
    .finally(() => {
      running = null;
      controller = null;
    });
  return running;
}

/** Cancela la generación en curso (lo ya analizado se conserva). */
export function cancelPuzzleGeneration() {
  if (!controller) return;
  controller.abort();
  set({ status: 'cancelling' });
}

/** Si una generación quedó a medias (se cerró la pestaña), la reanuda. */
export async function resumeInterruptedGeneration() {
  if (running) return running;
  const meta = await getMeta(GENERATOR_META_KEY).catch(() => null);
  if (meta?.status === 'running') return startPuzzleGeneration({ limit: meta.limit ?? DEFAULT_LIMIT });
  if (meta?.limit != null && state.status === 'idle' && state.limit !== meta.limit) set({ limit: meta.limit });
  return null;
}

/** Cambia el límite elegido (sin arrancar). */
export const setGenerationLimit = (limit) => state.status === 'idle' && set({ limit });
/** Recarga la biblioteca de puzles (p. ej. tras recibir puzles de otro dispositivo). */
export const bumpPuzzleLibrary = () => set({ version: state.version + 1 });

/** Estado de la generación + acciones. */
export function useGeneratePuzzles() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return { ...s, start: startPuzzleGeneration, cancel: cancelPuzzleGeneration, setLimit: setGenerationLimit };
}

/**
 * Un solo campo del estado (p. ej. `version` o `limit`): el componente no se re-renderiza en cada
 * posición analizada, solo cuando cambia ese campo.
 * @param {keyof GeneratorState} key
 */
export function useGeneratorField(key) {
  return useSyncExternalStore(subscribe, () => state[key]);
}

/**
 * Puzles guardados (sin los de partidas borradas) y resumen de partidas analizadas/pendientes.
 * Se recarga cuando la generación encuentra puzles nuevos o termina (`version`).
 * @param {{limit:number, version:number}} p
 */
export function usePuzzleLibrary({ limit, version }) {
  const [lib, setLib] = useState({ loading: true, puzzles: [], summary: null, error: null });
  useEffect(() => {
    let alive = true;
    Promise.all([loadPuzzles(), generationSummary({ limit })])
      .then(([{ puzzles }, summary]) => alive && setLib({ loading: false, puzzles, summary, error: null }))
      .catch((err) => {
        console.error('No se pudieron leer los puzles:', err);
        if (alive) setLib((l) => ({ ...l, loading: false, error: String(err?.message ?? err) }));
      });
    return () => {
      alive = false;
    };
  }, [limit, version]);
  return lib;
}
