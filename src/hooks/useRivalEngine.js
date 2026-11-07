import { useState, useEffect, useSyncExternalStore } from 'react';
import { RivalEngine } from '../engine/rival.js';


/**
 * Hook delgado sobre RivalEngine (worker propio, independiente del analista).
 * Arranca el worker mientras `enabled` sea true y lo termina al desactivarse o desmontar.
 * Tras reiniciarse, el rival exige un nuevo newGame(level).
 *
 * @param {{enabled?:boolean} & ConstructorParameters<typeof RivalEngine>[0]} [options]
 * @returns {{
 *   rival: RivalEngine,
 *   status: import('../engine/rival.js').RivalStatus,
 *   isReady: boolean,
 *   newGame: RivalEngine['newGame'],
 *   chooseMove: RivalEngine['chooseMove'],
 * }}
 */
export function useRivalEngine({ enabled = true, ...options } = {}) {
  // El constructor no crea el worker, así que es seguro aunque React lo invoque dos veces.
  const [rival] = useState(() => new RivalEngine(options));

  useEffect(() => {
    if (!enabled) return undefined;
    rival.start();
    return () => rival.terminate();
  }, [rival, enabled]);

  const status = useSyncExternalStore(rival.subscribe, rival.getStatus);

  return {
    rival,
    status,
    isReady: status === 'ready',
    newGame: rival.newGame,
    chooseMove: rival.chooseMove,
  };
}
