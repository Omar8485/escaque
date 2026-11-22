// Cliente de la API de cuentas del Worker (mismo origen). Sin dependencias.
// Las cookies de sesión son HttpOnly: el navegador las manda solo; el token CSRF lo da /api/me.

export class ApiError extends Error {
  constructor(status, kind, extra = {}) {
    super(`API ${status} ${kind}`);
    this.status = status;
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** Error de red o servidor de cuentas ausente (p. ej. `vite preview` sin Worker). */
export const isUnavailable = (e) => e instanceof ApiError && (e.kind === 'network' || e.kind === 'unavailable');

async function request(path, { method = 'GET', body, csrf, fetchImpl = globalThis.fetch, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network');
  }
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.includes('application/json')) throw new ApiError(res.status, 'unavailable');
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(res.status, 'unavailable');
  }
  if (!res.ok || data?.ok === false) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.kind ?? 'error', { retryAfter: err.retryAfter, usage: err.usage });
  }
  return data;
}

export const api = {
  me: (o) => request('/api/me', o),
  logout: (csrf) => request('/api/auth/logout', { method: 'POST', csrf }),
  deleteAccount: (csrf) => request('/api/me', { method: 'DELETE', csrf }),
  acceptConsent: (version, csrf) => request('/api/me/consent', { method: 'POST', body: { version }, csrf }),
  products: () => request('/api/billing/products'),
  checkout: (plan, csrf) => request('/api/billing/checkout', { method: 'POST', body: { plan }, csrf }),
  portal: () => request('/api/billing/portal'),
  push: (items, csrf) => request('/api/sync/push', { method: 'POST', body: { items }, csrf }),
  pull: (cursor, limit) => request(`/api/sync/pull?cursor=${cursor}${limit ? `&limit=${limit}` : ''}`),
  syncStatus: () => request('/api/sync/status'),
  clearServerData: (csrf) => request('/api/sync', { method: 'DELETE', csrf }),
};

/**
 * URL de inicio de sesión (navegación completa; vuelve a `returnPath`). `consent` = versión de los
 * términos que el usuario acaba de aceptar en la casilla (shared/legal.js); sin ella el Worker no
 * crea cuentas nuevas.
 */
export const loginUrl = (provider, returnPath = '/', consent = null) =>
  `/api/auth/login/${provider}?return=${encodeURIComponent(returnPath)}${consent ? `&consent=${encodeURIComponent(consent)}` : ''}`;
