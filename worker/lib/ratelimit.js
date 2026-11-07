// Límites de frecuencia. Usa el binding de Rate Limiting de Workers si está configurado
// (wrangler.jsonc → "ratelimits"; contadores por ubicación de Cloudflare, aproximados) y, si no,
// un contador en memoria del isolate (mejor que nada: cada isolate cuenta por separado).

/** Valores por defecto de la ventana en memoria (deben coincidir con wrangler.jsonc). */
export const MEMORY_LIMITS = Object.freeze({
  RL_AUTH: { limit: 20, periodMs: 60_000 },
  RL_API: { limit: 120, periodMs: 60_000 },
  RL_WEBHOOK: { limit: 120, periodMs: 60_000 },
});

const memory = new Map();
const MAX_KEYS = 5000;

/** Solo para tests. */
export const _resetMemoryLimits = () => memory.clear();

function memoryLimit(name, key, now) {
  const cfg = MEMORY_LIMITS[name] ?? { limit: 60, periodMs: 60_000 };
  const id = `${name}:${key}`;
  let entry = memory.get(id);
  if (!entry || now - entry.start >= cfg.periodMs) {
    if (memory.size >= MAX_KEYS) memory.clear();
    entry = { start: now, count: 0 };
    memory.set(id, entry);
  }
  entry.count += 1;
  return entry.count <= cfg.limit;
}

/**
 * ¿Se permite una petición más con esta clave?
 * @param {object} env
 * @param {'RL_AUTH'|'RL_API'|'RL_WEBHOOK'} name
 * @param {string} key  p. ej. `ip:1.2.3.4` o `user:<id>`
 */
export async function allowRequest(env, name, key, now = Date.now()) {
  const binding = env?.[name];
  if (binding && typeof binding.limit === 'function') {
    try {
      const { success } = await binding.limit({ key });
      return success;
    } catch {
      // binding no disponible en este entorno: contador en memoria
    }
  }
  return memoryLimit(name, key, now);
}
