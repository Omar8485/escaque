// Errores comunes de los adaptadores LLM del navegador (docs/COACH_DESIGN.md §8).
// Cada adaptador traduce las respuestas de su proveedor a uno de estos tipos; el resto de la app
// (coachClient, la pantalla de configuración) solo conoce `kind`.

import { getT } from '../i18n/core.js';

/**
 * @typedef {'auth'|'quota'|'rate_limited'|'timeout'|'network'|'aborted'|'invalid_output'|
 *   'unavailable'|'bad_request'|'model_not_found'|'safety_blocked'} LlmErrorKind
 */

export class LlmError extends Error {
  /**
   * @param {LlmErrorKind} kind
   * @param {string} message  detalle técnico (para la consola; nunca incluye la clave)
   * @param {{status?: number, retryAfterMs?: number, provider?: string, model?: string}} [extra]
   */
  constructor(kind, message, { status, retryAfterMs, provider = 'unknown', model } = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.provider = provider;
    this.model = model;
  }
}

/** Tipos de error con mensaje para el usuario (`ai.error.<tipo>` en los diccionarios). */
const USER_MESSAGE_KINDS = new Set([
  'auth', 'quota', 'rate_limited', 'timeout', 'network', 'aborted', 'invalid_output', 'unavailable', 'bad_request', 'model_not_found', 'safety_blocked',
]);

/**
 * Mensaje claro para el usuario según el tipo de error (pantalla "Probar conexión").
 * @param {{kind?: string}|null|undefined} err
 * @param {import('../i18n/core.js').TFunction} [t]  traductor (por defecto, español)
 */
export function userMessageFor(err, t = getT('es')) {
  return USER_MESSAGE_KINDS.has(err?.kind) ? t(`ai.error.${err.kind}`) : t('ai.error.unknown');
}
