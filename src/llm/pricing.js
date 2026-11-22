// Precios APROXIMADOS por modelo (USD por millón de tokens), en un solo lugar.
// Solo sirven para estimar el costo que se muestra en el panel de IA: la factura real es la de tu
// proveedor (puede cambiar precios, aplicar nivel gratuito, impuestos o descuentos por caché).
// Revisados en las páginas oficiales el 2026-11-02:
// - Gemini: ai.google.dev/gemini-api/docs/pricing (nivel de pago "Standard"; en el nivel gratuito
//   el costo es 0).
// - Anthropic: platform.claude.com/docs/en/about-claude/pricing (prompts ≤ 100k tokens).
// OpenAI no publicaba en su página de precios los de gpt-6-*: sin entrada → "sin precio".
// Para añadir o corregir un modelo, edita MODEL_PRICES.

export const PRICES_CHECKED = '2026-11-02';

/**
 * @typedef {{input:number, output:number, cachedInput?:number}} ModelPrice  USD / 1M tokens;
 *   `output` incluye el razonamiento (thinking).
 */

/** Se usa la primera coincidencia; se compara con el modelo sin prefijo de OpenRouter ("google/"). */
export const MODEL_PRICES = Object.freeze([
  { match: /^gemini-3\.5-flash-lite/, input: 0.3, output: 2.5, cachedInput: 0.03 },
  { match: /^gemini-3\.1-flash-lite/, input: 0.25, output: 1.5, cachedInput: 0.025 },
  { match: /^gemini-3\.8-flash/, input: 0.75, output: 3.75, cachedInput: 0.075 },
  { match: /^claude-haiku-5-5/, input: 0.1, output: 0.5, cachedInput: 0.01 },
  { match: /^claude-sonnet-5-5/, input: 2, output: 10, cachedInput: 0.1 },
]);

/** Precio de un modelo (o null si no está en la tabla). */
export function priceFor(model) {
  const name = String(model ?? '').replace(/^[\w-]+\//, '');
  const p = MODEL_PRICES.find((m) => m.match.test(name));
  return p ? { input: p.input, output: p.output, cachedInput: p.cachedInput ?? p.input } : null;
}

/**
 * Costo estimado de una llamada en USD (o null si el modelo no tiene precio).
 * @param {{inputTokens?:number, cachedTokens?:number, outputTokens?:number, reasoningTokens?:number}} usage
 * @param {string} model
 */
export function estimateCostUsd(usage, model) {
  const p = priceFor(model);
  if (!p) return null;
  const cached = Math.min(usage.cachedTokens ?? 0, usage.inputTokens ?? 0);
  const fresh = (usage.inputTokens ?? 0) - cached;
  const out = (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
  return (fresh * p.input + cached * p.cachedInput + out * p.output) / 1e6;
}
