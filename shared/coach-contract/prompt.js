// System prompt y mensaje de usuario del coach según el idioma de la petición (`locale`):
// español (prompt.es.js) o inglés (prompt.en.js). Las reglas de veracidad son las mismas en los
// dos y la validación de la salida (validateOutput.js) no depende del idioma.
import { systemPromptEs, userMessageEs } from './prompt.es.js'
import { systemPromptEn, userMessageEn } from './prompt.en.js'

/** Versión del system prompt. Forma parte de la clave de caché (junto con el idioma).
 * v4: prompt por idioma (es/en). Historial anterior en prompt.es.js. */
export const PROMPT_VERSION = 'coach-v4'

const isEn = (request) => request?.locale === 'en'

/**
 * System prompt para un coach y, opcionalmente, una petición (su tipo elige la tarea y su
 * `locale` el idioma; sin petición, español).
 * @param {string} [coachId]
 * @param {object} [request]
 */
export function systemPrompt(coachId, request = null) {
  return isEn(request) ? systemPromptEn(coachId, request) : systemPromptEs(coachId, request)
}

/** Prompt del coach por defecto (Alfred, en español). */
export const SYSTEM_PROMPT = systemPrompt()

/** Mensaje de usuario en el idioma de la petición: cabecera + hechos compactos. */
export function userMessage(request) {
  return isEn(request) ? userMessageEn(request) : userMessageEs(request)
}
