// Qué texto muestra el coach: el de la IA o el de la plantilla (v1.1).
//
// - Sin IA (o si no se le pidió nada): la plantilla, al instante.
// - Con la IA redactando y la vista preferida "IA": estado "pensando" (sin texto) hasta que
//   llegue la respuesta o falle; así la plantilla no aparece un segundo para luego cambiar.
// - Con las dos versiones: se muestra la preferida y la otra queda a un clic (alternar).
// - La IA falló o su texto se descartó: queda la plantilla, sin alternativa.

export const VIEW_KEY = 'escaque:coach-view';
export const SOURCES = Object.freeze(['ia', 'plantilla']);

/** Última vista elegida por el usuario ('ia' por defecto). */
export function readPreferredSource(storage = safeStorage()) {
  try {
    return storage?.getItem(VIEW_KEY) === 'plantilla' ? 'plantilla' : 'ia';
  } catch {
    return 'ia';
  }
}

export function writePreferredSource(source, storage = safeStorage()) {
  try {
    storage?.setItem(VIEW_KEY, source === 'plantilla' ? 'plantilla' : 'ia');
  } catch {
    // Sin almacenamiento: dura la sesión.
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{status:'idle'|'loading'|'done'|'failed', text?:string|null, tone?:string, by?:string|null}} LlmText
 * @typedef {{state:'thinking'|'ready', text:string|null, tone:string|null, source:'ia'|'plantilla'|null,
 *   model:string|null, alternate:'ia'|'plantilla'|null, alternateLoading:boolean}} TextChoice
 */

/**
 * @param {{template: {text:string, tone?:string}|null, llm?: LlmText|null, preferred?: 'ia'|'plantilla'}} p
 * @returns {TextChoice}
 */
export function pickText({ template, llm = null, preferred = 'ia' }) {
  const tpl = { text: template?.text ?? null, tone: template?.tone ?? null, source: 'plantilla', model: null };
  const status = llm?.status ?? 'idle';
  const hasIa = status === 'done' && Boolean(llm.text);
  const ia = hasIa ? { text: llm.text, tone: llm.tone ?? tpl.tone, source: 'ia', model: llm.by ?? null } : null;
  if (status === 'loading') {
    if (preferred === 'ia') return { state: 'thinking', text: null, tone: null, source: null, model: null, alternate: null, alternateLoading: false };
    return { state: 'ready', ...tpl, alternate: 'ia', alternateLoading: true };
  }
  if (!ia) return { state: 'ready', ...tpl, alternate: null, alternateLoading: false };
  return preferred === 'plantilla'
    ? { state: 'ready', ...tpl, alternate: 'ia', alternateLoading: false }
    : { state: 'ready', ...ia, alternate: tpl.text ? 'plantilla' : null, alternateLoading: false };
}
