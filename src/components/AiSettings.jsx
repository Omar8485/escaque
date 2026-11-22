import React from 'react';
import { Sparkles, KeyRound, Eye, EyeOff, Loader2, CheckCircle2, AlertTriangle, Trash2, ExternalLink, ChevronDown } from 'lucide-react';
import { PROVIDERS, PROVIDER_IDS, configProblem, effectiveModel, testConnection } from '../llm/provider.js';
import { aiSettings, aiStatusText, readAiPanelOpen, useAiSettings, writeAiPanelOpen } from '../llm/settings.js';
import { PRICES_CHECKED } from '../llm/pricing.js';
import { formatInt, formatUsd } from '../llm/usage.js';
import { useI18n } from '../i18n/useI18n';

const INPUT =
  'w-full bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 rounded-lg px-2 py-1 text-ink-800 dark:text-ink-100';
const BTN =
  'px-2 py-1.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 disabled:opacity-50';

/**
 * "IA (opcional)": el usuario elige proveedor y modelo, pega SU clave y la prueba. La clave se
 * guarda solo en este navegador (o solo en memoria) y las llamadas van directo a su proveedor.
 * El panel es plegable: plegado muestra una línea de resumen (estado y consumo de la partida);
 * al "Guardar y activar" se pliega solo. El estado plegado/desplegado se recuerda.
 * @param {{store?: object, fetchImpl?: typeof fetch, usageLine?: React.ReactNode,
 *   usage?: {entries: object[], summary: object}}} props
 */
/** Nombre visible del proveedor (solo "Compatible con OpenAI…" cambia con el idioma). */
const providerLabel = (id, t) => (id === 'custom' ? t('ai.provider.custom') : PROVIDERS[id]?.label ?? id);
const providerNote = (id, t) => {
  const key = `ai.provider.note.${id}`;
  return t(key) === key ? null : t(key);
};

export default function AiSettings({ store = aiSettings, fetchImpl, usageLine = null, usage = null }) {
  const { t, lang } = useI18n();
  const snap = useAiSettings(store);
  const [open, setOpenState] = React.useState(() => readAiPanelOpen());
  const setOpen = (value) => {
    setOpenState(value);
    writeAiPanelOpen(value);
  };
  const [form, setForm] = React.useState(() => ({
    provider: snap.provider,
    model: snap.model,
    baseUrl: snap.baseUrl || PROVIDERS[snap.provider]?.defaultBaseUrl || '',
    apiKey: store.getApiKey(),
    remember: snap.remember,
  }));
  const [showKey, setShowKey] = React.useState(false);
  const [test, setTest] = React.useState({ status: 'idle' });
  const [saved, setSaved] = React.useState(false);
  const meta = PROVIDERS[form.provider];
  const problem = configProblem(form, t);
  const testAbort = React.useRef(null);
  React.useEffect(() => () => testAbort.current?.abort(), []);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setTest({ status: 'idle' });
    setSaved(false);
  };
  const changeProvider = (provider) =>
    set({ provider, model: '', baseUrl: provider === 'custom' ? form.baseUrl || PROVIDERS.custom.defaultBaseUrl : form.baseUrl });

  const runTest = async () => {
    testAbort.current?.abort();
    const controller = new AbortController();
    testAbort.current = controller;
    setTest({ status: 'testing' });
    const res = await testConnection(form, { fetchImpl, signal: controller.signal, t });
    if (controller.signal.aborted) return;
    setTest(res.ok ? { status: 'ok', message: t('ai.testOk', { model: res.model, ms: Math.round(res.latencyMs) }) } : { status: 'error', kind: res.kind, message: res.message });
  };

  const save = () => {
    store.save({ provider: form.provider, model: form.model, baseUrl: form.provider === 'custom' ? form.baseUrl : '', apiKey: form.apiKey, remember: form.remember });
    setSaved(true);
    setOpen(false); // guardado y activo: se pliega y queda la línea de resumen
  };

  const clear = () => {
    store.clearKey();
    setForm((f) => ({ ...f, apiKey: '' }));
    setTest({ status: 'idle' });
    setSaved(false);
  };

  return (
    <section data-testid="ai-settings" data-open={open} className="rounded-xl border border-ink-200 dark:border-ink-700 bg-white/60 dark:bg-ink-900/40">
      <button
        type="button"
        data-testid="ai-settings-toggle"
        aria-expanded={open}
        aria-controls="ai-settings-body"
        aria-label={open ? t('ai.collapse') : t('ai.expand')}
        onClick={() => setOpen(!open)}
        className="w-full bg-transparent text-left px-3 py-2 flex flex-col gap-0.5 rounded-xl hover:bg-ink-100/60 dark:hover:bg-ink-800/60"
      >
        <span className="flex items-center gap-2 font-bold text-ink-700 dark:text-ink-200 w-full min-w-0">
          <Sparkles size={14} className="text-brand-600 dark:text-brand-300 flex-shrink-0" />
          <span className="flex-shrink-0">{t('ai.title')}</span>
          <span data-testid="ai-status" data-configured={snap.configured} className="ml-auto font-normal text-[11px] text-ink-500 dark:text-ink-400 truncate">
            {aiStatusText(snap, t)}
          </span>
          <ChevronDown size={14} aria-hidden="true" className={`flex-shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
        {usageLine && <span data-testid="ai-usage" className="text-[11px] font-normal text-ink-500 dark:text-ink-400 pl-[22px]">{usageLine}</span>}
      </button>

      {open && (
      <div id="ai-settings-body" className="px-3 pb-3 flex flex-col gap-2 text-ink-600 dark:text-ink-300">
        <p className="leading-snug">{t('ai.intro')}</p>

        <label className="flex flex-col gap-1">
          <span className="font-bold">{t('ai.provider.label')}</span>
          <select data-testid="ai-provider" value={form.provider} onChange={(e) => changeProvider(e.target.value)} className={INPUT}>
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>{providerLabel(id, t)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-bold">{t('ai.model')}</span>
          <input
            data-testid="ai-model"
            list={`ai-models-${form.provider}`}
            value={form.model}
            placeholder={meta.defaultModel || t('ai.modelPlaceholder')}
            onChange={(e) => set({ model: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            className={`${INPUT} font-mono`}
          />
          <datalist id={`ai-models-${form.provider}`}>
            {meta.models.map((m) => <option key={m} value={m} />)}
          </datalist>
          {meta.defaultModel && <span className="text-[11px] text-ink-500">{t('ai.modelDefault', { model: meta.defaultModel })}</span>}
        </label>

        {form.provider === 'custom' && (
          <label className="flex flex-col gap-1">
            <span className="font-bold">{t('ai.baseUrl')}</span>
            <input data-testid="ai-base-url" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} spellCheck={false} autoComplete="off" className={`${INPUT} font-mono`} />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-bold flex items-center gap-1"><KeyRound size={12} /> {meta.needsKey ? t('ai.key') : t('ai.keyOptional')}</span>
          <div className="flex gap-1">
            <input
              data-testid="ai-key"
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              placeholder={meta.keyPlaceholder}
              onChange={(e) => set({ apiKey: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT} font-mono flex-1 min-w-0`}
            />
            <button type="button" aria-label={showKey ? t('ai.hideKey') : t('ai.showKey')} onClick={() => setShowKey((v) => !v)} className="px-2 bg-transparent rounded-lg border border-ink-200 dark:border-ink-700">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {meta.keyUrl && (
            <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-brand-700 dark:text-brand-300 hover:underline flex items-center gap-1">
              {t('ai.getKey', { provider: providerLabel(form.provider, t) })} <ExternalLink size={10} />
            </a>
          )}
        </label>

        <label className="flex items-center gap-2">
          <input data-testid="ai-remember" type="checkbox" checked={form.remember} onChange={(e) => set({ remember: e.target.checked })} />
          {t('ai.remember')}
        </label>
        {!form.remember && <span className="text-[11px] text-ink-500 -mt-1">{t('ai.memoryOnly')}</span>}

        {providerNote(form.provider, t) && <p className="text-[11px] text-ink-500 leading-snug">{providerNote(form.provider, t)}</p>}

        <div className="grid grid-cols-3 gap-1.5">
          <button data-testid="ai-test" type="button" onClick={runTest} disabled={Boolean(problem) || test.status === 'testing'} className={`${BTN} bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200`}>
            {test.status === 'testing' ? <Loader2 size={12} className="animate-spin" /> : null} {t('ai.test')}
          </button>
          <button data-testid="ai-save" type="button" onClick={save} disabled={Boolean(problem)} className={`${BTN} bg-brand-600 hover:bg-brand-700 text-white`}>
            {t('ai.save')}
          </button>
          <button data-testid="ai-clear" type="button" onClick={clear} disabled={!snap.hasKey && !form.apiKey && !snap.configured} className={`${BTN} bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 text-rose-700 dark:text-rose-300`}>
            <Trash2 size={12} /> {t('ai.clear')}
          </button>
        </div>
        {problem && <p className="text-[11px] text-ink-500">{problem}</p>}
        {saved && <p data-testid="ai-saved" className="text-[11px] text-emerald-700 dark:text-emerald-300">{t('ai.saved', { status: aiStatusText({ configured: true, provider: form.provider, effectiveModel: effectiveModel(form) }, t) })}</p>}

        {test.status === 'ok' && (
          <p data-testid="ai-test-result" data-ok="true" className="text-emerald-700 dark:text-emerald-300 flex items-start gap-1">
            <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" /> {test.message}
          </p>
        )}
        {test.status === 'error' && (
          <p data-testid="ai-test-result" data-ok="false" data-kind={test.kind} role="alert" className="text-rose-700 dark:text-rose-300 flex items-start gap-1">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {test.message}
          </p>
        )}

        {usage?.entries?.length > 0 && <UsageTable entries={usage.entries} t={t} lang={lang} />}

        <div className="text-[11px] leading-snug text-ink-500 dark:text-ink-400 border-t border-black/5 dark:border-white/10 pt-2 flex flex-col gap-1">
          <p><strong>{t('ai.privacy.keyStrong')}</strong> {t('ai.privacy.keyRest', { provider: providerLabel(form.provider, t) })}</p>
          <p>{t('ai.privacy.payBefore')} <strong>{t('ai.privacy.payStrong')}</strong> {t('ai.privacy.payAfter')}</p>
          <p>{t('ai.privacy.data')}</p>
          <p>{t('ai.privacy.tip')}</p>
        </div>
      </div>
      )}
    </section>
  );
}

// Tipo de solicitud → clave de texto (`ai.type.*`).
const TYPE_KEYS = {
  move_feedback: 'move',
  'move_feedback+why': 'moveWhy',
  great_move: 'great',
  why: 'why',
  hint: 'hint',
  game_summary: 'summary',
};

/** Detalle por solicitud de esta partida: tipo, tokens que reporta el proveedor y latencia. */
function UsageTable({ entries, t, lang }) {
  return (
    <details data-testid="ai-usage-detail" className="text-[11px]">
      <summary className="cursor-pointer font-bold">{t('ai.detail.title')}</summary>
      <table className="w-full mt-1 tabular-nums">
        <thead>
          <tr className="text-left text-ink-500">
            <th className="font-semibold">{t('ai.detail.type')}</th>
            <th className="font-semibold text-right">{t('ai.detail.input')}</th>
            <th className="font-semibold text-right">{t('ai.detail.output')}</th>
            <th className="font-semibold text-right">ms</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className={e.ok ? '' : 'text-rose-700 dark:text-rose-300'} title={e.ok ? e.model : t('ai.detail.failed', { kind: e.kind })}>
              <td>{TYPE_KEYS[e.type] ? t(`ai.type.${TYPE_KEYS[e.type]}`) : e.type}{e.ok ? '' : ` (${e.kind})`}</td>
              <td className="text-right">{formatInt(e.inputTokens, lang)}{e.cachedTokens ? ` ${t('ai.detail.cached', { n: formatInt(e.cachedTokens, lang) })}` : ''}</td>
              <td className="text-right">{formatInt(e.outputTokens + e.reasoningTokens, lang)}</td>
              <td className="text-right">{e.latencyMs ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-ink-500">{t('ai.detail.note', { date: PRICES_CHECKED, total: formatUsd(entries.reduce((a, e) => a + (e.costUsd ?? 0), 0), lang) })}</p>
    </details>
  );
}
