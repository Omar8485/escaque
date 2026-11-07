// La bienvenida (primera visita) tapa la app: las pruebas que no la prueban la dan por vista.
// Uso: await skipWelcome(page) o await skipWelcome(context), justo después de crearlos.
const skipWelcome = (target) => target.addInitScript(() => localStorage.setItem('escaque:welcomeSeen', '1'));

module.exports = { skipWelcome };
