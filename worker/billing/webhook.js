// Verificación de webhooks de Polar con el esquema Standard Webhooks
// (github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md):
//   contenido firmado = `${webhook-id}.${webhook-timestamp}.${cuerpo}`, HMAC-SHA256,
//   cabecera `webhook-signature` = lista separada por espacios de `v1,<base64>`.
// Clave (polar.sh/docs/integrate/webhooks/delivery, consultado 2026-11-02):
//   - secretos creados desde el 8-sep-2026: Standard Webhooks → bytes = base64 de lo que sigue a `whsec_`;
//   - secretos anteriores («Polar HMAC»): bytes UTF-8 de la cadena `whsec_…` completa.
// Como hacen los SDK de Polar, se prueban las dos claves.
import { base64Decode, base64Encode, hmacSha256, timingSafeEqual } from '../lib/crypto.js';

/** Claves candidatas para un secreto de Polar. */
export function webhookKeys(secret) {
  const keys = [];
  if (typeof secret !== 'string' || !secret) return keys;
  const body = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
      const raw = base64Decode(body);
      if (raw.length >= 16) keys.push(raw);
    }
  } catch {
    // no es base64: solo la clave antigua
  }
  keys.push(new TextEncoder().encode(secret));
  return keys;
}

/** Firma `v1,<base64>` de un mensaje (la usan los tests y el e2e para simular a Polar). */
export async function signWebhook(keyBytes, id, timestamp, body) {
  return `v1,${base64Encode(await hmacSha256(keyBytes, `${id}.${timestamp}.${body}`))}`;
}

/**
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function verifyWebhook({ secret, headers, body, toleranceS, now = Date.now() }) {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !ts || !sigHeader || id.length > 200 || sigHeader.length > 2000) return { ok: false, reason: 'headers' };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'timestamp' };
  if (Math.abs(Math.floor(now / 1000) - Number(ts)) > toleranceS) return { ok: false, reason: 'timestamp' };
  const sent = sigHeader.split(' ').map((s) => s.trim()).filter((s) => s.startsWith('v1,')).map((s) => s.slice(3));
  if (!sent.length) return { ok: false, reason: 'signature' };
  for (const key of webhookKeys(secret)) {
    const expected = (await signWebhook(key, id, ts, body)).slice(3);
    if (sent.some((s) => timingSafeEqual(s, expected))) return { ok: true };
  }
  return { ok: false, reason: 'signature' };
}
