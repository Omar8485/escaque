import React from 'react';
import { Play } from 'lucide-react';
import { RIVAL_LEVELS, getRivalLevel } from '../engine/rivalLevels';
import { RivalAvatar } from './Avatars';
import { CoachPicker } from './CoachPanel';
import { useI18n } from '../i18n/useI18n';
import { rivalEloText, rivalEpithet } from '../rivals/labels';

const COLOR_OPTIONS = [
  { id: 'w', labelKey: 'common.white' },
  { id: 'b', labelKey: 'common.black' },
  { id: 'random', labelKey: 'setup.random' },
];

/** Ritmos de juego (segundos por jugador). */
const TIME_CONTROLS = [60, 180, 300, 600];

const segmented = (active) =>
  `py-1.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50 ${
    active ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-100 shadow' : 'bg-transparent text-ink-500 dark:text-ink-400 hover:text-brand-600'
  }`;

// Antes de empezar: rival (10 personajes, docs/COACH_DESIGN.md §3.2), color y ritmo.
// El nivel solo se cambia entre partidas.
// `rivalVoiceOn`/`onRivalVoiceChange`: preferencia "El rival habla" (src/rivals/useRivalVoice.js).
const LevelSelector = ({ level, onLevelChange, colorChoice, onColorChange, timeControl, onTimeControlChange, coachId, onCoachChange, onStart, disabled = false, rivalStatus, rivalVoiceOn, onRivalVoiceChange }) => {
  const { t } = useI18n();
  const def = getRivalLevel(level);

  return (
    <div data-testid="level-selector" className="bg-white dark:bg-ink-900 p-4 rounded-2xl shadow-sm border border-ink-200 dark:border-ink-700 flex flex-col gap-3">
      <div>
        <span className="block text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-2">{t('setup.yourRival')}</span>
        <div role="radiogroup" aria-label={t('setup.rival')} className="grid grid-cols-5 gap-1">
          {RIVAL_LEVELS.map((l) => (
            <button
              key={l.level}
              type="button"
              role="radio"
              aria-checked={l.level === level}
              aria-label={t('setup.levelAria', { level: l.level, name: l.name, elo: rivalEloText(l, t) })}
              title={`${l.name} · ${rivalEpithet(l, t)} · ${rivalEloText(l, t)}`}
              data-testid={`level-${l.level}`}
              disabled={disabled}
              onClick={() => onLevelChange(l.level)}
              className={`py-1.5 px-0.5 rounded-lg transition-all disabled:opacity-50 flex flex-col items-center leading-tight ${
                l.level === level ? 'bg-brand-600 text-white shadow' : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-brand-50 dark:hover:bg-brand-950/60'
              }`}
            >
              <RivalAvatar level={l.level} size={30} label={l.name} />
              <span className="text-[11px] font-bold truncate max-w-full mt-0.5">{l.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <RivalAvatar level={def.level} size={44} label={def.name} />
          <p data-testid="level-label" className="text-sm text-ink-700 dark:text-ink-200 min-w-0">
            <span className="font-black text-brand-700 dark:text-brand-300">{def.name}</span>
            <span className="font-bold"> · {rivalEloText(def, t)}</span>
            <span className="block text-xs text-ink-500 dark:text-ink-400">{rivalEpithet(def, t)}</span>
          </p>
        </div>
        {onRivalVoiceChange && (
          <div data-testid="rival-voice" data-value={rivalVoiceOn ? 'on' : 'off'} className="mt-2 flex items-center justify-between gap-2">
            <span id="rival-voice-label" className="text-xs font-bold text-ink-600 dark:text-ink-300">{t('setup.rivalTalks')}</span>
            <div role="radiogroup" aria-labelledby="rival-voice-label" className="grid grid-cols-2 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl w-28">
              {[
                { on: true, label: t('common.yes') },
                { on: false, label: t('common.no') },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={o.on === rivalVoiceOn}
                  data-testid={`rival-voice-${o.on ? 'on' : 'off'}`}
                  title={o.on ? t('setup.rivalTalksOn', { name: def.name }) : t('setup.rivalTalksOff', { name: def.name })}
                  onClick={() => onRivalVoiceChange(o.on)}
                  className={`${segmented(o.on === rivalVoiceOn)} !py-1 !text-xs`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {onCoachChange && <CoachPicker value={coachId} onChange={onCoachChange} size={34} />}

      <div>
        <span className="block text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-2">{t('setup.youPlay')}</span>
        <div role="radiogroup" aria-label={t('setup.color')} className="grid grid-cols-3 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === colorChoice}
              data-testid={`color-${c.id}`}
              disabled={disabled}
              onClick={() => onColorChange(c.id)}
              className={segmented(c.id === colorChoice)}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {onTimeControlChange && (
        <div>
          <span className="block text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-2">{t('setup.timeControl')}</span>
          <div role="radiogroup" aria-label={t('setup.timeControl')} className="grid grid-cols-4 gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl">
            {TIME_CONTROLS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={s === timeControl}
                data-testid={`time-${s / 60}`}
                disabled={disabled}
                onClick={() => onTimeControlChange(s)}
                className={segmented(s === timeControl)}
              >
                {s / 60} min
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        data-testid="start-game"
        disabled={disabled}
        onClick={onStart}
        className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
      >
        <Play size={18} /> {t('setup.play', { name: def.name })}
      </button>
      {rivalStatus && <p className="text-[11px] text-center text-ink-400">{t('setup.rivalEngine', { status: rivalStatus })}</p>}
    </div>
  );
};

export default LevelSelector;
