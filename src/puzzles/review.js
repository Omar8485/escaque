// Leitner simplificado: solo repasan los puzles que alguna vez se fallaron.
// La fecha se inyecta; los intervalos son días completos (24 h), sin depender del huso horario.
const DAY = 24 * 60 * 60 * 1000;
export const REVIEW_INTERVALS = Object.freeze([1, 3, 7, 14, 30, 60]);

/** Estado de repaso, con compatibilidad para los fallos anteriores a esta función. */
export function reviewFor(progress, id) {
  if (progress.reviews?.[id]) return progress.reviews[id];
  const result = progress.results[id];
  if (result?.result !== 'failed') return null;
  const failedAt = Date.parse(result.date);
  return { box: 0, dueAt: Number.isFinite(failedAt) ? failedAt + DAY : 0 };
}

/** Registra un intento completo. No toca el Elo, la racha ni el primer resultado. */
export function recordReview(progress, id, solved, now = new Date()) {
  const previous = reviewFor(progress, id);
  if (solved && !previous) return progress;
  const box = solved ? Math.min((previous?.box ?? 0) + 1, REVIEW_INTERVALS.length - 1) : 0;
  return {
    ...progress,
    reviews: { ...progress.reviews, [id]: { box, dueAt: now.getTime() + REVIEW_INTERVALS[box] * DAY } },
  };
}

/** Puzles disponibles pendientes, más antiguos primero; los borrados no se incluyen. */
export function duePuzzles(puzzles, progress, now = new Date()) {
  return puzzles.filter((p) => {
    const review = reviewFor(progress, p.id);
    return review && review.dueAt <= now.getTime();
  }).sort((a, b) => reviewFor(progress, a.id).dueAt - reviewFor(progress, b.id).dueAt);
}
