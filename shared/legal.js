// Versión vigente de los Términos de uso y de la Política de privacidad, en UN solo sitio.
// La usan el Worker (registra qué versión aceptó cada usuario: users.terms_version y consent_at) y
// la app (casilla de consentimiento antes del primer inicio de sesión y aviso a quien aceptó una
// versión anterior). Las páginas public/privacidad|privacy|terminos|terms.html muestran la misma
// versión y fecha (lo comprueba build-tools/site.test.js).
//
// Al cambiar los textos legales de forma sustancial: sube TERMS_VERSION y TERMS_EFFECTIVE_DATE aquí
// y en las cuatro páginas. Todos los usuarios con cuenta tendrán que volver a aceptar al entrar.

/** Versión de los términos y la privacidad que se acepta al crear la cuenta. */
export const TERMS_VERSION = '1.0';

/** Fecha desde la que rige esa versión (AAAA-MM-DD). */
export const TERMS_EFFECTIVE_DATE = '2026-11-07';

/** Edad mínima para crear una cuenta (decisión del dueño; la LOPDP permite consentir desde los 15). */
export const MIN_ACCOUNT_AGE = 16;
