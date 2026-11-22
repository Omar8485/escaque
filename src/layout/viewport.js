// Contrato de la ronda M (diseño móvil interno §3): qué es "móvil", "teléfono" y "horizontal".
// Lógica pura: el hook useViewport.js la alimenta con el tamaño de la ventana.

/** Desde este ancho (px CSS) es escritorio: el diseño de escritorio no cambia (`lg` de Tailwind). */
export const DESKTOP_MIN_WIDTH = 1024;
/** Por debajo de este ancho es un teléfono (`sm` de Tailwind). */
export const PHONE_MAX_WIDTH = 640;
/** Media query equivalente a `mobile` (para CSS o matchMedia). */
export const MOBILE_QUERY = `(max-width: ${DESKTOP_MIN_WIDTH - 0.02}px)`;

/**
 * @typedef {object} ViewportInfo
 * @property {boolean} mobile     ancho < 1024: diseño móvil (barra inferior, tarjeta de preparación…)
 * @property {boolean} phone      ancho < 640
 * @property {boolean} landscape  más ancho que alto (un teléfono girado: 740×360)
 * @property {number} width       ancho de la ventana en px CSS
 * @property {number} height      alto de la ventana en px CSS
 */

/**
 * Clasifica un tamaño de ventana.
 * @param {{width: number, height: number}} size
 * @returns {ViewportInfo}
 */
export function viewportInfo({ width, height }) {
  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : DESKTOP_MIN_WIDTH;
  const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 768;
  return {
    mobile: w < DESKTOP_MIN_WIDTH,
    phone: w < PHONE_MAX_WIDTH,
    landscape: w > h,
    width: w,
    height: h,
  };
}

/** true si dos ViewportInfo son iguales (para no re-renderizar con el mismo tamaño). */
export function sameViewport(a, b) {
  return (
    a === b ||
    (!!a && !!b && a.width === b.width && a.height === b.height && a.mobile === b.mobile && a.phone === b.phone && a.landscape === b.landscape)
  );
}
