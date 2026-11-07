// Utilidades criptográficas sobre Web Crypto (disponible en Workers y en Node ≥ 20). Sin dependencias.

const enc = new TextEncoder();

export function base64UrlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('base64url inválido');
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return base64Decode(b64);
}

export function base64Encode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function base64Decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Cadena aleatoria base64url con `bytes` bytes de entropía. */
export function randomToken(bytes = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? enc.encode(text) : text));
}

export const sha256Base64Url = async (text) => base64UrlEncode(await sha256(text));

async function hmacKey(secret) {
  const raw = typeof secret === 'string' ? enc.encode(secret) : secret;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** HMAC-SHA256 en bytes. `secret` es texto (UTF-8) o bytes. */
export async function hmacSha256(secret, message) {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof message === 'string' ? enc.encode(message) : message));
}

/** Comparación en tiempo constante (para cadenas de igual longitud esperada). */
export function timingSafeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  if (x.length !== y.length) return false; // la longitud no es secreta (firmas de tamaño fijo)
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Firma un objeto como `payload.firma` (base64url) con HMAC; para cookies de corta vida. */
export async function signValue(secret, obj) {
  const payload = base64UrlEncode(enc.encode(JSON.stringify(obj)));
  const sig = base64UrlEncode(await hmacSha256(secret, `v1.${payload}`));
  return `${payload}.${sig}`;
}

/** Verifica y devuelve el objeto firmado con `signValue`, o null. */
export async function verifySignedValue(secret, value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const dot = value.indexOf('.');
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = base64UrlEncode(await hmacSha256(secret, `v1.${payload}`));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    return null;
  }
}

/** code_challenge S256 de PKCE (RFC 7636 §4.2). */
export const pkceChallenge = (verifier) => sha256Base64Url(verifier);
