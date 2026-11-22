// Esquemas de salida que se piden AL LLM (v1.1) y su normalización al contrato CoachFeedback.
//
// El contrato completo (feedback.schema.json) tiene campos que el modelo no necesita escribir:
// `suggestTakeback` lo decide el código (= policy.offerTakeback), `concepts` y `factsUsed` no los
// usa la interfaz. Pedirlos costaba ~30–60 tokens de SALIDA por llamada (la salida cuesta ~8×
// la entrada en Gemini 3.5 Flash-Lite). Aquí se pide solo lo que se muestra y luego se completa
// el objeto para que validateOutput (§5.3) valide siempre el contrato completo.
import SUMMARY_SCHEMA from './summary.schema.json'
import { toLlmSchema } from './validate.js'

const TONE = { type: 'string', enum: ['elogio', 'neutral', 'advertencia', 'alerta'] }
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })

/** Largo máximo del texto de "¿Por qué?". */
export const MAX_WHY_CHARS = 450

/**
 * JSON Schema que se envía al proveedor para esta petición.
 * @param {object} request  CoachRequest
 */
export function llmSchemaFor(request) {
  switch (request.requestType) {
    case 'game_summary':
      return toLlmSchema(SUMMARY_SCHEMA)
    case 'hint':
      return obj({ hint: { type: 'string' }, tone: TONE })
    case 'why':
      return obj({ comment: { type: 'string' }, tone: TONE })
    default:
      return obj({
        comment: { type: 'string' },
        tone: TONE,
        question: { type: ['string', 'null'] },
        ...(request.policy?.explainWhy ? { why: { type: 'string' } } : {}),
      })
  }
}

/**
 * Completa la respuesta del LLM hasta la forma de CoachFeedback (§5.1). No inventa texto: solo
 * rellena los campos que decide el código o que la UI no usa. Lo que no es un objeto se devuelve
 * tal cual (validateOutput lo rechazará).
 * @param {unknown} data
 * @param {object} request
 */
export function normalizeLlmOutput(data, request) {
  if (request.requestType === 'game_summary' || !data || typeof data !== 'object' || Array.isArray(data)) return data
  const out = {
    comment: data.comment ?? (request.requestType === 'hint' ? '' : data.comment),
    tone: data.tone,
    suggestTakeback: Boolean(request.policy?.offerTakeback),
    hint: data.hint ?? null,
    question: data.question ?? null,
    concepts: data.concepts ?? [],
    factsUsed: data.factsUsed ?? [],
  }
  if (request.policy?.explainWhy && request.requestType === 'move_feedback') out.why = data.why ?? null
  return out
}

/** Palabras de un texto para comparar (sin corchetes, minúsculas, sin palabras de 1–2 letras). */
function words(text) {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .replace(/\[\[|\]\]/g, ' ')
      .split(/[^\p{L}\p{N}+#=-]+/u)
      .filter((w) => w.length > 2),
  )
}

/**
 * ¿`b` repite casi lo mismo que `a`? (Jaccard de palabras ≥ umbral, o `b` contenido en `a`).
 * Sirve para descartar un "¿Por qué?" de la IA que no aporta nada sobre el comentario inicial.
 */
export function isRepetition(a, b, threshold = 0.6) {
  const A = words(a)
  const B = words(b)
  if (!B.size) return true
  let inter = 0
  for (const w of B) if (A.has(w)) inter += 1
  const jaccard = inter / (A.size + B.size - inter)
  return jaccard >= threshold || inter / B.size >= 0.9
}
