// Contrato del coach (docs/COACH_DESIGN.md §4.4 y §5): schemas, system prompt y validación de la
// salida del LLM. Todo corre en el navegador (src/coach/*, src/llm/*): Escaque no tiene LLM en
// su servidor; la IA es opcional y la pone el usuario con su propia clave.
import REQUEST_SCHEMA from './request.schema.json';
import FEEDBACK_SCHEMA from './feedback.schema.json';
import SUMMARY_SCHEMA from './summary.schema.json';
import { validate, toLlmSchema } from './validate.js';

export { REQUEST_SCHEMA, FEEDBACK_SCHEMA, SUMMARY_SCHEMA, validate, toLlmSchema };

export const SCHEMA_VERSION = 1;
export { PROMPT_VERSION, systemPrompt, userMessage, SYSTEM_PROMPT } from './prompt.js';
export { validateOutput, truncateAtSentence, MAX_COMMENT_CHARS } from './validateOutput.js';
export { COACHES, COACH_IDS, DEFAULT_COACH, getCoach } from './coaches.js';
export { llmSchemaFor, normalizeLlmOutput, isRepetition, MAX_WHY_CHARS } from './llmOutput.js';
export { compactRequest, prune } from './compact.js';

export const REQUEST_TYPES = Object.freeze(['move_feedback', 'hint', 'why', 'game_summary']);

/** Errores de validación de un CoachRequest (vacío si es válido). */
export function validateRequest(request) {
  return validate(request, REQUEST_SCHEMA);
}

/** Schema de salida según el tipo de petición. */
export function responseSchemaFor(requestType) {
  return requestType === 'game_summary' ? SUMMARY_SCHEMA : FEEDBACK_SCHEMA;
}
