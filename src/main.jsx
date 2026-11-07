import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import I18nProvider from './i18n/I18nProvider.jsx'
import UpdateToast from './pwa/UpdateToast.jsx'
import { initPwa } from './pwa/pwa.js'
import { loadOpeningsMap } from './data/openings.js'
import { prefetchScreens } from './screens.js'

// Antes de pintar: registra el service worker (solo en el build) y escucha la instalación.
initPwa()
// Datos y pantallas diferidas: en paralelo, sin bloquear la primera pintura.
loadOpeningsMap().catch(() => {})
prefetchScreens()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <App />
      <UpdateToast />
    </I18nProvider>
  </StrictMode>,
)
