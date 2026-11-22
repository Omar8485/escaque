// Plan de entrenamiento determinista: solo acciones respaldadas por errores y
// recursos existentes. No analiza posiciones ni accede a almacenamiento o red.
const ERRORS = new Set(['Blunder', 'Mistake', 'Inaccuracy']);
const KNOWN_MOTIFS = new Set(['mate', 'jaque_y_ataque', 'ataque_doble', 'captura', 'hanging']);

/**
 * @typedef {Object} TrainingAction
 * @property {string} id estable por debilidad y tipo de acción.
 * @property {'puzzles'|'review'|'practice'} type
 * @property {string} titleKey clave i18n; los textos se traducen en la vista.
 * @property {Object} vars variables para la plantilla.
 * @property {string} weaknessId `${kind}:${key}` de la debilidad que la justifica.
 * @property {Array<object>} evidence jugadas concretas que respaldan la acción.
 * @property {Object} target datos para navegar; no contiene funciones ni JSX.
 */

/**
 * Convierte hasta tres debilidades en acciones realizables. Para practicar una
 * apertura exige errores en tres partidas distintas con esa apertura y color;
 * el nivel 6 es una elección de entrenamiento explícita, no fuerza una línea.
 * @param {Object} metrics salida de computeProgress.
 * @param {{puzzles?:Array<object>, games?:Array<object>}} [resources]
 * @returns {TrainingAction[]}
 */
export function generatePlan(metrics, { puzzles = [], games = [] } = {}) {
  if (!metrics?.weaknesses?.length) return [];
  const byId = new Map((metrics.games ?? []).map((entry) => [entry.game.id, entry.game]));
  for (const game of games) byId.set(game.id, { ...game, ...byId.get(game.id) });
  const actions = [];
  const used = new Set();
  const reviewSets = new Set();
  for (const weakness of metrics.weaknesses.slice(0, 3)) {
    const weaknessId = `${weakness.kind}:${weakness.key}`;
    if (used.has(weaknessId)) continue;
    used.add(weaknessId);
    // Evidence must point at a real saved game and an actual numbered error.
    const evidence = (weakness.evidence ?? []).filter((item) => {
      const game = byId.get(item.gameId);
      return game && Number.isInteger(item.ply) && item.ply > 0
        && ERRORS.has(item.label) && item.color === game.playerColor;
    });
    if (!evidence.length) continue;
    const base = { weaknessId, evidence };

    if (weakness.kind === 'motif' && KNOWN_MOTIFS.has(weakness.key)) {
      const relevant = evidence.filter((item) => item.motif === weakness.key);
      const gameIds = [...new Set(relevant.map((item) => item.gameId))];
      const pool = puzzles.filter((puzzle) => puzzle.id && puzzle.motif === weakness.key
        && gameIds.includes(puzzle.gameId) && puzzle.solution?.length > 0);
      const puzzleIds = [...new Set(pool.map((puzzle) => puzzle.id))].slice(0, 5);
      if (puzzleIds.length) {
        actions.push({ ...base, evidence: relevant, id: `puzzles:${weaknessId}`, type: 'puzzles',
          titleKey: 'progress.plan.puzzles', vars: { count: puzzleIds.length },
          target: { motif: weakness.key, gameIds, puzzleIds, limit: puzzleIds.length } });
        continue;
      }
    }

    if (weakness.kind === 'opening') {
      const opening = (metrics.openings ?? []).find((item) => item.key === weakness.key);
      if (opening?.name && ['w', 'b'].includes(opening.color) && opening.games >= 3) {
        const relevant = evidence.filter((item) => {
          const game = byId.get(item.gameId);
          return item.color === opening.color && game.playerColor === opening.color
            && game.opening === opening.name;
        });
        if (new Set(relevant.map((item) => item.gameId)).size >= 3) {
          actions.push({ ...base, evidence: relevant, id: `practice:${weaknessId}`, type: 'practice',
            titleKey: 'progress.plan.practice', vars: { opening: opening.name },
            target: { level: 6, color: opening.color, opening: opening.name } });
          continue;
        }
      }
    }

    // Si no hay puzles o datos suficientes de apertura, revisar errores graves
    // sigue siendo útil, siempre que tengamos el enlace exacto a esa jugada.
    const seen = new Set();
    const targets = evidence.filter((item) => item.label === 'Blunder')
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || b.ply - a.ply)
      .filter((item) => {
        const key = `${item.gameId}|${item.ply}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 3).map(({ gameId, ply }) => ({ gameId, ply }));
    const signature = JSON.stringify(targets.map(({ gameId, ply }) => [gameId, ply]).sort(
      (a, b) => a[0].localeCompare(b[0]) || a[1] - b[1],
    ));
    if (targets.length && !reviewSets.has(signature)) {
      reviewSets.add(signature);
      actions.push({ ...base, id: `review:${weaknessId}`, type: 'review',
        titleKey: 'progress.plan.review', vars: { count: targets.length },
        target: { ...targets[0], targets } });
    }
  }
  return actions;
}
