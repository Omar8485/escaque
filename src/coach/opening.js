// Apertura de la partida a partir del historial en SAN (diseño §4.3, `game.opening`).
// El mapa (≈320 kB) se carga aparte: src/data/openings.js. Sin cargar aún, no reconoce ninguna apertura.
import { getOpeningsMap } from '../data/openings.js';

/**
 * Nombre de la apertura más larga reconocida y si la secuencia completa sigue "en libro"
 * (existe como clave de openings_map.json).
 * @param {string[]} sanHistory  jugadas en SAN desde la posición inicial
 * @param {Record<string,string>} [map]
 * @returns {{name: string|null, inBook: boolean}}
 */
export function openingFacts(sanHistory, map = getOpeningsMap()) {
  let key = '';
  let name = null;
  for (let i = 0; i < sanHistory.length; i++) {
    key += (i === 0 ? '' : ' ') + sanHistory[i];
    if (map[key]) name = map[key];
  }
  return { name, inBook: sanHistory.length > 0 && Boolean(map[key]) };
}

/** Nombre de la apertura o '' (compatibilidad con el detector de App.jsx). */
export function detectOpening(sanHistory, map = getOpeningsMap()) {
  return openingFacts(sanHistory, map).name ?? '';
}
