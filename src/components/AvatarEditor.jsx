import React, { useEffect, useState } from 'react';
import { Shuffle, X } from 'lucide-react';
import { UserAvatar } from './Avatars';
import { BG_COLORS, FACIAL_HAIR, HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, SKIN_TONES } from '../utils/avatarOptions';
import { useI18n } from '../i18n/useI18n';

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const Swatches = ({ label, options, value, onChange, testId }) => (
  <div>
    <p className="text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-1.5">{label}</p>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`w-8 h-8 p-0 rounded-full border-2 transition-transform ${c === value ? 'border-brand-600 scale-110' : 'border-ink-200 dark:border-ink-700'}`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  </div>
);

const Chips = ({ label, options, value, onChange, testId, t }) => (
  <div>
    <p className="text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-1.5">{label}</p>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1 rounded-lg text-sm font-bold transition-all ${o.id === value ? 'bg-brand-600 text-white' : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-ink-200 dark:hover:bg-ink-700'}`}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  </div>
);

// Editor del avatar y nombre visible del usuario (se abre al hacer clic en tu avatar de la cabecera).
const AvatarEditor = ({ profile, onSave, onClose }) => {
  const { t } = useI18n();
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const set = (key) => (value) => setAvatar((a) => ({ ...a, [key]: value }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const randomize = () =>
    setAvatar({
      skin: pick(SKIN_TONES),
      hairStyle: pick(HAIR_STYLES).id,
      hairColor: pick(HAIR_COLORS),
      facialHair: pick(FACIAL_HAIR).id,
      glasses: Math.random() < 0.35,
      shirt: pick(SHIRT_COLORS),
      bg: pick(BG_COLORS),
    });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-ink-900/40 dark:bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('avatar.title')}
        data-testid="avatar-editor"
        className="relative w-full max-w-lg max-h-full overflow-y-auto bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 rounded-3xl shadow-2xl p-5 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-ink-800 dark:text-ink-100">{t('avatar.title')}</h3>
          <button type="button" aria-label={t('common.close')} onClick={onClose} className="p-2 rounded-lg text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <UserAvatar config={avatar} size={96} label={t('profile.avatarOf', { name })} />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <label className="text-xs font-black uppercase tracking-wider text-ink-500 dark:text-ink-400" htmlFor="profile-name">
              {t('avatar.name')}
            </label>
            <input
              id="profile-name"
              data-testid="profile-name"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-ink-50 dark:bg-ink-800 border border-ink-200 dark:border-ink-700 rounded-xl px-3 py-2 text-sm font-bold text-ink-800 dark:text-ink-100 outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={randomize}
              className="self-start px-3 py-1.5 rounded-lg text-sm font-bold bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-ink-200 dark:hover:bg-ink-700 flex items-center gap-1.5"
            >
              <Shuffle size={14} /> {t('avatar.surprise')}
            </button>
          </div>
        </div>

        <Swatches label={t('avatar.skin')} options={SKIN_TONES} value={avatar.skin} onChange={set('skin')} testId="opt-skin" />
        <Chips t={t} label={t('avatar.hair')} options={HAIR_STYLES} value={avatar.hairStyle} onChange={set('hairStyle')} testId="opt-hair" />
        <Swatches label={t('avatar.hairColor')} options={HAIR_COLORS} value={avatar.hairColor} onChange={set('hairColor')} testId="opt-hair-color" />
        <Chips t={t} label={t('avatar.facial')} options={FACIAL_HAIR} value={avatar.facialHair} onChange={set('facialHair')} testId="opt-facial" />
        <Chips
          t={t}
          label={t('avatar.glasses')}
          options={[
            { id: 'no', labelKey: 'avatar.glassesNo' },
            { id: 'si', labelKey: 'avatar.glassesYes' },
          ]}
          value={avatar.glasses ? 'si' : 'no'}
          onChange={(v) => set('glasses')(v === 'si')}
          testId="opt-glasses"
        />
        <Swatches label={t('avatar.shirt')} options={SHIRT_COLORS} value={avatar.shirt} onChange={set('shirt')} testId="opt-shirt" />
        <Swatches label={t('avatar.bg')} options={BG_COLORS} value={avatar.bg} onChange={set('bg')} testId="opt-bg" />

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl font-bold bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 hover:bg-ink-200 dark:hover:bg-ink-700">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="avatar-save"
            onClick={() => onSave({ name: name.trim() || profile.name, avatar })}
            className="px-4 py-2 rounded-xl font-bold bg-brand-600 hover:bg-brand-700 text-white"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvatarEditor;
