// Proveedor OpenID Connect SIMULADO, solo para pruebas e2e con `wrangler dev`.
// Solo existe si isTestMode(env, url): AUTH_TEST_MODE=1 y la petición llega a localhost/127.0.0.1.
// Emite id_tokens RS256 firmados con una clave generada en memoria y los valida el MISMO código
// que a Google y Microsoft (firma JWKS, iss, aud, exp, nonce), con PKCE S256 comprobado.
import { base64UrlEncode, pkceChallenge, randomToken } from '../lib/crypto.js';

export const TEST_CLIENT_ID = 'escaque-test-client';
const codes = new Map();
let keyPair = null;
const KID = 'test-key-1';

async function keys() {
  if (!keyPair) {
    keyPair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    );
  }
  return keyPair;
}

async function signJwt(payload) {
  const { privateKey } = await keys();
  const enc = new TextEncoder();
  const head = base64UrlEncode(enc.encode(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' })));
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${base64UrlEncode(sig)}`;
}

const issuerFor = (url) => `${url.origin}/api/test-oidc`;

/** Página de "autorización" simulada: concede al instante a la identidad de `login_hint`. */
export function handleTestAuthorize(url) {
  const p = url.searchParams;
  const redirectUri = p.get('redirect_uri') ?? '';
  if (!redirectUri.startsWith(`${url.origin}/api/auth/callback/test`)) return new Response('redirect_uri inválido', { status: 400 });
  const hint = (p.get('login_hint') || 'tester').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'tester';
  const code = randomToken(24);
  codes.set(code, {
    nonce: p.get('nonce'),
    challenge: p.get('code_challenge'),
    redirectUri,
    sub: `test-${hint}`,
    email: `${hint}@example.test`,
    name: hint,
    expires: Date.now() + 60_000,
  });
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  back.searchParams.set('state', p.get('state') ?? '');
  return new Response(null, { status: 302, headers: { Location: back.toString(), 'Cache-Control': 'no-store' } });
}

export function createTestProvider(url) {
  return {
    name: 'test',
    clientId: TEST_CLIENT_ID,
    scope: 'openid email profile',
    issuer: issuerFor(url),
    authorizeUrl: `${url.origin}/api/test-oidc/authorize`,
    authParams: {},
    async exchangeCode({ code, verifier, redirectUri }) {
      const entry = codes.get(code);
      codes.delete(code);
      if (!entry || entry.expires < Date.now() || entry.redirectUri !== redirectUri) throw new Error('invalid_grant');
      if ((await pkceChallenge(verifier)) !== entry.challenge) throw new Error('invalid_pkce');
      const now = Math.floor(Date.now() / 1000);
      return signJwt({
        iss: issuerFor(url), aud: TEST_CLIENT_ID, sub: entry.sub, email: entry.email, email_verified: true,
        name: entry.name, nonce: entry.nonce, iat: now, exp: now + 300,
      });
    },
    async resolveKey(kid) {
      if (kid !== KID) return null;
      return { ...(await crypto.subtle.exportKey('jwk', (await keys()).publicKey)), kid: KID };
    },
  };
}
