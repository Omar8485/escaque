import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { api, loginUrl } from './api';
import { readReturnParams } from './returnParams';
// Pantalla Premium diferida (src/screens.js): no pesa en la carga inicial; se precarga tras «Listo».
import { PremiumScreen } from '../screens';
import ProviderButtons from './ProviderButtons';
import { ConsentDialog } from './Consent';
import { confirmAndDeleteAccount } from './deleteAccount';
import { TERMS_VERSION } from '../../shared/legal.js';
import { closePremium, getAccountState, isPremium, markConsentAccepted, openPremium, refreshAccount, resetAccount, useAccount } from '../premium/planStore';
import { startSyncScheduler } from '../sync/scheduler';
import { useSyncStatus } from '../sync/engine';
import { notifyGamesChanged } from '../import/store';
import { bumpPuzzleLibrary } from '../puzzles/generator/useGeneratePuzzles';

const REFRESH_ON_FOCUS_MS = 5 * 60 * 1000;
const CHECKOUT_POLL = { tries: 15, everyMs: 2000 };
const GAME_STORES = new Set(['games', 'analysis', 'moves']);

/** Avisa a las pantallas de que llegaron datos de otro dispositivo. */
function onSyncedData(stores, prefKeys) {
  if ([...stores].some((s) => GAME_STORES.has(s))) notifyGamesChanged();
  if (stores.has('puzzles') || prefKeys.includes('escaque:puzzles')) bumpPuzzleLibrary();
  if (prefKeys.length) globalThis.dispatchEvent?.(new CustomEvent('escaque:prefs-synced', { detail: prefKeys }));
  // Otros datos de IndexedDB (p. ej. las recompensas en `meta`, que escucha src/rewards/runtime.js).
  if (stores.size) globalThis.dispatchEvent?.(new CustomEvent('escaque:data-synced', { detail: { stores: [...stores] } }));
}

/**
 * Cuenta opcional en el menú lateral: iniciar/cerrar sesión, plan y acceso a Premium.
 * Es el único punto de montaje de la cuenta: también arranca la sincronización (si es Premium),
 * atiende la vuelta del login y del pago, y pinta la pantalla Premium (en un portal).
 */
export default function AccountSection({ gameInProgress = false }) {
  const { t } = useI18n();
  const account = useAccount();
  const sync = useSyncStatus();
  // Vuelta del login o del pago (se lee una vez al cargar).
  const [ret] = useState(() => readReturnParams(window.location.search));
  const [notice, setNotice] = useState(ret.noticeKey);
  // «Ahora no» en el aviso de términos: se oculta hasta recargar (la sincronización sigue en pausa).
  const [consentLater, setConsentLater] = useState(false);
  const later = useCallback(() => setConsentLater(true), []);
  const [deleting, setDeleting] = useState(false);
  const lastRefresh = useRef(0);

  useEffect(() => {
    let alive = true;
    if (ret.cleanSearch != null) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${ret.cleanSearch}${window.location.hash}`);
    }
    if (ret.openPremium) openPremium();
    (async () => {
      lastRefresh.current = Date.now();
      await refreshAccount();
      // El webhook de Polar puede tardar unos segundos en llegar tras el pago.
      if (ret.awaitPremium && getAccountState().user) {
        for (let i = 0; i < CHECKOUT_POLL.tries && alive && !isPremium(); i++) {
          await new Promise((r) => setTimeout(r, CHECKOUT_POLL.everyMs));
          if (alive) await refreshAccount();
        }
        if (alive) setNotice(isPremium() ? 'account.result.active' : 'account.result.pending');
      }
    })();
    const onFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current > REFRESH_ON_FOCUS_MS) {
        lastRefresh.current = Date.now();
        refreshAccount();
      }
    };
    document.addEventListener('visibilitychange', onFocus);
    // Abierta sin red (p. ej. la PWA instalada): el plan sale de la caché y sin token CSRF no se
    // sincroniza. Al volver la red se consulta /api/me para reanudar la sincronización.
    const onOnline = () => {
      if (!getAccountState().offline) return;
      lastRefresh.current = Date.now();
      refreshAccount();
    };
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [ret]);

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);

  // Sincronización en segundo plano: solo con sesión Premium, token CSRF (servidor alcanzable) y los
  // términos vigentes aceptados (el servidor también lo exige).
  const userId = account.user?.id ?? null;
  const csrf = account.csrf;
  const canSync = account.status === 'signedIn' && account.plan.premium && Boolean(csrf) && Boolean(userId) && !account.consentRequired;
  useEffect(() => {
    if (!canSync) return undefined;
    const scheduler = startSyncScheduler({ getContext: () => ({ userId, csrf }), onData: onSyncedData });
    return () => scheduler.stop();
  }, [canSync, userId, csrf]);

  const login = (provider, consent) => {
    if (gameInProgress && !window.confirm(t('account.leaveGame'))) return;
    window.location.assign(loginUrl(provider, window.location.pathname || '/', consent));
  };

  const acceptConsent = async () => {
    try {
      await api.acceptConsent(TERMS_VERSION, account.csrf);
      markConsentAccepted();
      return true;
    } catch {
      return false;
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const result = await confirmAndDeleteAccount({ t, account });
    setDeleting(false);
    if (result === 'deleted') setNotice('account.deleted');
    else if (result === 'error') setNotice('account.error');
  };

  const logout = async () => {
    try {
      if (account.csrf) await api.logout(account.csrf);
    } catch {
      // aunque falle la red, se olvida la sesión en este navegador
    }
    resetAccount();
    setNotice('account.signedOut');
  };

  const signedIn = account.status === 'signedIn' && account.user;
  const showConsent = Boolean(signedIn && account.consentRequired && account.csrf && !consentLater);
  const providers = account.providers ?? [];
  const planKey = account.plan.premium ? account.plan.plan : 'free';

  return (
    <div data-testid="account-section" data-status={account.status} data-plan={planKey} className="mx-4 mt-5 pt-4 border-t border-ink-100 dark:border-ink-800 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-400 dark:text-ink-500">{t('account.section')}</p>
      {signedIn ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <UserRound size={18} className="flex-shrink-0 text-ink-400" aria-hidden="true" />
            <div className="min-w-0">
              <p data-testid="account-user" className="text-sm font-bold text-ink-800 dark:text-ink-100 truncate">{account.user.name || account.user.email || t('account.noName')}</p>
              {account.user.email && account.user.name && <p className="text-xs text-ink-500 dark:text-ink-400 truncate">{account.user.email}</p>}
            </div>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span data-testid="account-plan" className={`rounded-full px-2 py-0.5 font-bold ${account.plan.premium ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200' : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300'}`}>
              {t(`account.plan.${planKey}`)}
            </span>
            {account.plan.premium && <span data-testid="account-sync-state" data-state={sync.state} className="text-ink-500 dark:text-ink-400">{t(`sync.state.${sync.state}`)}</span>}
            {account.offline && <span className="text-ink-500 dark:text-ink-400">{t('account.offline')}</span>}
          </p>
          {account.consentRequired && (
            <p data-testid="account-consent-pending" className="text-xs text-amber-800 dark:text-amber-200">
              {t('account.consent.pending')}{' '}
              <button type="button" onClick={() => setConsentLater(false)} className="bg-transparent p-0 font-bold underline">{t('account.consent.review')}</button>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" data-testid="account-logout" onClick={logout} className="flex items-center gap-2 bg-transparent p-0 text-xs font-bold text-ink-500 dark:text-ink-400 hover:text-brand-600">
              <LogOut size={14} aria-hidden="true" /> {t('account.signOut')}
            </button>
            <button type="button" data-testid="account-delete-menu" onClick={deleteAccount} disabled={deleting || !account.csrf}
              className="flex items-center gap-2 bg-transparent p-0 text-xs font-bold text-rose-700 dark:text-rose-300 hover:text-rose-800 disabled:opacity-50">
              <Trash2 size={14} aria-hidden="true" /> {t('account.deleteAccount')}
            </button>
          </div>
        </div>
      ) : account.available && providers.length ? (
        <div className="space-y-2">
          <ProviderButtons providers={providers} onLogin={login} />
          <p className="text-xs leading-snug text-ink-500 dark:text-ink-400">{t('account.optional')}</p>
        </div>
      ) : null}
      <button
        type="button"
        data-testid="open-premium"
        onClick={openPremium}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold px-3 py-2"
      >
        <Sparkles size={16} aria-hidden="true" /> {account.plan.premium ? t('premium.manageShort') : t('premium.cta')}
      </button>

      {showConsent && createPortal(
        <ConsentDialog onAccept={acceptConsent} onSignOut={logout} onLater={later} />,
        document.body,
      )}
      {account.premiumOpen && createPortal(
        <Suspense fallback={<div data-testid="premium-loading" className="fixed inset-0 z-[70] bg-ink-900/50 dark:bg-black/60" />}>
          <PremiumScreen onLogin={login} onClose={closePremium} onNotice={setNotice} />
        </Suspense>,
        document.body,
      )}
      {notice && createPortal(
        <div role="status" aria-live="polite" data-testid="account-notice" data-key={notice}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 max-w-[calc(100vw-2rem)] bg-ink-900 dark:bg-ink-800 text-white text-sm font-bold px-4 py-3 rounded-2xl shadow-2xl">
          <span className="min-w-0 break-words">{t(notice)}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t('common.closeNotice')} className="bg-transparent border-0 p-1 text-ink-300 hover:text-white">
            <X size={14} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
