// Voz del rival durante la partida de Entrenar (React). La lógica vive en voice.js; aquí solo
// se conectan los eventos de App, los temporizadores y la preferencia "El rival habla".
import { useCallback, useEffect, useRef, useState } from 'react';
import { COALESCE_MS, createVoiceController, displayMs, speechText } from './voice.js';

const PREF_KEY = 'escaque:rival-voice';
/** Duración de la animación de salida del globo (ms). */
export const SPEECH_EXIT_MS = 220;

/** ¿El rival habla? (por defecto sí). */
export function readRivalVoicePref() {
  try {
    return globalThis.localStorage?.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** @param {boolean} on */
export function writeRivalVoicePref(on) {
  try {
    globalThis.localStorage?.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Sin almacenamiento: la preferencia dura la sesión.
  }
}

/**
 * @param {object} p
 * @param {boolean} p.enabled  se puede mostrar el globo (pestaña Entrenar, sin puzle)
 * @param {number} p.level  nivel del rival (1–10)
 * @param {number} p.gameId  id de la partida (useGameLoop)
 * @param {'setup'|'playing'|'over'} p.status
 * @param {{reason:string, winner:'w'|'b'|null}|null} p.result
 * @param {'w'|'b'} p.playerColor
 * @param {{color:'w'|'b', before:string, lan:string}[]} p.history  game.history({verbose:true})
 * @param {{key:string, label:string, moveSan?:string|null, greatMove?:boolean}|null} p.playerMove
 *        clasificación de tu última jugada (vista del coach o clasificación de App), clave "<FEN antes>|<UCI>"
 * @param {boolean} p.coachHolding  el coach analiza tu jugada o te tiene detenido (coach.rivalBlocked)
 * @param {string} [p.lang]  idioma de la interfaz ('es' | 'en'): la frase se traduce al mostrarla
 * @param {Parameters<typeof createVoiceController>[0]} [p.options]  rng/now/probabilidades (tests)
 */
export function useRivalVoice({ enabled, level, gameId, status, result, playerColor, history, playerMove, coachHolding, lang = 'es', options }) {
  const [controller] = useState(() => createVoiceController(options));
  const [voiceOn, setVoiceOnState] = useState(readRivalVoicePref);
  /** @type {[import('./voice.js').Speech & {gameId:number, closing?:boolean} | null, Function]} */
  const [speech, setSpeech] = useState(null);
  const flushTimer = useRef(null);
  const exitTimer = useRef(null);
  const voiceOnRef = useRef(voiceOn);
  const gameIdRef = useRef(gameId);
  useEffect(() => {
    voiceOnRef.current = voiceOn;
    gameIdRef.current = gameId;
  });

  // Junta los eventos que llegan casi a la vez y decide una sola frase (prioridad).
  const schedule = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const s = controller.flush();
      // Silenciado: el rival "piensa" la frase (cuenta para no repetir) pero no la dice.
      if (s && voiceOnRef.current) {
        clearTimeout(exitTimer.current);
        setSpeech({ ...s, gameId: gameIdRef.current });
      }
    }, COALESCE_MS);
  }, [controller]);
  useEffect(() => () => {
    clearTimeout(flushTimer.current);
    clearTimeout(exitTimer.current);
  }, []);

  // Inicio de partida.
  useEffect(() => {
    if (status === 'setup') return;
    if (controller.startGame({ gameId, level, playerColor })) schedule();
  }, [controller, schedule, status, gameId, level, playerColor]);

  // Tus jugadas clasificadas (y la regla del coach). Barato: se evalúa en cada render.
  const plies = history.length;
  const classified = playerMove?.key && playerMove.label
    ? { key: playerMove.key, label: playerMove.label, moveSan: playerMove.moveSan ?? null, great: Boolean(playerMove.greatMove) }
    : null;
  const classifiedKey = classified ? `${classified.key}|${classified.label}` : null;
  const lastKey = plies ? `${history[plies - 1].before}|${history[plies - 1].lan}` : null;
  const historyRef = useRef(history);
  const classifiedRef = useRef(classified);
  useEffect(() => {
    historyRef.current = history;
    classifiedRef.current = classified;
  });
  useEffect(() => {
    if (status !== 'playing') return;
    if (controller.observe({ history: historyRef.current, classified: classifiedRef.current, coachHolding })) schedule();
  }, [controller, schedule, status, plies, lastKey, classifiedKey, coachHolding]);

  // Fin de partida (mate, tablas, tiempo o abandono): siempre habla.
  useEffect(() => {
    if (status !== 'over' || !result) return;
    controller.observe({ history: historyRef.current, classified: null, coachHolding: false });
    if (controller.end(result)) schedule();
  }, [controller, schedule, status, result]);

  /** Cierra el globo con su animación de salida. */
  const dismiss = useCallback(() => {
    setSpeech((s) => (s && !s.closing ? { ...s, closing: true } : s));
    clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => setSpeech((s) => (s?.closing ? null : s)), SPEECH_EXIT_MS);
  }, []);

  // Se cierra solo tras unos segundos.
  const speechId = speech && !speech.closing ? speech.id : null;
  const shownText = speech ? speechText(speech, lang) : '';
  useEffect(() => {
    if (speechId === null) return undefined;
    const t = setTimeout(dismiss, displayMs(shownText));
    return () => clearTimeout(t);
  }, [speechId, shownText, dismiss]);

  /**
   * Jugada del rival clasificada (salida de classifyMove para SU jugada). Puede hacerle presumir.
   * Conectado en App.jsx: `onRivalMoveClassified` (useMoveLedger) llama a `rivalVoice.notifyRivalMove`.
   */
  const notifyRivalMove = useCallback(
    (classification) => {
      if (controller.notifyRivalMove(classification)) schedule();
    },
    [controller, schedule],
  );

  const setVoiceOn = useCallback((on) => {
    setVoiceOnState(on);
    writeRivalVoicePref(on);
    if (!on) setSpeech(null);
  }, []);

  // Visible solo en Entrenar, con la voz activa, en esta partida y si su jugada sigue en el tablero.
  // El texto se calcula al pintar con el idioma actual (cambiar de idioma traduce el globo abierto).
  const visible = speech && enabled && voiceOn && speech.gameId === gameId && speech.ply <= plies ? { ...speech, text: shownText } : null;

  return { speech: visible, dismiss, voiceOn, setVoiceOn, notifyRivalMove };
}
