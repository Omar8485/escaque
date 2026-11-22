// Eventos del embudo de Escaque (v2, diseño interno §4). Los comparten la app (src/analytics/track.js) y
// el Worker (worker/events.js), que solo acepta los de esta lista.
//
// Privacidad: el servidor guarda SOLO contadores agregados por día, evento e idioma. Sin
// identificadores, sin cookies y sin la IP (la IP solo se usa en memoria para limitar abusos).
// Añadir un evento = añadirlo aquí (y documentarlo en diseño interno §4). No añadas datos personales.

/** @typedef {typeof EVENTS[number]} EventName */
export const EVENTS = Object.freeze([
  // Llegada y retorno (los calcula markVisit(): una vez por navegador)
  'first_visit', // primera vez que se abre la app en este navegador
  'return_d1', // vuelve entre 1 y 6 días después de la primera visita
  'return_d7', // vuelve entre 7 y 13 días después de la primera visita
  // Informe instantáneo (V1)
  'report_start', // pidió el informe (escribió un usuario y pulsó Analizar)
  'report_done', // el informe se mostró
  'report_errors_done', // terminó el análisis con el motor de «tus errores repetidos»
  // Juego
  'game_start', // primera jugada de una partida de Entrenar
  'game_end', // partida de Entrenar terminada
  // Premium (V3, V5)
  'paywall_view', // se mostró un bloqueo Premium (PremiumLock)
  'premium_view', // se abrió la pantalla Premium
  'checkout_open', // se abrió el pago de Polar (con o sin prueba)
  // Difusión y retención (V2, V7, V8, V10)
  'share_card', // compartió o descargó una tarjeta
  'voice_on', // activó la voz del coach
  'remind_optin', // aceptó los recordatorios
  'install', // instaló la PWA
]);

const SET = new Set(EVENTS);
/** @param {unknown} e */
export const isEvent = (e) => typeof e === 'string' && SET.has(e);

/** Idiomas que se cuentan por separado (cualquier otro valor se guarda como 'xx'). */
export const EVENT_LANGS = Object.freeze(['es', 'en']);
