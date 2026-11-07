// Configuración de la IA opcional (proveedor, modelo, URL base y clave del usuario).
//
// - La clave se guarda SOLO en este navegador: en localStorage si el usuario marca "Recordar en
//   este equipo"; si no, solo en memoria (se pierde al recargar). Nunca va al servidor de Escaque.
// - Proveedor, modelo y URL base (no secretos) se recuerdan siempre.
// - Todo acceso a localStorage va con try/catch (modo privado, almacenamiento bloqueado…).
import { useSyncExternalStore } from 'react';
import { PROVIDERS, configProblem, effectiveModel } from './provider.js';
import { getT } from '../i18n/core.js';

export const AI_STORAGE_KEY = 'escaque:ia';

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{provider: string, model: string, baseUrl: string, apiKey: string, remember: boolean, enabled: boolean}} AiSettings
 * @typedef {{provider: string, model: string, baseUrl: string, remember: boolean, hasKey: boolean,
 *   configured: boolean, label: string, effectiveModel: string}} AiSnapshot
 */

const EMPTY = Object.freeze({ provider: 'gemini', model: '', baseUrl: '', apiKey: '', remember: true, enabled: false });

export class AiSettingsStore {
  /** @param {{storage?: Storage|null}} [opts] */
  constructor({ storage = safeLocalStorage() } = {}) {
    this._storage = storage;
    this._listeners = new Set();
    /** @type {AiSettings} */
    this._s = this._load();
    this._snap = this._makeSnapshot();
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
  }

  _load() {
    try {
      const raw = this._storage?.getItem(AI_STORAGE_KEY);
      if (!raw) return { ...EMPTY };
      const p = JSON.parse(raw);
      return {
        provider: PROVIDERS[p.provider] ? p.provider : EMPTY.provider,
        model: typeof p.model === 'string' ? p.model : '',
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
        apiKey: p.remember !== false && typeof p.apiKey === 'string' ? p.apiKey : '',
        remember: p.remember !== false,
        enabled: p.enabled === true,
      };
    } catch {
      return { ...EMPTY };
    }
  }

  _persist() {
    const { provider, model, baseUrl, apiKey, remember, enabled } = this._s;
    const stored = { provider, model, baseUrl, remember, enabled, ...(remember && apiKey ? { apiKey } : {}) };
    try {
      this._storage?.setItem(AI_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Sin almacenamiento: la configuración dura lo que la pestaña.
    }
  }

  _makeSnapshot() {
    const s = this._s;
    const meta = PROVIDERS[s.provider];
    // Activa = configuración completa (con clave si el proveedor la exige) y guardada por el usuario.
    const configured = Boolean(meta) && Boolean(s.enabled) && configProblem(s) === null;
    return Object.freeze({
      provider: s.provider,
      model: s.model,
      baseUrl: s.baseUrl,
      remember: s.remember,
      hasKey: Boolean(s.apiKey),
      configured,
      label: meta?.label ?? s.provider,
      effectiveModel: effectiveModel(s),
    });
  }

  _emit() {
    this._snap = this._makeSnapshot();
    this._listeners.forEach((l) => l());
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Vista sin la clave (para la UI). @returns {AiSnapshot} */
  getSnapshot() {
    return this._snap;
  }

  /** Configuración para llamar al proveedor, o null si la IA no está activa. */
  getConfig() {
    if (!this._snap.configured) return null;
    const { provider, baseUrl, apiKey } = this._s;
    return { provider, model: effectiveModel(this._s), baseUrl, apiKey };
  }

  /** Clave actual (solo para precargar el formulario de configuración). */
  getApiKey() {
    return this._s.apiKey;
  }

  /**
   * Guarda la configuración y activa la IA.
   * @param {Partial<AiSettings>} patch
   */
  save(patch) {
    const next = { ...this._s, ...patch };
    next.apiKey = String(next.apiKey ?? '').trim();
    next.model = String(next.model ?? '').trim();
    next.baseUrl = String(next.baseUrl ?? '').trim();
    next.remember = next.remember !== false;
    next.enabled = true;
    this._s = next;
    this._persist();
    this._emit();
  }

  /** Borra la clave (de memoria y del navegador) y desactiva la IA: vuelven las plantillas. */
  clearKey() {
    this._s = { ...this._s, apiKey: '', enabled: false };
    this._persist();
    this._emit();
  }
}

/** Estado corto de la IA: "Plantillas (sin IA)" o "IA activa · proveedor · modelo". */
export function aiStatusText(snap, t = getT('es')) {
  if (!snap?.configured) return t('ai.status.templates');
  const meta = PROVIDERS[snap.provider];
  return t('ai.status.active', { provider: meta?.shortLabel ?? meta?.label ?? snap.provider, model: snap.effectiveModel });
}

/** Estado plegado/desplegado del panel "IA (opcional)" (se recuerda en el navegador). */
export const AI_PANEL_KEY = 'escaque:ia-panel';

/** ¿El panel de IA estaba desplegado? Por defecto, plegado. */
export function readAiPanelOpen(storage = safeLocalStorage()) {
  try {
    return storage?.getItem(AI_PANEL_KEY) === 'open';
  } catch {
    return false;
  }
}

export function writeAiPanelOpen(open, storage = safeLocalStorage()) {
  try {
    storage?.setItem(AI_PANEL_KEY, open ? 'open' : 'closed');
  } catch {
    // Sin almacenamiento: dura la sesión.
  }
}

/** Configuración compartida por toda la app. */
export const aiSettings = new AiSettingsStore();

/** Hook: vista reactiva (sin la clave) de la configuración de IA. */
export function useAiSettings(store = aiSettings) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
