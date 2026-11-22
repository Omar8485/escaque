import React, { useEffect, useRef, useState } from 'react';
import { Check, CloudCog, Sparkles, X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { formatDate, formatDateTime, formatNumber } from '../i18n/core';
import { api } from './api';
import ProviderButtons from './ProviderButtons';
import { engineProfile, readEngineEnv } from '../engine/deviceProfile';
import { PcNote } from '../platform/PcNotice';
import { FREE_LIMITS, PREMIUM_BENEFITS } from '../premium/limits';
import { refreshAccount, useAccount } from '../premium/planStore';
import { confirmAndDeleteAccount } from './deleteAccount';
import { yearlyDeal } from './pricing';
import { readProductsCache, trialOf, trialText, writeProductsCache } from './productsCache';
import { track } from '../analytics/track.js';
import { useSyncStatus } from '../sync/engine';
import { syncNow } from '../sync/scheduler';

// v2: el anual primero (mejor valor), luego el mensual y el Fundador.
const PLAN_ORDER = ['yearly', 'monthly', 'founder'];
const FREE_FEATURES = ['play', 'ai', 'recent', 'progress', 'review'];

/** Importe en centavos con el formato de moneda del idioma. */
const money = (lang, cents, currency) => formatNumber(lang, cents / 100, { style: 'currency', currency: String(currency || 'usd').toUpperCase() });

/** Texto del precio tal como viene de Polar (importe en centavos). */
function priceText(price, lang, t) {
  if (!price) return null;
  if (price.amountType === 'free') return t('premium.priceFree');
  if (price.amountType === 'custom') return Number.isFinite(price.minimum) ? t('premium.priceFrom', { price: money(lang, price.minimum, price.currency) }) : t('premium.priceCustom');
  return Number.isFinite(price.amount) ? money(lang, price.amount, price.currency) : null;
}

const formatBytes = (lang, bytes) => (bytes >= 1024 * 1024
  ? `${formatNumber(lang, bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`
  : `${formatNumber(lang, Math.ceil(bytes / 1024))} KB`);

const section = 'rounded-2xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 p-4 space-y-3 min-w-0';
const h3 = 'font-black text-ink-900 dark:text-ink-100';
const ghost = 'max-lg:min-h-11 rounded-xl bg-ink-100 dark:bg-ink-800 px-3 py-2 text-sm font-bold text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700 disabled:opacity-50';

/** Pantalla Premium: beneficios, precios de Polar, compra, gestión y sincronización. */
export default function PremiumScreen({ onLogin, onClose, onNotice }) {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [phone] = useState(() => engineProfile(readEngineEnv()).phone);
  const sync = useSyncStatus();
  const closeRef = useRef(null);
  const [catalog, setCatalog] = useState(() => {
    const cached = readProductsCache();
    return cached ? { status: 'ok', products: cached.products, sandbox: cached.sandbox, founder: cached.founder ?? null } : { status: 'loading', products: [], sandbox: false, founder: null };
  });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  // Al volver con «Atrás» desde Polar, el navegador puede restaurar la página tal como se fue
  // (bfcache), con el botón en «Abriendo el pago…»: se desbloquea y se vuelve a consultar el plan.
  useEffect(() => {
    const onShow = (e) => {
      if (!e.persisted) return;
      setBusy(null);
      refreshAccount();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    track('premium_view', { once: 'session' });
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    api.products().then(
      (data) => {
        if (!alive) return;
        if (data.configured) writeProductsCache(data);
        setCatalog({ status: data.configured ? 'ok' : 'none', products: data.products ?? [], sandbox: Boolean(data.sandbox), founder: data.founder ?? null });
      },
      () => alive && setCatalog((c) => (c.status === 'ok' ? c : { status: 'error', products: [], sandbox: false, founder: null })),
    );
    return () => { alive = false; };
  }, []);

  const signedIn = account.status === 'signedIn' && account.user;
  const plan = account.plan;
  const products = PLAN_ORDER.map((p) => catalog.products.find((x) => x.plan === p)).filter(Boolean);
  // Equivalente mensual y ahorro del anual, calculados con los precios reales de Polar.
  const deal = yearlyDeal(products.find((p) => p.plan === 'monthly'), products.find((p) => p.plan === 'yearly'));
  const founderSlots = catalog.founder;

  const buy = async (planId) => {
    setError(null);
    setBusy(planId);
    try {
      const { url } = await api.checkout(planId, account.csrf);
      track('checkout_open');
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      const kind = e?.kind;
      setError(kind === 'already_premium' || kind === 'already_subscribed' ? 'premium.errors.already'
        : kind === 'csrf' || kind === 'unauthenticated' ? 'premium.errors.session'
          : kind === 'founder_sold_out' ? 'premium.errors.soldOut'
            : kind === 'consent_required' ? 'premium.errors.consent'
              : 'premium.errors.checkout');
      if (kind === 'csrf' || kind === 'unauthenticated' || kind === 'consent_required') refreshAccount();
      if (kind === 'founder_sold_out') setCatalog((c) => ({ ...c, founder: { ...(c.founder ?? {}), remaining: 0, soldOut: true } }));
    }
  };

  const manage = async () => {
    setError(null);
    setBusy('portal');
    try {
      const { url } = await api.portal();
      window.location.assign(url);
    } catch (e) {
      setBusy(null);
      setError(e?.kind === 'no_customer' ? 'premium.errors.noCustomer' : 'premium.errors.portal');
    }
  };

  const clearServer = async () => {
    if (!window.confirm(t('account.clearServerConfirm'))) return;
    setBusy('clear');
    try {
      await api.clearServerData(account.csrf);
      onNotice('account.cleared');
    } catch {
      setError('account.error');
    }
    setBusy(null);
  };

  const deleteAccount = async () => {
    setBusy('delete');
    const result = await confirmAndDeleteAccount({ t, account });
    if (result === 'deleted') {
      onNotice('account.deleted');
      onClose();
      return;
    }
    if (result === 'error') setError('account.error');
    setBusy(null);
  };

  // Prueba gratis en curso: cuándo termina y qué se cobrará después (precio real de Polar).
  const trialPrice = plan.trial ? priceText(catalog.products.find((x) => x.plan === plan.plan)?.prices?.[0], lang, t) : null;
  const periodLine = plan.premium && !plan.lifetime && Number.isFinite(plan.periodEnd)
    ? (plan.trial && !plan.cancelAtPeriodEnd
      ? t(trialPrice ? 'premium.trialUntil' : 'premium.trialUntilNoPrice', { date: formatDate(lang, plan.periodEnd), price: trialPrice })
      : t(plan.cancelAtPeriodEnd ? 'premium.ends' : 'premium.renews', { date: formatDate(lang, plan.periodEnd) }))
    : null;
  const offeredTrial = products.map(trialOf).find(Boolean) ?? null;

  return (
    <div className="fixed inset-0 z-[75] flex items-stretch lg:items-center justify-center bg-ink-900/50 dark:bg-black/60 lg:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="premium-title"
        data-testid="premium-screen"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-lg:h-[100dvh] lg:max-w-3xl max-h-[100dvh] lg:max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100 lg:rounded-3xl shadow-2xl p-4 lg:p-6 space-y-4 max-lg:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
      >
        <div className="flex items-start justify-between gap-3 max-lg:sticky max-lg:top-0 max-lg:z-10 max-lg:bg-ink-50 max-lg:dark:bg-ink-950">
          <div className="min-w-0">
            <h2 id="premium-title" className="flex items-center gap-2 text-xl sm:text-2xl font-black tracking-tight">
              <Sparkles size={22} className="text-amber-500 flex-shrink-0" aria-hidden="true" /> {t('premium.title')}
            </h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{t('premium.subtitle')}</p>
          </div>
          <button ref={closeRef} type="button" data-testid="premium-close" onClick={onClose} aria-label={t('premium.close')}
            className="max-lg:min-h-11 max-lg:min-w-11 flex-shrink-0 p-2 rounded-xl bg-white dark:bg-ink-800 border border-ink-200 dark:border-ink-700 text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-700">
            <X size={18} />
          </button>
        </div>

        {plan.premium && (
          <div data-testid="premium-current" data-plan={plan.plan} className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-4 space-y-2">
            <p className="font-bold text-amber-900 dark:text-amber-100">{t('premium.current', { plan: t(`account.plan.${plan.plan}`) })}</p>
            {plan.lifetime && <p className="text-sm text-amber-800 dark:text-amber-200">{t('premium.lifetime')}</p>}
            {periodLine && <p data-testid="premium-period" data-trial={plan.trial ? 'true' : undefined} className="text-sm text-amber-800 dark:text-amber-200">{periodLine}</p>}
            {plan.status === 'past_due' && <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{t('premium.pastDue')}</p>}
            {account.billing && (
              <button type="button" data-testid="premium-manage" onClick={manage} disabled={busy === 'portal'} className={ghost}>{t(plan.trial ? 'premium.manageTrial' : 'premium.manage')}</button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className={section} data-testid="premium-benefits">
            <h3 className={h3}>{t('premium.benefitsTitle')}</h3>
            <ul className="space-y-2 text-sm">
              {PREMIUM_BENEFITS.map((b) => (
                <li key={b} className="flex gap-2"><Check size={16} className="mt-0.5 flex-shrink-0 text-amber-500" aria-hidden="true" /><span className="min-w-0">{t(`premium.benefit.${b}`)}</span></li>
              ))}
            </ul>
          </section>
          <section className={section} data-testid="premium-free">
            <h3 className={h3}>{t('premium.freeTitle')}</h3>
            <ul className="space-y-2 text-sm text-ink-600 dark:text-ink-300">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2"><Check size={16} className="mt-0.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
                  <span className="min-w-0">{t(`premium.free.${f}`, { n: FREE_LIMITS.recentGames, days: 30 })}</span></li>
              ))}
            </ul>
            <p className="text-xs text-ink-500 dark:text-ink-400">{t('account.optional')}</p>
          </section>
        </div>

        {!plan.lifetime && (
          <section className={section} data-testid="premium-prices" data-status={catalog.status}>
            <h3 className={h3}>{t('premium.pricesTitle')}</h3>
            {catalog.sandbox && <p data-testid="premium-sandbox" className="text-xs font-bold text-amber-700 dark:text-amber-300">{t('premium.sandbox')}</p>}
            {catalog.status === 'loading' && <p className="text-sm text-ink-500">{t('premium.loadingPrices')}</p>}
            {(catalog.status === 'error' || catalog.status === 'none' || (catalog.status === 'ok' && !products.length)) && (
              <p data-testid="premium-no-prices" className="text-sm text-ink-500 dark:text-ink-400">{t('premium.noPrices')}</p>
            )}
            {phone && <PcNote testId="premium-pc-note" premium />}
            {products.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {products.map((p) => {
                  const price = priceText(p.prices?.[0], lang, t);
                  // «Ya lo tienes» solo en el plan que tienes (o en las suscripciones si eres Fundador);
                  // con otra suscripción activa, el botón queda deshabilitado con «Ya tienes Premium».
                  const owned = plan.premium && p.plan !== 'founder';
                  const ownedThis = owned && (plan.lifetime || plan.plan === p.plan);
                  const featured = p.plan === 'yearly' && Boolean(deal);
                  const soldOut = p.plan === 'founder' && Boolean(founderSlots?.soldOut);
                  const trial = trialText(trialOf(p), t);
                  const nextPrice = p.plan === 'founder' && founderSlots?.tier === 'early' ? priceText(p.nextPrice, lang, t) : null;
                  return (
                    <div key={p.plan} data-testid={`premium-product-${p.plan}`} data-featured={featured ? 'true' : undefined}
                      className={`relative rounded-xl p-3 flex flex-col gap-2 min-w-0 ${featured ? 'border-2 border-amber-500 bg-amber-50/60 dark:bg-amber-950/30' : 'border border-ink-200 dark:border-ink-700'}`}>
                      {featured && (
                        <span data-testid="premium-best-value" className="self-start rounded-full bg-amber-500 text-white text-[11px] font-black uppercase tracking-wide px-2 py-0.5">{t('premium.bestValue')}</span>
                      )}
                      <p className="font-bold text-sm">{t(`premium.planName.${p.plan}`)}</p>
                      {trial && <p data-testid={`premium-trial-${p.plan}`} className="self-start rounded-full bg-brand-100 dark:bg-brand-900/50 text-brand-800 dark:text-brand-200 text-xs font-bold px-2 py-0.5">{trial}</p>}
                      <p className="text-2xl font-black text-ink-900 dark:text-ink-50 break-words">{price ?? '—'}</p>
                      <p className="text-xs text-ink-500 dark:text-ink-400">{t(`premium.interval.${p.interval === 'year' ? 'year' : p.interval === 'month' ? 'month' : 'once'}`)}</p>
                      {p.plan === 'yearly' && deal && (
                        <p data-testid="premium-yearly-deal" className="text-xs font-bold text-amber-800 dark:text-amber-200">
                          {t('premium.perMonth', { price: money(lang, deal.perMonthCents, deal.currency) })} · {t('premium.save', { pct: formatNumber(lang, deal.savingsPct / 100, { style: 'percent' }) })}
                        </p>
                      )}
                      {p.plan === 'founder' && founderSlots && (
                        <p data-testid="premium-founder-slots" data-remaining={founderSlots.remaining} className={`text-xs font-bold ${soldOut ? 'text-rose-700 dark:text-rose-300' : 'text-ink-600 dark:text-ink-300'}`}>
                          {soldOut ? t('premium.soldOut') : t('premium.slotsLeft', { n: founderSlots.remaining, limit: founderSlots.limit })}
                        </p>
                      )}
                      {nextPrice && !soldOut && (
                        <p data-testid="premium-founder-next" className="text-xs text-ink-600 dark:text-ink-300">
                          {t('premium.founderNext', { early: founderSlots.early, n: founderSlots.earlyRemaining, price: nextPrice })}
                        </p>
                      )}
                      {signedIn && (
                        <button type="button" data-testid={`premium-buy-${p.plan}`} disabled={Boolean(busy) || owned || soldOut} onClick={() => buy(p.plan)}
                          className={`max-lg:min-h-11 mt-auto rounded-xl text-white text-sm font-bold px-3 py-2 disabled:opacity-50 ${featured ? 'bg-amber-600 hover:bg-amber-700' : 'bg-amber-500 hover:bg-amber-600'}`}>
                          {busy === p.plan ? t('premium.buying') : soldOut ? t('premium.soldOut') : ownedThis ? t('premium.owned') : owned ? t('premium.ownedOther') : trial ? t('premium.startTrial', { trial }) : t('premium.buy')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {offeredTrial && !plan.premium && (
              <p data-testid="premium-trial-terms" className="text-xs text-ink-600 dark:text-ink-300">{t('premium.trialTerms', { trial: trialText(offeredTrial, t) })}</p>
            )}
            {products.length > 0 && (
              <p data-testid="premium-refund-note" className="text-xs text-ink-600 dark:text-ink-300">
                {t('premium.refundNote')}{' '}
                <a href={`${t('menu.termsHref')}#${t('premium.refundAnchor')}`} target="_blank" rel="noopener" className="underline text-brand-700 dark:text-brand-300 hover:text-brand-600">{t('premium.refundLink')}</a>
                {' · '}
                <a href={t('menu.privacyHref')} target="_blank" rel="noopener" className="underline text-brand-700 dark:text-brand-300 hover:text-brand-600">{t('menu.privacy')}</a>
              </p>
            )}
            {!signedIn && products.length > 0 && (
              account.available && account.providers.length ? (
                <div className="space-y-2 max-w-sm">
                  <p className="text-sm font-bold">{t('premium.signInToBuy')}</p>
                  <ProviderButtons providers={account.providers} onLogin={onLogin} testPrefix="premium-login" />
                </div>
              ) : <p className="text-sm text-ink-500">{t('account.unavailable')}</p>
            )}
            <p className="text-xs text-ink-500 dark:text-ink-400">{t('premium.merchant')}</p>
          </section>
        )}

        {error && <p role="alert" data-testid="premium-error" className="text-sm font-bold text-rose-700 dark:text-rose-300">{t(error)}</p>}

        {signedIn && (
          <section className={section} data-testid="premium-sync" data-state={sync.state}>
            <h3 className={`${h3} flex items-center gap-2`}><CloudCog size={18} aria-hidden="true" /> {t('sync.title')}</h3>
            {plan.premium ? (
              <>
                <p className="text-sm"><span className="font-bold">{t(`sync.state.${sync.state}`)}</span>
                  {sync.lastSyncAt && <span className="text-ink-500 dark:text-ink-400"> · {t('sync.last', { time: formatDateTime(lang, sync.lastSyncAt) })}</span>}
                </p>
                {Number.isFinite(sync.pending) && sync.pending > 0 && <p className="text-xs text-ink-500 dark:text-ink-400">{t('sync.pending', { n: sync.pending })}</p>}
                {sync.tooLarge > 0 && <p className="text-xs text-ink-500 dark:text-ink-400">{t('sync.tooLarge', { n: sync.tooLarge })}</p>}
                {sync.usage && <p data-testid="sync-usage" className="text-xs text-ink-500 dark:text-ink-400">{t('sync.usage', { size: formatBytes(lang, sync.usage.bytes ?? 0), max: formatBytes(lang, sync.usage.limits?.maxUserBytes ?? 0) })}</p>}
                <p className="text-xs text-ink-500 dark:text-ink-400">{t('sync.what')}</p>
                <button type="button" data-testid="sync-now" onClick={() => syncNow()} disabled={sync.state === 'syncing'} className={ghost}>{t('sync.now')}</button>
              </>
            ) : <p className="text-sm text-ink-500 dark:text-ink-400">{t('sync.premiumOnly')}</p>}
          </section>
        )}

        {signedIn && (
          <section className={section} data-testid="premium-account">
            <h3 className={h3}>{t('account.manageTitle')}</h3>
            <p className="text-xs text-ink-500 dark:text-ink-400">{t('account.dataNote')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" data-testid="account-clear-server" onClick={clearServer} disabled={Boolean(busy)} className={ghost}>{t('account.clearServer')}</button>
              <button type="button" data-testid="account-delete" onClick={deleteAccount} disabled={Boolean(busy)}
                className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:opacity-50">{t('account.deleteAccount')}</button>
            </div>
          </section>
        )}

        {/* Términos y privacidad (incluyen la cuenta, los datos sincronizados y Polar). */}
        <p data-testid="premium-legal" className="text-xs text-ink-500 dark:text-ink-400">
          {t('premium.legalLinks')}{' '}
          <a href={t('menu.termsHref')} className="underline hover:text-brand-600">{t('menu.terms')}</a>
          {' · '}
          <a href={t('menu.privacyHref')} className="underline hover:text-brand-600">{t('menu.privacy')}</a>
        </p>
      </div>
    </div>
  );
}
