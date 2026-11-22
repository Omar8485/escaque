import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import BottomSheet from '../layout/BottomSheet';
import { useI18n } from '../i18n/useI18n';
import { formatNumber } from '../i18n/core';
import { PHONE_ENGINE_MAX_MB } from './deviceProfile';

// Diagnóstico del motor (solo teléfonos): motivo real de un «Error de worker», cuánto tarda el
// análisis en este dispositivo y «Reintentar». En el teléfono no hay consola para verlo.

/**
 * @param {{open: boolean, onClose: () => void, analyst: import('./engine.js').StockfishEngine, rival: import('./rival.js').RivalEngine}} p
 */
export default function EngineDiagnostics({ open, onClose, analyst, rival }) {
  const { t, lang } = useI18n();
  const [, tick] = useState(0);
  // Datos vivos mientras está abierto (estado, último análisis).
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);
  if (!open) return null;

  const a = analyst.getDiagnostics();
  const r = rival.getDiagnostics();
  const nav = globalThis.navigator ?? {};
  const n = (v, opts) => formatNumber(lang, v, opts);
  const status = (s, kind) => t(`status.${kind}.${s}`);
  const row = (label, value, testId) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-ink-100 dark:border-ink-800 text-sm">
      <span className="text-ink-500 dark:text-ink-400">{label}</span>
      <span data-testid={testId} className="font-bold text-right text-ink-800 dark:text-ink-100 break-words min-w-0">{value}</span>
    </div>
  );
  const anyError = a.status === 'error' || r.status === 'error';

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('diag.title')}
      testId="engine-diag"
      footer={
        <button
          type="button"
          data-testid="engine-diag-retry"
          onClick={() => {
            if (a.status === 'error' || !anyError) analyst.restart();
            if (r.status === 'error') rival.restart();
          }}
          className="min-h-11 w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold flex items-center justify-center gap-2 px-3"
        >
          <RotateCcw size={16} /> {t('diag.retry')}
        </button>
      }
    >
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-2">{t('diag.intro', { mb: n(PHONE_ENGINE_MAX_MB) })}</p>
      {row(t('diag.analyst'), status(a.status, 'engine'), 'engine-diag-analyst')}
      {row(t('diag.rival'), status(r.status, 'rival'), 'engine-diag-rival')}
      {row(
        t('diag.lastSearch'),
        a.lastSearch ? t('diag.searchValue', { depth: a.lastSearch.depth, lines: a.lastSearch.multipv, s: n(a.lastSearch.ms / 1000, { maximumFractionDigits: 1 }) }) : '—',
        'engine-diag-last',
      )}
      {row(t('diag.threads'), `${a.threads} · Hash ${a.hash} MB`)}
      {row(t('diag.device'), t('diag.deviceValue', { cores: nav.hardwareConcurrency ?? '?', gb: nav.deviceMemory ?? '?' }))}
      {row(t('diag.isolated'), globalThis.crossOriginIsolated ? t('common.yes') : t('common.no'))}
      {row(t('diag.retries'), `${a.retriesUsed} · ${r.retriesUsed}`)}
      {(a.failedOnce || r.failedOnce) && (
        <p data-testid="engine-diag-error" className="mt-2 text-xs font-mono break-words text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg p-2">
          {a.failedOnce ? a.lastError ?? t('diag.noDetail') : r.lastError ?? t('diag.noDetail')}
        </p>
      )}
    </BottomSheet>
  );
}
