// Un único snapshot de IndexedDB; la lógica de métricas no conoce almacenamiento.
import { openDb, STORES } from '../storage/db.js';

/** @returns {Promise<{games:object[],analysis:object[],moves:object[],puzzles:object[]}>} */
export async function loadProgressData() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const stores = [STORES.games, STORES.analysis, STORES.moves, STORES.puzzles];
    const tx = db.transaction(stores, 'readonly');
    const snapshot = {};
    for (const name of stores) {
      const req = tx.objectStore(name).getAll();
      req.onsuccess = () => { snapshot[name] = req.result; };
    }
    tx.oncomplete = () => {
      const ids = new Set(snapshot.games.map((g) => g.id));
      resolve({
        games: snapshot.games,
        analysis: snapshot.analysis.filter((a) => ids.has(a.gameId)),
        moves: snapshot.moves.filter((m) => ids.has(m.gameId)),
        puzzles: snapshot.puzzles.filter((p) => ids.has(p.gameId)),
      });
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Snapshot aborted'));
  });
}
