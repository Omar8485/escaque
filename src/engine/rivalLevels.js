// Niveles del rival (docs/COACH_DESIGN.md §3.2). Solo datos: la calibración (T11) cambia números.
//
// - Niveles 1–3 y 9: `UCI_LimitStrength=false` + `Skill Level` (por debajo de 1320 no hay UCI_Elo).
// - Niveles 4–8: `UCI_LimitStrength=true` + `UCI_Elo` (anula Skill Level) con tiempo fijo por jugada.
// - Cada nivel es un personaje (nombres griegos) con un Elo HUMANO orientativo (`nominalElo`).
// - `UCI_Elo` está calibrado motor contra motor (CCRL 40/4, Stockfish nativo). Con la variante
//   Lite en WASM y < 1 s por jugada juega bastante más flojo que un humano del mismo número: el
//   dueño (≈1495 en Lichess) sintió el antiguo "1500" como un 1200. Por eso los UCI_Elo van
//   ~350 por encima del objetivo humano. Ajuste empírico (2026-11-02), a afinar con T11 y resultados.
// - `delayMs`: retardo mínimo visible [mín, máx] desde que se pide la jugada hasta que se entrega.

/**
 * @typedef {{depth:number} | {movetime:number}} RivalGo
 * @typedef {{
 *   level:number, name:string, epithet:string, label:string,
 *   limitStrength:boolean, elo:number|null, skill:number|null,
 *   go:RivalGo, nominalElo:string, delayMs:[number, number],
 * }} RivalLevel
 */

/** @type {readonly RivalLevel[]} */
export const RIVAL_LEVELS = Object.freeze([
  // Niveles 1–3: Skill Level + profundidad corta (por debajo de UCI_Elo 1320 no hay Elo).
  { level: 1, name: 'Ícaro', epithet: 'vuela alto y cae pronto', limitStrength: false, elo: null, skill: 0, go: { depth: 1 }, nominalElo: '≈600', delayMs: [600, 1200] },
  { level: 2, name: 'Narciso', epithet: 'mira más su reflejo que el tablero', limitStrength: false, elo: null, skill: 3, go: { depth: 3 }, nominalElo: '≈800', delayMs: [600, 1200] },
  { level: 3, name: 'Perseo', epithet: 'aprendiz con suerte de héroe', limitStrength: false, elo: null, skill: 6, go: { depth: 5 }, nominalElo: '≈1000', delayMs: [600, 1200] },
  // Niveles 4–9: UCI_LimitStrength + UCI_Elo. Los Elo del motor van ~350 por encima del Elo
  // humano objetivo (ver cabecera): el "1500" de Stockfish Lite a < 1 s juega como un 1200 humano.
  { level: 4, name: 'Jasón', epithet: 'busca el vellocino y a veces lo encuentra', limitStrength: true, elo: 1450, skill: null, go: { movetime: 800 }, nominalElo: '≈1150', delayMs: [600, 600] },
  { level: 5, name: 'Teseo', epithet: 'sabe salir de cualquier laberinto', limitStrength: true, elo: 1650, skill: null, go: { movetime: 800 }, nominalElo: '≈1300', delayMs: [600, 600] },
  { level: 6, name: 'Héctor', epithet: 'defensor firme de Troya', limitStrength: true, elo: 1850, skill: null, go: { movetime: 1000 }, nominalElo: '≈1500', delayMs: [600, 600] },
  { level: 7, name: 'Odiseo', epithet: 'astuto: siempre prepara una trampa', limitStrength: true, elo: 2050, skill: null, go: { movetime: 1000 }, nominalElo: '≈1700', delayMs: [600, 600] },
  { level: 8, name: 'Aquiles', epithet: 'ataca sin piedad', limitStrength: true, elo: 2300, skill: null, go: { movetime: 1200 }, nominalElo: '≈1900', delayMs: [600, 600] },
  { level: 9, name: 'Heracles', epithet: 'fuerza descomunal', limitStrength: true, elo: 2600, skill: null, go: { movetime: 1500 }, nominalElo: '≈2200', delayMs: [600, 600] },
  // Nivel 10: fuerza completa del Lite.
  { level: 10, name: 'Atenea', epithet: 'la estrategia hecha diosa', limitStrength: false, elo: null, skill: 20, go: { movetime: 1500 }, nominalElo: 'máximo', delayMs: [600, 600] },
].map((l) => Object.freeze({ ...l, label: l.name, go: Object.freeze({ ...l.go }), delayMs: Object.freeze([...l.delayMs]) })));

/** Nivel por defecto: Héctor (≈1500), el rating del usuario en Lichess blitz es ≈1495. */
export const DEFAULT_RIVAL_LEVEL = 6;
export const MIN_RIVAL_LEVEL = 1;
export const MAX_RIVAL_LEVEL = RIVAL_LEVELS.length;

/**
 * Devuelve la definición de un nivel (1–9).
 * @param {number} level
 * @returns {RivalLevel}
 */
export function getRivalLevel(level) {
  const def = RIVAL_LEVELS.find((l) => l.level === level);
  if (!def) throw new RangeError(`Nivel de rival inválido: ${level} (válidos: ${MIN_RIVAL_LEVEL}–${MAX_RIVAL_LEVEL})`);
  return def;
}

/**
 * Comandos `setoption` que fija un nivel. Se envían SIEMPRE todos los que lo definen,
 * así cambiar de nivel entre partidas no arrastra opciones del nivel anterior.
 * @param {RivalLevel} def
 * @returns {string[]}
 */
export function levelOptionCommands(def) {
  const cmds = [`setoption name UCI_LimitStrength value ${def.limitStrength}`];
  if (def.limitStrength) cmds.push(`setoption name UCI_Elo value ${def.elo}`);
  else cmds.push(`setoption name Skill Level value ${def.skill}`);
  return cmds;
}

/**
 * Comando `go` del nivel.
 * @param {RivalLevel} def
 * @returns {string}
 */
export function levelGoCommand(def) {
  if ('depth' in def.go) return `go depth ${def.go.depth}`;
  return `go movetime ${def.go.movetime}`;
}
