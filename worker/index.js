// Worker de Cloudflare: API bajo /api y, como respaldo, los assets estáticos de dist/.
// wrangler.jsonc usa run_worker_first: ["/api", "/api/*"], así que en la práctica este código
// solo se ejecuta para /api/*; los assets los sirve Cloudflare directamente y reciben
// COOP/COEP desde public/_headers. Ese archivo NO se aplica a las respuestas generadas
// aquí, por eso el Worker añade las mismas cabeceras (y otras de seguridad) a todo lo que devuelve.
//
// Sin LLM en el servidor: la IA del coach es opcional y la pone el usuario con su propia clave.
// APIs:
//   /api/health                         estado
//   /api/proxy/chesscom/…               respaldo de la importación de Chess.com (worker/proxy.js)
//   /api/auth/login|callback/:provider  inicio de sesión OIDC (Google, Microsoft) — worker/auth/
//   /api/auth/logout, /api/me           sesión y plan (DELETE /api/me borra la cuenta)
//   /api/me/consent                     aceptar la versión vigente de términos y privacidad
//   /api/billing/products|checkout|portal, /api/webhooks/polar   cobros con Polar — worker/billing/
//   /api/sync/push|pull|status          sincronización Premium — worker/sync/
// Las cuentas son opcionales: sin D1 ni secretos configurados, estas rutas responden 503 y la app
// sigue funcionando sin cuenta, todo en el navegador.
import pkg from '../package.json'
import { jsonError, json, withIsolationHeaders, withSecurityHeaders } from './lib/http.js'
import { isTestMode } from './config.js'

// Solo export default: workerd trata cualquier export con nombre como entrypoint.
const VERSION = pkg.version

async function route(request, url, env, ctx) {
  const path = url.pathname
  if (path === '/api/health') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonError(405, 'method_not_allowed', {}, { Allow: 'GET, HEAD' })
    }
    return json({ ok: true, version: VERSION })
  }
  if (path.startsWith('/api/proxy/')) return (await import('./proxy.js')).handleProxy(request, url, undefined, env)

  let m
  if ((m = path.match(/^\/api\/auth\/login\/([a-z]+)$/))) return (await import('./auth/routes.js')).handleLogin(request, url, env, m[1])
  if ((m = path.match(/^\/api\/auth\/callback\/([a-z]+)$/))) return (await import('./auth/routes.js')).handleCallback(request, url, env, m[1])
  if (path === '/api/auth/logout') return (await import('./auth/routes.js')).handleLogout(request, url, env)
  if (path === '/api/me') return (await import('./auth/routes.js')).handleMe(request, url, env, ctx)
  if (path === '/api/me/consent') return (await import('./auth/routes.js')).handleConsent(request, url, env)

  if (path === '/api/billing/products') return (await import('./billing/routes.js')).handleProducts(request, url, env)
  if (path === '/api/billing/checkout') return (await import('./billing/routes.js')).handleCheckout(request, url, env)
  if (path === '/api/billing/portal') return (await import('./billing/routes.js')).handlePortal(request, url, env)
  if (path === '/api/webhooks/polar') return (await import('./billing/routes.js')).handlePolarWebhook(request, url, env)

  if (path === '/api/sync/push') return (await import('./sync/routes.js')).handlePush(request, url, env)
  if (path === '/api/sync/pull') return (await import('./sync/routes.js')).handlePull(request, url, env)
  if (path === '/api/sync/status' || path === '/api/sync') return (await import('./sync/routes.js')).handleSyncState(request, url, env)

  // Proveedor OIDC simulado: solo con AUTH_TEST_MODE=1 en localhost (nunca en producción).
  if (path === '/api/test-oidc/authorize' && isTestMode(env, url)) return (await import('./auth/testProvider.js')).handleTestAuthorize(url)

  return jsonError(404, 'not_found')
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      let res
      try {
        res = await route(request, url, env, ctx)
      } catch {
        // Sin detalles: nunca se devuelven (ni se registran) tokens, cookies ni secretos.
        res = jsonError(500, 'internal')
      }
      return withSecurityHeaders(res, url)
    }
    // Respaldo (p. ej. si cambia run_worker_first): delegar en los assets y
    // garantizar COOP/COEP aunque _headers no se aplique por esta vía.
    return withIsolationHeaders(await env.ASSETS.fetch(request))
  },
}
