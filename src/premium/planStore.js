// Estado de la cuenta y del plan, compartido por toda la app sin proveedor de React
// (useSyncExternalStore). Lo actualiza la sección de cuenta del menú; lo leen las pantallas con
// límites (Progreso, Mis partidas, Puzles, tablero) y módulos sin React (generador de puzles).
// El plan se guarda en localStorage para funcionar sin red (con caducidad: ver gate.js).
import { useSyncExternalStore } from 'react';
import { api, isUnavailable } from '../account/api.js';
import { cachedPremiumValid } from './gate.js';

export const ACCOUNT_CACHE_KEY = 'escaque:account';
const FREE_PLAN = Object.freeze({ premium: false, plan: 'free', status: null, lifetime: false, periodEnd: null, cancelAtPeriodEnd: false });

/**
 * @typedef {{
 *   status: 'loading'|'anonymous'|'signedIn',
 *   available: boolean|null,   // ¿hay servidor de cuentas? null = aún no se sabe
 *   offline: boolean,
 *   user: null|{id:string, email:string|null, name:string|null, provider:string},
 *   plan: typeof FREE_PLAN,
 *   csrf: string|null,
 *   providers: string[],
 *   billing: boolean,
 *   checkedAt: number|null,
 *   premiumOpen: boolean,
 *   consentRequired: boolean, // falta aceptar la versión vigente de términos y privacidad
 * }} AccountState
 */

function readCache() {
  try {
    const c = JSON.parse(globalThis.localStorage?.getItem(ACCOUNT_CACHE_KEY) ?? 'null');
    return c && typeof c === 'object' ? c : null;
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    if (value) globalThis.localStorage?.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(ACCOUNT_CACHE_KEY);
  } catch {
    // sin almacenamiento: el plan se vuelve a pedir al cargar
  }
}

function initialState(now = Date.now()) {
  const cache = readCache();
  const base = { status: 'loading', available: null, offline: false, user: null, plan: FREE_PLAN, csrf: null, providers: [], billing: false, checkedAt: null, premiumOpen: false, consentRequired: false };
  if (!cache?.user) return base;
  return { ...base, user: cache.user, checkedAt: cache.checkedAt ?? null, plan: cachedPremiumValid(cache, now) ? { ...FREE_PLAN, ...cache.plan } : { ...FREE_PLAN } };
}

/** @type {AccountState} */
let state = initialState();
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export const getAccountState = () => state;
export function subscribeAccount(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** ¿Premium ahora? (también fuera de React). */
export const isPremium = () => Boolean(state.plan?.premium);

/** Consulta /api/me. Sin servidor de cuentas o sin red, se queda con lo guardado. */
export async function refreshAccount({ fetchImpl } = {}) {
  try {
    const me = await api.me({ fetchImpl });
    const plan = me.plan ? { ...FREE_PLAN, ...me.plan } : FREE_PLAN;
    const patch = {
      available: Boolean(me.accounts),
      offline: false,
      providers: me.providers ?? [],
      billing: Boolean(me.billing),
      user: me.user ?? null,
      plan,
      csrf: me.csrf ?? null,
      checkedAt: me.user ? me.checkedAt ?? Date.now() : null,
      status: me.user ? 'signedIn' : 'anonymous',
      consentRequired: Boolean(me.user && me.consent?.required),
    };
    writeCache(me.user ? { user: me.user, plan, checkedAt: patch.checkedAt } : null);
    set(patch);
  } catch (e) {
    const unavailable = isUnavailable(e) && e.kind === 'unavailable';
    const cache = readCache();
    set({
      available: unavailable ? false : state.available,
      offline: !unavailable,
      status: cache?.user ? 'signedIn' : 'anonymous',
      user: cache?.user ?? null,
      plan: cachedPremiumValid(cache) ? { ...FREE_PLAN, ...cache.plan } : FREE_PLAN,
      csrf: null,
    });
  }
  return state;
}

/** Tras cerrar sesión o borrar la cuenta: vuelve al plan gratuito (los datos locales se quedan). */
export function resetAccount() {
  writeCache(null);
  set({ status: 'anonymous', user: null, plan: FREE_PLAN, csrf: null, checkedAt: null, consentRequired: false });
}

/** Tras aceptar los términos vigentes (POST /api/me/consent). */
export const markConsentAccepted = () => set({ consentRequired: false });

export const openPremium = () => set({ premiumOpen: true });
export const closePremium = () => set({ premiumOpen: false });

/** Solo para tests. */
export function _resetAccountStore() {
  state = initialState();
  listeners.forEach((fn) => fn());
}

/** @returns {AccountState} */
export const useAccount = () => useSyncExternalStore(subscribeAccount, getAccountState, getAccountState);
/** Solo el booleano Premium (re-renderiza solo cuando cambia). */
export const usePremium = () => useSyncExternalStore(subscribeAccount, isPremium, isPremium);
