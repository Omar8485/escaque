// Borrar la cuenta (DELETE /api/me): lo usan el menú (AccountSection) y la pantalla Premium.
// El servidor borra en cascada usuario, sesiones, plan y datos sincronizados; los datos del navegador
// se quedan. La confirmación lo dice claro y avisa de lo que NO hace (cancelar una suscripción en
// Polar) y de lo que se pierde (el plan Fundador es intransferible).
import { api } from './api.js';
import { resetAccount } from '../premium/planStore.js';

/** Texto de la confirmación según el plan. */
export function deleteConfirmText(t, plan = {}) {
  const parts = [t('account.deleteConfirm')];
  const renewing = plan.premium && !plan.lifetime && !plan.cancelAtPeriodEnd;
  if (renewing) parts.push(t('account.deleteConfirmSubscription'));
  if (plan.lifetime) parts.push(t('account.deleteConfirmFounder'));
  return parts.join('\n\n');
}

/**
 * Pide confirmación y borra la cuenta.
 * @returns {Promise<'deleted'|'cancelled'|'error'>}
 */
export async function confirmAndDeleteAccount({ t, account, confirm = (msg) => globalThis.confirm(msg) }) {
  if (!confirm(deleteConfirmText(t, account.plan))) return 'cancelled';
  try {
    await api.deleteAccount(account.csrf);
    resetAccount();
    return 'deleted';
  } catch {
    return 'error';
  }
}
