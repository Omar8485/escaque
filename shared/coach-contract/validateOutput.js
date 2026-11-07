// Validación de la salida del LLM (docs/COACH_DESIGN.md §5.3). Se ejecuta SIEMPRE en el navegador,
// después de la respuesta del proveedor que eligió el usuario: si algo falla, se muestra la
// plantilla (no se reintenta, por latencia). Ninguna respuesta del LLM llega a la UI sin pasar por aquí.
import FEEDBACK_SCHEMA from './feedback.schema.json'
import SUMMARY_SCHEMA from './summary.schema.json'
import { validate } from './validate.js'
import { MAX_WHY_CHARS } from './llmOutput.js'

const responseSchemaFor = (requestType) => (requestType === 'game_summary' ? SUMMARY_SCHEMA : FEEDBACK_SCHEMA)

export const MAX_COMMENT_CHARS = 300
/** Texto con aspecto de SAN (piezas, capturas de peón y enroques). */
const SAN_RE = /\b([KQRBN][a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?|[a-h]x[a-h][1-8](=[QRBN])?[+#]?|O-O(-O)?[+#]?)(?![\w])/g
const SQUARE_RE = /\b[a-h][1-8]\b/g
const BRACKET_RE = /\[\[([^\]]*)\]\]/g

/** Textos libres de una respuesta, con su ruta (para mensajes de error). */
function textFields(data, requestType) {
  if (requestType === 'game_summary') {
    return [
      ['headline', data.headline],
      ...data.strengths.map((t, i) => [`strengths[${i}]`, t]),
      ...data.improvements.map((t, i) => [`improvements[${i}]`, t]),
      ...data.keyMoments.map((k, i) => [`keyMoments[${i}].text`, k.text]),
    ]
  }
  return [
    ['comment', data.comment],
    ['hint', data.hint],
    ['question', data.question],
    ['why', data.why],
  ].filter(([, t]) => typeof t === 'string')
}

/** Corta un texto largo en la última oración completa que quepa. */
export function truncateAtSentence(text, max = MAX_COMMENT_CHARS) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '), cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!'))
  return end > 0 ? cut.slice(0, end + 1).trim() : cut.trim()
}

/**
 * Valida y normaliza la respuesta del LLM.
 * @param {unknown} data  JSON ya parseado
 * @param {object} request  CoachRequest validado
 * @param {{forbiddenSquares?: string[]}} [opts]  casillas que no pueden aparecer (destino de la
 *   mejor jugada en las pistas). Nunca se envían al LLM.
 * @returns {{ok: true, data: object} | {ok: false, errors: string[]}}
 */
export function validateOutput(data, request, { forbiddenSquares = [] } = {}) {
  const schemaErrors = validate(data, responseSchemaFor(request.requestType))
  if (schemaErrors.length) return { ok: false, errors: schemaErrors }

  const allowedMoves = new Set(request.allowedMoves)
  const allowedSquares = new Set(request.allowedSquares)
  const forbidden = new Set(forbiddenSquares)
  const errors = []

  for (const [path, text] of textFields(data, request.requestType)) {
    // 2. Jugadas entre [[ ]] solo de allowedMoves.
    for (const [, san] of text.matchAll(BRACKET_RE)) {
      if (!allowedMoves.has(san.trim())) errors.push(`${path}: jugada no permitida [[${san}]]`)
    }
    const outside = text.replace(BRACKET_RE, ' ')
    // 2b. Nada con aspecto de SAN fuera de los corchetes.
    for (const [san] of outside.matchAll(SAN_RE)) errors.push(`${path}: jugada fuera de corchetes "${san}"`)
    // 3. Casillas mencionadas: solo de allowedSquares.
    for (const [sq] of outside.matchAll(SQUARE_RE)) {
      if (!allowedSquares.has(sq)) errors.push(`${path}: casilla no permitida ${sq}`)
    }
    // 4. En pistas, la casilla de destino de la mejor jugada no puede aparecer en ningún sitio.
    for (const [sq] of text.matchAll(SQUARE_RE)) {
      if (forbidden.has(sq)) errors.push(`${path}: casilla prohibida ${sq}`)
    }
  }
  if (errors.length) return { ok: false, errors }

  if (request.requestType === 'game_summary') return { ok: true, data }
  return {
    ok: true,
    data: {
      ...data,
      // 5. La decisión de retroceder es determinista: el LLM solo la redacta.
      suggestTakeback: Boolean(request.policy?.offerTakeback),
      // 6. Comentario demasiado largo → última oración completa ("¿Por qué?" admite algo más).
      comment: truncateAtSentence(data.comment, request.requestType === 'why' ? MAX_WHY_CHARS : MAX_COMMENT_CHARS),
      ...(typeof data.why === 'string' ? { why: truncateAtSentence(data.why, MAX_WHY_CHARS) } : {}),
      ...(request.requestType === 'hint' ? {} : { hint: null }),
    },
  }
}
