// Datos públicos de la app, en un solo sitio. Lo que el dueño debe completar antes de publicar está
// marcado con «COMPLETAR». Se pueden cambiar aquí o, sin tocar el código, con variables de entorno
// en el build (archivo .env.production o el entorno de CI): ver README, sección "Publicación".

// Nombre de la app (elegido por el dueño el 2026-11-02). Si cambia: aquí, en <title> de index.html
// y en public/manifest*.webmanifest.
export const APP_NAME = 'Escaque';

// COMPLETAR: URL pública, sin barra final (p. ej. https://escaque.app o
// https://coach-chess.<tu-subdominio>.workers.dev). La usan las etiquetas canonical y Open Graph de
// index.html, robots.txt y sitemap.xml (build-tools/site.js la inyecta en el build).
// Variable de entorno: VITE_SITE_URL.
export const DEFAULT_SITE_URL = 'https://coach-chess.example.workers.dev';

// Correo de contacto del responsable (2026-11-07): aparece en las páginas
// legales (public/privacidad.html, privacy.html, terminos.html y terms.html) para soporte y para
// ejercer los derechos sobre los datos. Vacío = esas páginas muestran un aviso "pendiente".
// Variable de entorno: VITE_CONTACT_EMAIL.
export const DEFAULT_CONTACT_EMAIL = 'escaque.ec@gmail.com';

// Nombre del responsable del tratamiento (persona natural) en las páginas legales publicadas.
// NO se guarda en el repositorio: se lee en el build de la variable VITE_CONTROLLER_NAME
// (p. ej. en `.env.production.local`, que git ignora). Si está vacía, las páginas dicen
// «el titular de Escaque» / «the owner of Escaque».
export const DEFAULT_CONTROLLER_NAME = '';

// OPCIONAL: enlace "Enviar comentarios" del menú (formulario, correo `mailto:` o issues de GitHub).
// Vacío = el enlace no aparece. Por defecto, los issues del repositorio público Omar8485/escaque.
// Variable de entorno: VITE_FEEDBACK_URL.
export const DEFAULT_FEEDBACK_URL = 'https://github.com/Omar8485/escaque/issues';

// OPCIONAL: token del sitio en Cloudflare Web Analytics (sin cookies). Vacío = sin analítica (por
// defecto). Con token, el build añade el script de Cloudflare a index.html y la política de
// privacidad lo menciona. Variable de entorno: VITE_CF_ANALYTICS_TOKEN. Ver README, "Publicación".
export const DEFAULT_CF_ANALYTICS_TOKEN = '';

// Las de abajo se resuelven en el build (build-tools/site.js); en Node (vite.config.js) valen el
// valor por defecto.
const env = import.meta.env ?? {};

/** URL pública sin barra final. */
export const SITE_URL = String(env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '');

/** Correo de contacto ('' si aún no se configuró). */
export const CONTACT_EMAIL = String(env.VITE_CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL).trim();

/** Enlace de comentarios ('' = oculto). */
export const FEEDBACK_URL = String(env.VITE_FEEDBACK_URL || DEFAULT_FEEDBACK_URL).trim();
