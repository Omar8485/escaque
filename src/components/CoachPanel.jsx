import React, { Suspense } from 'react';
import { Undo2, HelpCircle, Play, Lightbulb, Loader2, WifiOff, Settings2, Sparkles, ArrowLeftRight } from 'lucide-react';
import MiniBoard from './MiniBoard';
import MoveBadge from './MoveBadge';
import { CoachAvatar } from './CoachAvatars';
import { COACHES, getCoach } from '../../shared/coach-contract/index.js';
import { INTERRUPT_MODES } from '../coach/useCoach';
import { coachVoice, figurine, moodForTone, segmentText } from '../coach/templates';
import { AiSettings } from '../screens';
import ScreenLoading from './ScreenLoading';
import { aiStatusText, useAiSettings } from '../llm/settings.js';
import { formatUsageLine } from '../llm/usage.js';
import { useI18n } from '../i18n/useI18n';

const TONE_STYLES = {
  elogio: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40',
  neutral: 'border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-800/60',
  advertencia: 'border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/40',
  alerta: 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40',
};

// Estado de la IA opcional (la del usuario). En todos los casos el coach sigue con plantillas.
// Textos en `coach.conn.<estado>`.
const CONNECTION_KINDS = new Set(['offline', 'paused', 'auth', 'quota', 'model_not_found', 'bad_request']);
const connectionText = (kind, t) => (CONNECTION_KINDS.has(kind) ? t(`coach.conn.${kind}`) : null);

/** Texto con jugadas [[SAN]] en notación con figuras; al pasar el ratón se resalta. */
export const CoachText = ({ text, onMoveHover }) => (
  <>
    {segmentText(text ?? '').map((s, i) =>
      s.type === 'move' ? (
        <strong
          key={i}
          className="font-mono text-brand-700 dark:text-brand-300 whitespace-nowrap"
          onMouseEnter={() => onMoveHover?.(s.san)}
          onMouseLeave={() => onMoveHover?.(null)}
        >
          {figurine(s.san)}
        </strong>
      ) : (
        <React.Fragment key={i}>{s.value}</React.Fragment>
      ),
    )}
  </>
);

/** Indicador sutil del origen del texto: IA (validada con los hechos) o plantilla. */
const Source = ({ source, model }) => {
  const { t } = useI18n();
  return (
    <span
      data-testid="coach-source"
      data-source={source}
      title={source === 'ia' ? t('coach.source.aiTitle', { model: model ? ` (${model})` : '' }) : t('coach.source.templateTitle')}
      className="text-[10px] uppercase tracking-wider text-ink-400 inline-flex items-center gap-0.5"
    >
      {source === 'ia' ? <><Sparkles size={9} /> {t('coach.source.ai')}</> : t('coach.source.template')}
    </span>
  );
};

/**
 * Alterna entre el texto de la IA y el de la plantilla (las dos versiones se generan para la misma
 * jugada). La elección se recuerda para los siguientes mensajes.
 */
const SourceToggle = ({ alternate, loading, onToggle }) => {
  const { t } = useI18n();
  const label = loading ? t('coach.source.aiDrafting') : alternate === 'ia' ? t('coach.source.showAi') : t('coach.source.showTemplate');
  return alternate ? (
    <button
      type="button"
      data-testid="coach-source-toggle"
      data-alternate={alternate}
      aria-label={label}
      title={label}
      disabled={loading}
      onClick={() => onToggle(alternate)}
      className="p-0.5 rounded bg-transparent text-ink-400 hover:text-brand-700 dark:hover:text-brand-300 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <ArrowLeftRight size={11} />}
    </button>
  ) : null;
};

/** Origen del texto + control para alternar. */
const SourceBar = ({ source, model, alternate, loading, onToggle }) => (
  <span className="inline-flex items-center gap-1">
    {source && <Source source={source} model={model} />}
    <SourceToggle alternate={alternate} loading={loading} onToggle={onToggle} />
  </span>
);

/** Globo de diálogo con la cola apuntando a Alfred. */
const Bubble = ({ tone = 'neutral', children, ...rest }) => {
  const style = TONE_STYLES[tone] ?? TONE_STYLES.neutral;
  return (
    <div {...rest} className={`relative rounded-2xl rounded-tl-md border p-3 flex flex-col gap-2 ${style}`}>
      <span aria-hidden="true" className={`absolute -left-[7px] top-4 w-3 h-3 rotate-45 border border-t-0 border-r-0 ${style}`} />
      {children}
    </div>
  );
};

/** Expresión de Alfred según lo que está diciendo. */
function avatarMood(coach, isPlayerTurn) {
  const { view, hint } = coach;
  if (view.state === 'analyzing' || view.state === 'thinking') return 'pensando';
  if (hint && isPlayerTurn && (hint.loading || hint.thinking)) return 'pensando';
  if (coach.interrupting) return 'preocupado';
  if (hint?.text && isPlayerTurn) return 'pensativo';
  if (view.state === 'feedback') return view.greatMove ? 'feliz' : moodForTone(view.tone);
  if (view.state === 'error') return 'preocupado';
  return 'neutral';
}

/** Elección de coach: Alfred, Kairós o Ariadna (misma información, distinta voz). */
export const CoachPicker = ({ value, onChange, size = 40 }) => {
  const { t } = useI18n();
  return (
  <div>
    <span className="block text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-2">{t('coach.yourCoach')}</span>
    <div role="radiogroup" aria-label={t('coach.yourCoach')} className="grid grid-cols-3 gap-1.5">
      {Object.values(COACHES).map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.id === value}
          data-testid={`coach-option-${c.id}`}
          title={`${c.name}: ${t(`coach.tagline.${c.id}`)}`}
          onClick={() => onChange(c.id)}
          className={`p-1.5 rounded-xl flex flex-col items-center gap-0.5 transition-all ${c.id === value ? 'bg-brand-600 text-white shadow' : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-brand-50 dark:hover:bg-brand-950/60'}`}
        >
          <CoachAvatar coach={c.id} mood={c.id === value ? 'feliz' : 'neutral'} size={size} />
          <span className="text-xs font-bold">{c.name}</span>
        </button>
      ))}
    </div>
  </div>
  );
};

// Panel del coach en Entrenar (docs/COACH_DESIGN.md §1.2): Alfred con su comentario en un globo,
// botones Retroceder / ¿Por qué? / Seguir cuando interrumpe, pistas 1–3 y preferencias.
const CoachPanel = ({ coach, isPlayerTurn }) => {
  const { t, lang } = useI18n();
  const { view, hint, prefs } = coach;
  const [showPrefs, setShowPrefs] = React.useState(false);
  const ai = useAiSettings();
  const statusNote = ai.configured ? connectionText(coach.disabledKind, t) ?? connectionText(coach.connection, t) : null;
  const mood = avatarMood(coach, isPlayerTurn);
  const coachId = prefs.coach;
  const { name: coachName } = getCoach(coachId);
  const voice = coachVoice(coachId, lang);

  return (
    <div data-testid="coach-panel" data-state={view.state} className="bg-white dark:bg-ink-900 p-4 rounded-2xl shadow-sm border border-ink-200 dark:border-ink-700 flex flex-col gap-3">
      <div className="flex gap-3 items-start">
        <div className="flex flex-col items-center gap-1 w-[84px] flex-shrink-0">
          <CoachAvatar coach={coachId} mood={mood} size={84} />
          <p data-testid="coach-name" className="font-black text-ink-800 dark:text-ink-100 leading-tight">{coachName}</p>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 min-h-[28px]">
            <p className="text-[11px] text-ink-500 dark:text-ink-400 truncate flex items-center gap-1">
              {statusNote ? <><WifiOff size={11} /> {statusNote}</> : <span data-testid="coach-mode" data-ai={ai.configured} title={aiStatusText(ai, t)}>{ai.configured ? <><Sparkles size={10} className="inline" /> {aiStatusText(ai, t)}</> : aiStatusText(ai, t)}</span>}
            </p>
            <button
              type="button"
              aria-label={t('coach.prefsOf', { coach: coachName })}
              onClick={() => setShowPrefs((v) => !v)}
              className="p-1.5 bg-transparent rounded-lg text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-700"
            >
              <Settings2 size={16} />
            </button>
          </div>

          {view.state === 'off' && <Bubble><p className="text-sm text-ink-500 dark:text-ink-400">{t('coach.silent')}</p></Bubble>}
          {view.state === 'idle' && <Bubble><p className="text-sm text-ink-700 dark:text-ink-200">{voice.idle}</p></Bubble>}
          {view.state === 'analyzing' && (
            <Bubble>
              <p data-testid="coach-analyzing" className="text-sm text-ink-700 dark:text-ink-200 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> {voice.analyzing} <CoachText text={`[[${view.moveSan}]]`} />…
              </p>
            </Bubble>
          )}
          {view.state === 'error' && <Bubble tone="alerta"><p className="text-sm text-rose-700 dark:text-rose-300">{view.text}</p></Bubble>}

          {view.state === 'thinking' && (
            <Bubble data-testid="coach-thinking" data-label={view.label}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-ink-700 dark:text-ink-200">{figurine(view.moveSan ?? '')}</span>
                <MoveBadge label={view.label} greatMove={view.greatMove} />
              </div>
              <p className="text-sm text-ink-600 dark:text-ink-300 flex items-center gap-2" role="status">
                <Loader2 size={14} className="animate-spin" /> {t('coach.thinking', { coach: coachName })}
              </p>
            </Bubble>
          )}

          {view.state === 'feedback' && (
            <Bubble data-testid="coach-feedback" data-label={view.label} data-tone={view.tone} tone={view.tone}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-ink-700 dark:text-ink-200">{figurine(view.moveSan ?? '')}</span>
                <div className="flex items-center gap-2">
                  <SourceBar source={view.source} model={view.sourceModel} alternate={view.alternate} loading={view.alternateLoading} onToggle={coach.setPreferredSource} />
                  <MoveBadge label={view.label} greatMove={view.greatMove} />
                </div>
              </div>
              <p data-testid="coach-text" className="text-sm text-ink-800 dark:text-ink-100 leading-snug">
                <CoachText text={view.text} />
              </p>
              {view.question && <p className="text-xs italic text-ink-600 dark:text-ink-300">{view.question}</p>}
              {view.bestMoveSan && (
                <p data-testid="coach-best" className="text-xs text-ink-600 dark:text-ink-300">
                  {t('coach.bestWas')} <CoachText text={`[[${view.bestMoveSan}]]`} />.
                </p>
              )}
              {view.why && (
                <div data-testid="coach-why" data-state={view.why.state} className="text-sm text-ink-700 dark:text-ink-200 border-t border-black/5 dark:border-white/10 pt-2 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-ink-500 dark:text-ink-400">{t('coach.why')}</span>
                    {view.why.state === 'thinking' ? (
                      <Loader2 size={12} className="animate-spin text-ink-400" aria-label={t('coach.preparingWhy', { coach: coachName })} />
                    ) : (
                      <SourceBar source={view.why.source} model={view.why.model} alternate={view.why.alternate} loading={view.why.alternateLoading} onToggle={coach.setPreferredSource} />
                    )}
                  </div>
                  {view.why.state === 'thinking' ? (
                    <p className="text-xs text-ink-500 dark:text-ink-400" role="status">{t('coach.thinking', { coach: coachName })}</p>
                  ) : (
                    <p data-testid="coach-why-text" className="leading-snug"><CoachText text={view.why.text} /></p>
                  )}
                  {view.whyLine?.moves.length > 0 && <MiniBoard line={view.whyLine} orientation={view.playerColor} />}
                </div>
              )}
              {!coach.interrupting && view.canWhy && (
                <button data-testid="coach-why-btn" onClick={coach.why} className="self-start p-0 bg-transparent text-xs font-bold text-brand-700 dark:text-brand-300 hover:underline flex items-center gap-1">
                  <HelpCircle size={13} /> {t('coach.why')}
                </button>
              )}
            </Bubble>
          )}
        </div>
      </div>

      {(view.state === 'feedback' || view.state === 'thinking') && coach.interrupting && (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('coach.whatNow')}>
          <button data-testid="coach-takeback" onClick={coach.takeback} className="py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1">
            <Undo2 size={14} /> {t('coach.takeback')}
          </button>
          <button data-testid="coach-why-btn" onClick={coach.why} disabled={!view.canWhy || view.state === 'thinking'} className="py-2 bg-white dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-700 border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 rounded-lg font-bold text-xs flex items-center justify-center gap-1 disabled:opacity-50">
            <HelpCircle size={14} /> {t('coach.why')}
          </button>
          <button data-testid="coach-continue" onClick={coach.continueGame} className="py-2 bg-white dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-700 border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-200 rounded-lg font-bold text-xs flex items-center justify-center gap-1">
            <Play size={14} /> {t('coach.continue')}
          </button>
        </div>
      )}

      {showPrefs && (
        <div data-testid="coach-prefs" className="text-xs bg-ink-50 dark:bg-ink-800/60 rounded-xl p-3 flex flex-col gap-2">
          <CoachPicker value={coachId} onChange={(id) => coach.setPrefs({ coach: id })} />
          <label className="flex items-center gap-2 font-bold text-ink-600 dark:text-ink-300">
            <input type="checkbox" checked={prefs.active} onChange={(e) => coach.setPrefs({ active: e.target.checked })} />
            {t('coach.commentsOn', { coach: coachName })}
          </label>
          <label className="flex flex-col gap-1 text-ink-600 dark:text-ink-300">
            <span className="font-bold">{t('coach.stopOn')}</span>
            <select
              data-testid="interrupt-mode"
              value={prefs.mode}
              onChange={(e) => coach.setPrefs({ mode: e.target.value })}
              className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 rounded-lg px-2 py-1"
            >
              {Object.entries(INTERRUPT_MODES).map(([id, label]) => (
                <option key={id} value={id}>{t(label)}</option>
              ))}
            </select>
          </label>
          <Suspense fallback={<ScreenLoading compact />}>
            <AiSettings usage={coach.usage} usageLine={ai.configured || coach.usage?.summary.requests ? formatUsageLine(coach.usage.summary, t, lang) : null} />
          </Suspense>
        </div>
      )}

      {coach.active && (isPlayerTurn || hint) && (
        <div className="flex flex-col gap-2">
          {hint && (hint.text || hint.thinking) && (
            <div data-testid="coach-hint" data-level={hint.level} data-state={hint.thinking ? 'thinking' : 'ready'} className="text-sm bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-ink-800 dark:text-ink-100">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300">{t('coach.hintLevel', { level: hint.level })}</span>
                {hint.thinking ? <Loader2 size={12} className="animate-spin text-ink-400" /> : <SourceBar source={hint.source} model={hint.by} alternate={hint.alternate} loading={hint.alternateLoading} onToggle={coach.setPreferredSource} />}
              </div>
              {hint.thinking ? <span className="text-xs text-ink-500 dark:text-ink-400" role="status">{t('coach.thinking', { coach: coachName })}</span> : <CoachText text={hint.text} />}
            </div>
          )}
          {isPlayerTurn && (
            <button
              data-testid="coach-hint-btn"
              onClick={coach.requestHint}
              disabled={!coach.canHint}
              className="py-2 bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {hint?.loading || hint?.thinking ? <Loader2 size={16} className="animate-spin" /> : <Lightbulb size={16} />}
              {!hint ? t('coach.hint') : hint.level < 3 ? t('coach.anotherHint') : t('coach.noMoreHints')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default CoachPanel;
