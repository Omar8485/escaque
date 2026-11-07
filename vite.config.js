import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { escaquePwa } from './build-tools/pwa.js'
import { escaqueSite } from './build-tools/site.js'

// https://vite.dev/config/
// Estos dos encabezados activan SharedArrayBuffer (requerido por Stockfish multihilo).
// Cualquier hosting de producción debe enviarlos también.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
}

// API del Worker en local: `npx wrangler dev` (puerto 8787 por defecto). Si no está corriendo, el
// proxy responde 200 en texto plano en vez de un 500: la app lo entiende como «sin servidor de
// cuentas» (src/account/api.js) y sigue sin cuenta, sin llenar la consola de errores.
const apiProxy = {
  '/api': {
    target: 'http://localhost:8787',
    configure: (proxy) => {
      proxy.on('error', (_err, _req, res) => {
        if (!res || res.headersSent || typeof res.writeHead !== 'function') return
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end('Worker no disponible (npx wrangler dev)')
      })
    },
  },
}

export default defineConfig(({ mode }) => {
  // Configuración de publicación (ver src/appInfo.js y README, "Publicación"): variables VITE_* del
  // entorno o de .env.production / .env.local (las del entorno mandan).
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [
      react(),
      // SITE_URL (index.html, robots.txt, sitemap.xml), contacto de las páginas legales, analítica
      // opcional y enlace de comentarios: build-tools/site.js (valores por defecto en src/appInfo.js).
      escaqueSite({
        siteUrl: env.VITE_SITE_URL,
        contactEmail: env.VITE_CONTACT_EMAIL,
        controllerName: env.VITE_CONTROLLER_NAME,
        analyticsToken: env.VITE_CF_ANALYTICS_TOKEN,
        feedbackUrl: env.VITE_FEEDBACK_URL,
      }),
      // dist/sw.js (service worker) al terminar el build: build-tools/pwa.js.
      escaquePwa(),
    ],
    server: {
      headers: crossOriginIsolationHeaders,
      proxy: apiProxy,
    },
    preview: {
      headers: crossOriginIsolationHeaders,
      proxy: apiProxy,
    },
  }
})
