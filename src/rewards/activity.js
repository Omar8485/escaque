/** Shared training eligibility: a resignation after the first own move is not training XP. */
export function eligibleTraining({ plies, playerColor, startColor = 'w', reason } = {}) {
  if (!Number.isInteger(plies) || plies < 1) return false;
  const ownMoves = ['w', 'b'].includes(playerColor)
    ? playerColor === startColor ? Math.ceil(plies / 2) : Math.floor(plies / 2)
    : Math.ceil(plies / 2);
  return !(/abandon|resign/i.test(reason ?? '') && ownMoves <= 1);
}
