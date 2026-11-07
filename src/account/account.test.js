import { describe, expect, it, vi } from 'vitest';
import { loginUrl } from './api.js';
import { readReturnParams } from './returnParams.js';
import { confirmAndDeleteAccount, deleteConfirmText } from './deleteAccount.js';
import { getT } from '../i18n/core.js';
import { TERMS_VERSION } from '../../shared/legal.js';

describe('consentimiento en el inicio de sesión', () => {
  it('loginUrl añade la versión aceptada solo si se pasa', () => {
    expect(loginUrl('google', '/x')).toBe('/api/auth/login/google?return=%2Fx');
    expect(loginUrl('google', '/x', TERMS_VERSION)).toBe(`/api/auth/login/google?return=%2Fx&consent=${TERMS_VERSION}`);
  });
  it('la vuelta con error:consent_required muestra su propio aviso', () => {
    expect(readReturnParams('?account=error:consent_required').noticeKey).toBe('account.result.consentRequired');
    expect(readReturnParams('?account=error:token').noticeKey).toBe('account.result.error');
    expect(readReturnParams('?account=error:cancelled').noticeKey).toBe('account.result.cancelled');
  });
});

describe('borrar la cuenta', () => {
  const t = getT('es');
  it('la confirmación dice que borra el servidor y no el navegador; avisa de suscripción y Fundador', () => {
    const free = deleteConfirmText(t, { premium: false });
    expect(free).toMatch(/datos sincronizados/);
    expect(free).toMatch(/NO se borran/);
    expect(free).not.toMatch(/suscripción/);
    expect(deleteConfirmText(t, { premium: true, lifetime: false, cancelAtPeriodEnd: false })).toMatch(/NO la cancela/);
    expect(deleteConfirmText(t, { premium: true, lifetime: false, cancelAtPeriodEnd: true })).not.toMatch(/NO la cancela/);
    expect(deleteConfirmText(t, { premium: true, lifetime: true })).toMatch(/Fundador/);
    expect(deleteConfirmText(getT('en'), { premium: false })).toMatch(/is NOT deleted/);
  });
  it('si no se confirma no llama al servidor', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const out = await confirmAndDeleteAccount({ t, account: { plan: {}, csrf: 'x' }, confirm: () => false });
    expect(out).toBe('cancelled');
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('confirmado: DELETE /api/me con el token CSRF', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, deleted: true }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const out = await confirmAndDeleteAccount({ t, account: { plan: {}, csrf: 'tok' }, confirm: () => true });
    expect(out).toBe('deleted');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/me');
    expect(init.method).toBe('DELETE');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    vi.unstubAllGlobals();
  });
});
