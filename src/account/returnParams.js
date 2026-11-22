// Parámetros con los que el Worker y Polar devuelven al usuario a la app:
//   ?account=ok | ?account=error:<motivo>    (callback de inicio de sesión; error:consent_required =
//                                            cuenta nueva sin la casilla de consentimiento)
//   ?checkout=success&checkout_id=…          (pago terminado en Polar)
//   ?premium=open[&portal=mock]              (vuelta desde el checkout o el portal)
//   &customer_session_token=polar_cst_…      (Polar lo añade al volver del pago: da acceso a su portal
//                                            de cliente, así que no debe quedar en la barra ni en el historial)
// Se leen una vez al cargar y se quitan de la barra de direcciones.

export const RETURN_PARAMS = Object.freeze(['account', 'checkout', 'checkout_id', 'premium', 'portal', 'customer_session_token']);

/**
 * @param {string} search  location.search
 * @returns {{noticeKey: string|null, openPremium: boolean, awaitPremium: boolean, cleanSearch: string|null}}
 */
export function readReturnParams(search) {
  const params = new URLSearchParams(search);
  let noticeKey = null;
  let openPremium = false;
  let awaitPremium = false;
  const account = params.get('account');
  if (account === 'ok') noticeKey = 'account.result.ok';
  else if (account === 'error:cancelled') noticeKey = 'account.result.cancelled';
  else if (account === 'error:consent_required') noticeKey = 'account.result.consentRequired';
  else if (account?.startsWith('error')) noticeKey = 'account.result.error';
  if (params.get('checkout') === 'success') {
    noticeKey = 'account.result.checkout';
    openPremium = true;
    awaitPremium = true;
  }
  if (params.get('premium') === 'open') openPremium = true;
  const touched = RETURN_PARAMS.some((p) => params.has(p));
  if (!touched) return { noticeKey, openPremium, awaitPremium, cleanSearch: null };
  for (const p of RETURN_PARAMS) params.delete(p);
  const rest = params.toString();
  return { noticeKey, openPremium, awaitPremium, cleanSearch: rest ? `?${rest}` : '' };
}
