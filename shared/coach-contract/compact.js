// Compactación del CoachRequest antes de enviarlo al LLM (v1.1, docs/COACH_DESIGN.md §7.8).
//
// El CoachRequest completo se valida contra el schema y se usa para validar la respuesta; al
// modelo solo viajan los hechos que el system prompt le pide usar, en JSON sin espacios y sin
// campos null / false / vacíos ("un campo ausente vale null o false", regla del prompt).
// Se quitan, además, datos que el modelo no debe o no necesita interpretar:
// - versiones, idioma y coach (ya están en el system prompt);
// - evalBefore/evalAfter, winBefore/winAfter, loss y profundidades (regla 5: la evaluación va
//   solo con evalLabel*; los números solo si policy.showNumbers);
// - moveUci, color, isBest, moveDetails, playedRank, ply (deducibles de la SAN o sin uso);
// - pieza y casilla de la refutación y de la jugada del rival (están en su SAN);
// - piezas colgadas no confirmadas por el motor (regla 7: no se pueden mencionar);
// - history salvo repeatedMotif (lo único que usa el prompt).

/** Booleanos cuyo `false` es un hecho (no "ausente"). */
const KEEP_FALSE = new Set(['defended'])

/** Quita null, undefined, false (salvo KEEP_FALSE), arreglos y objetos vacíos, en profundidad. */
export function prune(value, key = '') {
  if (Array.isArray(value)) {
    const arr = value.map((v) => prune(v)).filter((v) => v !== undefined)
    return arr.length ? arr : undefined
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v, k)
      if (p !== undefined) out[k] = p
    }
    return Object.keys(out).length ? out : undefined
  }
  if (value === null || value === undefined) return undefined
  if (value === false && !KEEP_FALSE.has(key)) return undefined
  return value
}

/**
 * Hechos que viajan al LLM.
 * @param {object} r  CoachRequest completo (ya validado)
 * @returns {object}
 */
export function compactRequest(r) {
  const c = r.classification
  const showNumbers = Boolean(r.policy?.showNumbers)
  const ref = r.refutation
  const out = {
    requestType: r.requestType,
    player: r.player,
    rival: r.rival?.label ? { level: r.rival.level, label: r.rival.label } : r.rival,
    game: r.game && { moveNumber: r.game.moveNumber, phase: r.game.phase, materialBalance: r.game.materialBalance, opening: r.game.opening },
    lastRivalMove: r.lastRivalMove && { san: r.lastRivalMove.san, capture: r.lastRivalMove.capture },
    classification: c && {
      label: c.label,
      moveSan: c.moveSan,
      bestMoveSan: c.bestMoveSan,
      pvSan: c.pvSan,
      ...(showNumbers ? { winBefore: c.winBefore, winAfter: c.winAfter, loss: c.loss } : {}),
    },
    coachFacts: r.coachFacts && { ...r.coachFacts, playedRank: null },
    refutation: ref && { san: ref.san, check: ref.check, captures: ref.captures, motif: ref.motif, mateIn: ref.mateIn, targets: ref.targets },
    refutationLine: r.refutationLine,
    hanging: r.hanging?.filter((h) => h.confirmedByEngine).map(({ square, piece, defended }) => ({ square, piece, defended })),
    opponentLoose: r.opponentLoose,
    hintFacts: r.hintFacts,
    history: r.history?.repeatedMotif ? { repeatedMotif: r.history.repeatedMotif } : null,
    policy: r.policy,
    summary: r.summary,
    allowedMoves: r.allowedMoves,
    allowedSquares: r.allowedSquares,
    userQuestion: r.userQuestion,
  }
  return prune(out) ?? {}
}
