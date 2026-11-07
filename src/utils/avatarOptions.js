// Opciones del avatar del usuario y su perfil guardado (nombre + avatar) en el navegador.

export const SKIN_TONES = ['#ffdbac', '#f1c7a5', '#e0ac69', '#c68642', '#8d5524'];
export const HAIR_COLORS = ['#1f1308', '#5a3418', '#a86b32', '#d6b370', '#9ca3af', '#b42318'];
export const HAIR_STYLES = [
  { id: 'corto', labelKey: 'avatar.opt.corto' },
  { id: 'rizado', labelKey: 'avatar.opt.rizado' },
  { id: 'largo', labelKey: 'avatar.opt.largo' },
  { id: 'cresta', labelKey: 'avatar.opt.cresta' },
  { id: 'calvo', labelKey: 'avatar.opt.calvo' },
];
export const FACIAL_HAIR = [
  { id: 'ninguno', labelKey: 'avatar.opt.ninguno' },
  { id: 'barba', labelKey: 'avatar.opt.barba' },
  { id: 'bigote', labelKey: 'avatar.opt.bigote' },
  { id: 'perilla', labelKey: 'avatar.opt.perilla' },
];
export const SHIRT_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#334155'];
export const BG_COLORS = ['#c7d2fe', '#bae6fd', '#bbf7d0', '#fde68a', '#fecaca', '#e9d5ff'];

/** @typedef {{skin:string, hairStyle:string, hairColor:string, facialHair:string, glasses:boolean, shirt:string, bg:string}} AvatarConfig */

/** @type {AvatarConfig} */
export const DEFAULT_AVATAR = Object.freeze({
  skin: SKIN_TONES[1],
  hairStyle: 'corto',
  hairColor: HAIR_COLORS[0],
  facialHair: 'ninguno',
  glasses: false,
  shirt: SHIRT_COLORS[0],
  bg: BG_COLORS[0],
});

const KEY = 'coach-chess:profile';

/** Perfil guardado: { name, avatar }. Valores desconocidos vuelven a los de por defecto. */
export function readProfile(defaultName) {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') ?? {};
    const a = { ...DEFAULT_AVATAR, ...(raw.avatar ?? {}) };
    const ok = {
      skin: SKIN_TONES.includes(a.skin) ? a.skin : DEFAULT_AVATAR.skin,
      hairStyle: HAIR_STYLES.some((h) => h.id === a.hairStyle) ? a.hairStyle : DEFAULT_AVATAR.hairStyle,
      hairColor: HAIR_COLORS.includes(a.hairColor) ? a.hairColor : DEFAULT_AVATAR.hairColor,
      facialHair: FACIAL_HAIR.some((f) => f.id === a.facialHair) ? a.facialHair : DEFAULT_AVATAR.facialHair,
      glasses: Boolean(a.glasses),
      shirt: SHIRT_COLORS.includes(a.shirt) ? a.shirt : DEFAULT_AVATAR.shirt,
      bg: BG_COLORS.includes(a.bg) ? a.bg : DEFAULT_AVATAR.bg,
    };
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : defaultName;
    return { name, avatar: ok };
  } catch {
    return { name: defaultName, avatar: { ...DEFAULT_AVATAR } };
  }
}

export function writeProfile(profile) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Sin almacenamiento: dura la sesión.
  }
}
