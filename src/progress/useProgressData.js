import { useEffect, useState } from 'react';
import { onGamesChanged } from '../import/store.js';
import { useGeneratorField } from '../puzzles/generator/useGeneratePuzzles.js';
import { loadProgressData } from './loadData.js';

/** Actualiza al guardar/borrar partidas o terminar análisis, incluso sin puzles nuevos. */
export function useProgressData() {
  const version = useGeneratorField('version');
  const [data, setData] = useState({ games: [], analysis: [], moves: [], puzzles: [], loading: true, error: false });
  useEffect(() => {
    let alive = true;
    let request = 0;
    const load = () => {
      const current = ++request;
      loadProgressData().then(
        (snapshot) => { if (alive && current === request) setData({ ...snapshot, loading: false, error: false }); },
        () => { if (alive && current === request) setData({ games: [], analysis: [], moves: [], puzzles: [], loading: false, error: true }); },
      );
    };
    load();
    const unsubscribe = onGamesChanged(load);
    return () => { alive = false; unsubscribe(); };
  }, [version]);
  return data;
}
