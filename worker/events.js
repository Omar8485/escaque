// POST /api/e — contadores agregados del embudo (diseño interno §4).
// Cuerpo: {"e": "<evento>", "l": "es"|"en"}. Respuesta 204 sin cuerpo.
// Guarda solo (día UTC, evento, idioma) → contador. La IP se usa en memoria para limitar abusos y no
// se guarda. Sin D1 configurada responde 204 igualmente: la app nunca depende de esto.
import { isEvent, EVENT_LANGS } from '../shared/events.js';
import { allow, clientIp, jsonError, readJsonBody } from './lib/http.js';
import { allowRequest } from './lib/ratelimit.js';

const MAX_BODY = 256;

/** Día UTC AAAA-MM-DD. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function handleEvent(request, url, env, now = Date.now()) {
  const denied = allow(request, 'POST');
  if (denied) return denied;
  const body = await readJsonBody(request, MAX_BODY);
  if (!body.ok) return jsonError(body.status, body.kind);
  const { e, l } = body.value ?? {};
  if (!isEvent(e)) return jsonError(400, 'unknown_event');
  const lang = EVENT_LANGS.includes(l) ? l : 'xx';
  if (!(await allowRequest(env, 'RL_API', `ev:${clientIp(request)}`, now))) return new Response(null, { status: 204 });
  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO events_daily (day, event, lang, count) VALUES (?, ?, ?, 1) ' +
          'ON CONFLICT (day, event, lang) DO UPDATE SET count = count + 1',
      ).bind(utcDay(now), e, lang).run();
    } catch {
      // Sin la tabla (migración no aplicada) o D1 caída: se pierde el contador, nada más.
    }
  }
  return new Response(null, { status: 204 });
}
