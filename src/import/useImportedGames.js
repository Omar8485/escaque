import { useEffect, useState } from 'react';
import { listGames, onGamesChanged } from './store.js';

/**
 * Partidas importadas (de la más reciente a la más antigua), leídas de IndexedDB y
 * actualizadas cuando se importa o se borra.
 * @returns {{games: import('../storage/db.js').Game[], loading: boolean, error: string|null}}
 */
export function useImportedGames() {
  const [state, setState] = useState({ games: [], loading: true, error: null });
  useEffect(() => {
    let alive = true;
    const load = () =>
      listGames().then(
        (games) => alive && setState({ games, loading: false, error: null }),
        (e) => alive && setState({ games: [], loading: false, error: e?.message ?? String(e) }),
      );
    load();
    const off = onGamesChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
