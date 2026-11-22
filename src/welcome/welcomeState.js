// ¿Ya vio el usuario la bienvenida? Preferencia del navegador (como el tema o el idioma).

/** Clave en localStorage. */
export const WELCOME_KEY = 'escaque:welcomeSeen';

/** @returns {boolean} */
export function readWelcomeSeen() {
  try {
    return globalThis.localStorage?.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeen() {
  try {
    globalThis.localStorage?.setItem(WELCOME_KEY, '1');
  } catch {
    // Sin almacenamiento: se volverá a mostrar en la próxima visita.
  }
}
