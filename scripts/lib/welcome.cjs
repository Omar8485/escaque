// Las pruebas que no verifican estos avisos los dan por vistos antes de cargar.
// Uso: await skipWelcome(page) o await skipWelcome(context).
const skipWelcome = (target) => target.addInitScript(() => {
  localStorage.setItem('escaque:welcomeSeen', '1');
  localStorage.setItem('escaque:pcNoticeSeen', '1');
});

module.exports = { skipWelcome };
