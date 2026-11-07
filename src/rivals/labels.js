// Textos de los rivales que dependen del idioma: lema (epíteto) y Elo orientativo.
// Los nombres (Ícaro, Héctor…) no se traducen. Ver docs/I18N.md.

/**
 * Lema del rival en el idioma de `t` ("defensor firme de Troya" / "Troy's steadfast defender").
 * @param {{level:number, epithet:string}} def  @param {import('../i18n/core.js').TFunction} t
 */
export const rivalEpithet = (def, t) => {
  const key = `rivals.epithet.${def.level}`;
  const text = t(key);
  return text === key ? def.epithet : text;
};

/** Elo orientativo ("≈1500"); el nivel máximo no tiene número ("máximo" / "max"). */
export const rivalEloText = (def, t) => (def.nominalElo.startsWith('≈') ? def.nominalElo : t('rivals.maxElo'));
