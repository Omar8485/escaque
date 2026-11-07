import React, { useId } from 'react';

// Avatares en SVG propio (sin imágenes externas: COEP require-corp). viewBox 100×100, pensados
// para verse bien pequeños (22–40 px) junto al nombre.
//  - RivalAvatar: los 10 personajes griegos del rival (src/engine/rivalLevels.js).
//  - UserAvatar: el avatar configurable del usuario (src/utils/avatarOptions.js).

const INK = '#1f2937';

/** Cara base: cabeza, orejas, ojos, cejas y boca. */
function Face({ skin, eyes = 'normal', brows = 'normal', mouth = 'smile', cheeks = false, lashes = false }) {
  const shade = 'rgba(0,0,0,0.08)';
  return (
    <g>
      <rect x="44" y="62" width="12" height="12" rx="4" fill={skin} />
      <ellipse cx="28" cy="50" rx="4" ry="6" fill={skin} />
      <ellipse cx="72" cy="50" rx="4" ry="6" fill={skin} />
      <ellipse cx="50" cy="48" rx="22" ry="25" fill={skin} />
      <ellipse cx="50" cy="66" rx="14" ry="5" fill={shade} />
      {cheeks && (
        <>
          <circle cx="37" cy="58" r="4" fill="#fb7185" opacity="0.35" />
          <circle cx="63" cy="58" r="4" fill="#fb7185" opacity="0.35" />
        </>
      )}
      {/* Ojos */}
      {eyes === 'happy' ? (
        <>
          <path d="M38 49 Q41 45 44 49" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M56 49 Q59 45 62 49" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : eyes === 'wink' ? (
        <>
          <circle cx="41" cy="48" r="2.8" fill={INK} />
          <path d="M56 48.5 Q59 46 62 48.5" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="41" cy="48" r="2.8" fill={INK} />
          <circle cx="59" cy="48" r="2.8" fill={INK} />
          <circle cx="42" cy="47" r="0.9" fill="#fff" />
          <circle cx="60" cy="47" r="0.9" fill="#fff" />
        </>
      )}
      {lashes && <path d="M37 45 l-2 -2 M39 44 l-1 -2.5 M61 44 l1 -2.5 M63 45 l2 -2" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />}
      {/* Cejas */}
      {brows === 'stern' ? (
        <path d="M36 41 L45 43 M64 41 L55 43" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      ) : brows === 'raised' ? (
        <path d="M36 40 Q41 37 46 40 M54 40 Q59 37 64 40" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M36 42 Q41 40 46 42 M54 42 Q59 40 64 42" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      )}
      {/* Boca */}
      {mouth === 'grin' ? (
        <path d="M42 58 Q50 67 58 58 Z" fill="#7f1d1d" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      ) : mouth === 'smirk' ? (
        <path d="M43 60 Q51 63 58 57" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      ) : mouth === 'flat' ? (
        <path d="M44 60 L56 60" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <path d="M43 58 Q50 64 57 58" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      )}
    </g>
  );
}

const Shoulders = ({ color }) => <path d="M14 100 C16 80 31 72 50 72 C69 72 84 80 86 100 Z" fill={color} />;
const Beard = ({ color, full = true }) =>
  full ? (
    <path d="M28 50 C28 72 39 82 50 82 C61 82 72 72 72 50 C69 62 61 67 50 67 C39 67 31 62 28 50 Z" fill={color} />
  ) : (
    <path d="M44 66 Q50 76 56 66 Q50 69 44 66 Z" fill={color} />
  );
const Moustache = ({ color }) => <path d="M40 57 C44 53 49 55 50 56.5 C51 55 56 53 60 57 C55 58.5 52 58 50 57.5 C48 58 45 58.5 40 57 Z" fill={color} />;

/** Frame común: fondo circular recortado. */
function Frame({ bg, size, label, testId, children }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} data-testid={testId} className="flex-shrink-0 rounded-full">
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <circle cx="50" cy="50" r="50" fill={bg} />
        {children}
      </g>
    </svg>
  );
}

// ---------- Pelo del usuario ----------

function UserHair({ style, color, part }) {
  if (style === 'calvo') return null;
  if (style === 'largo') {
    return part === 'back' ? (
      <path d="M24 46 C22 22 38 16 50 16 C62 16 78 22 76 46 L80 84 L64 80 L66 52 L34 52 L36 80 L20 84 Z" fill={color} />
    ) : (
      <path d="M27 44 C27 26 39 20 50 20 C62 20 74 26 73 44 C66 33 56 30 50 31 C44 34 34 36 27 44 Z" fill={color} />
    );
  }
  if (part === 'back') return null;
  if (style === 'rizado') {
    return (
      <g fill={color}>
        {[[30, 38], [36, 29], [44, 24], [52, 23], [60, 25], [67, 30], [71, 39], [33, 33], [64, 33]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="8" />
        ))}
      </g>
    );
  }
  if (style === 'cresta') {
    return <path d="M43 30 L46 10 L50 24 L54 8 L57 30 Q50 33 43 30 Z" fill={color} />;
  }
  // corto
  return <path d="M27 44 C26 26 38 20 50 20 C63 20 75 27 73 44 C70 34 62 30 50 31 C39 31 31 35 27 44 Z" fill={color} />;
}

/**
 * Avatar configurable del usuario.
 * @param {{config: import('../utils/avatarOptions.js').AvatarConfig, size?: number, label?: string}} props
 */
export function UserAvatar({ config, size = 40, label }) {
  const c = config;
  return (
    <Frame bg={c.bg} size={size} label={label} testId="user-avatar">
      <UserHair style={c.hairStyle} color={c.hairColor} part="back" />
      <Shoulders color={c.shirt} />
      <Face skin={c.skin} />
      {c.facialHair === 'barba' && <Beard color={c.hairColor} />}
      {(c.facialHair === 'bigote' || c.facialHair === 'perilla' || c.facialHair === 'barba') && <Moustache color={c.hairColor} />}
      {c.facialHair === 'perilla' && <Beard color={c.hairColor} full={false} />}
      {c.facialHair === 'barba' && <path d="M43 58 Q50 64 57 58" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />}
      <UserHair style={c.hairStyle} color={c.hairColor} part="front" />
      {c.glasses && (
        <g fill="rgba(255,255,255,0.25)" stroke={INK} strokeWidth="2">
          <circle cx="41" cy="48" r="7" />
          <circle cx="59" cy="48" r="7" />
          <path d="M48 48 L52 48 M34 47 L29 45 M66 47 L71 45" fill="none" />
        </g>
      )}
    </Frame>
  );
}

// ---------- Personajes ----------

const FEATHER = (d) => <path d={d} fill="#fff" stroke="#94a3b8" strokeWidth="1.2" />;

/** Cada personaje: fondo, piel y capas (detrás y delante de la cara). */
const RIVALS = {
  // Ícaro: rubio rizado, alas de plumas y un sol que lo tienta.
  1: {
    bg: '#7dd3fc',
    render: () => (
      <>
        <circle cx="82" cy="18" r="9" fill="#fde047" />
        {FEATHER('M20 78 C2 66 2 46 14 40 C12 54 22 64 34 70 Z')}
        {FEATHER('M80 78 C98 66 98 46 86 40 C88 54 78 64 66 70 Z')}
        <Shoulders color="#f8fafc" />
        <Face skin="#f1c7a5" eyes="happy" mouth="grin" cheeks />
        <UserHair style="rizado" color="#f2c94c" part="front" />
      </>
    ),
  },
  // Narciso: peinado perfecto, pestañas, espejo de mano y un destello.
  2: {
    bg: '#fbcfe8',
    render: () => (
      <>
        <Shoulders color="#db2777" />
        <Face skin="#ffdbac" mouth="smirk" lashes cheeks />
        <path d="M27 44 C25 24 40 16 54 18 C66 19 76 28 73 44 C66 30 52 26 40 34 C36 36 30 38 27 44 Z" fill="#3b2314" />
        <path d="M54 18 C66 14 76 22 74 32 C70 24 62 20 54 22 Z" fill="#5a3418" />
        <circle cx="78" cy="80" r="9" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="2" />
        <rect x="76" y="88" width="4" height="12" rx="2" fill="#94a3b8" />
        <path d="M20 22 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#fff" />
      </>
    ),
  },
  // Perseo: casco plateado con alitas.
  3: {
    bg: '#99f6e4',
    render: () => (
      <>
        <Shoulders color="#0f766e" />
        <Face skin="#e0ac69" brows="raised" />
        <path d="M25 44 C25 20 75 20 75 44 Q50 34 25 44 Z" fill="#cbd5e1" stroke="#64748b" strokeWidth="1.5" />
        {FEATHER('M25 36 C14 30 10 22 12 16 C18 22 24 26 30 30 Z')}
        {FEATHER('M75 36 C86 30 90 22 88 16 C82 22 76 26 70 30 Z')}
      </>
    ),
  },
  // Jasón: el vellocino de oro sobre los hombros.
  4: {
    bg: '#fdba74',
    render: () => (
      <>
        <Shoulders color="#92400e" />
        <g fill="#facc15" stroke="#ca8a04" strokeWidth="1">
          {[[18, 92], [26, 84], [34, 79], [42, 77], [58, 77], [66, 79], [74, 84], [82, 92]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="7" />
          ))}
        </g>
        <Face skin="#f1c7a5" mouth="grin" />
        <UserHair style="corto" color="#5a3418" part="front" />
      </>
    ),
  },
  // Teseo: cinta en la frente y el ovillo de hilo rojo de Ariadna.
  5: {
    bg: '#c4b5fd',
    render: () => (
      <>
        <Shoulders color="#4c1d95" />
        <Face skin="#c68642" />
        <UserHair style="rizado" color="#1f1308" part="front" />
        <rect x="27" y="36" width="46" height="5" rx="2.5" fill="#dc2626" />
        <path d="M70 92 Q60 80 74 74 Q88 70 82 60" stroke="#dc2626" strokeWidth="2" fill="none" />
        <circle cx="80" cy="88" r="9" fill="#ef4444" stroke="#991b1b" strokeWidth="1.5" />
        <path d="M74 84 Q80 88 86 84 M73 90 Q80 94 87 90" stroke="#991b1b" strokeWidth="1.2" fill="none" />
      </>
    ),
  },
  // Héctor: casco troyano de bronce con cresta de crin.
  6: {
    bg: '#fca5a5',
    render: () => (
      <>
        <path d="M30 26 C34 6 66 6 70 26 C62 18 38 18 30 26 Z" fill="#292524" />
        <Shoulders color="#7f1d1d" />
        <Face skin="#e0ac69" brows="stern" mouth="flat" />
        <Beard color="#292524" />
        <Moustache color="#292524" />
        <path d="M25 46 C25 22 75 22 75 46 L75 54 L68 54 L68 44 L32 44 L32 54 L25 54 Z" fill="#b45309" stroke="#78350f" strokeWidth="1.5" />
        <rect x="48" y="44" width="4" height="12" rx="2" fill="#b45309" stroke="#78350f" strokeWidth="1" />
      </>
    ),
  },
  // Odiseo: gorro de viajero (pilos), barba rizada y guiño de astuto.
  7: {
    bg: '#93c5fd',
    render: () => (
      <>
        <Shoulders color="#1e3a8a" />
        <Face skin="#e0ac69" eyes="wink" mouth="smirk" />
        <g fill="#3f2a14">
          {[[32, 66], [38, 73], [45, 77], [55, 77], [62, 73], [68, 66], [30, 58], [70, 58]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="6" />
          ))}
        </g>
        <Moustache color="#3f2a14" />
        <path d="M30 38 L50 6 L70 38 Q50 32 30 38 Z" fill="#a16207" stroke="#713f12" strokeWidth="1.5" />
      </>
    ),
  },
  // Aquiles: casco dorado con penacho rojo y mirada feroz.
  8: {
    bg: '#fda4af',
    render: () => (
      <>
        <path d="M34 22 C30 2 70 2 66 22 C60 14 40 14 34 22 Z" fill="#dc2626" />
        <Shoulders color="#b91c1c" />
        <Face skin="#f1c7a5" brows="stern" mouth="grin" />
        <path d="M25 46 C25 22 75 22 75 46 L75 58 L66 58 L66 44 L34 44 L34 58 L25 58 Z" fill="#eab308" stroke="#a16207" strokeWidth="1.5" />
      </>
    ),
  },
  // Heracles: la piel del león de Nemea como capucha y gran barba.
  9: {
    bg: '#fcd34d',
    render: () => (
      <>
        <circle cx="50" cy="42" r="34" fill="#b45309" />
        <Shoulders color="#92400e" />
        <Face skin="#c68642" brows="stern" mouth="grin" />
        <Beard color="#3f2a14" />
        <Moustache color="#3f2a14" />
        <path d="M43 58 Q50 66 57 58" stroke={INK} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M24 40 C24 16 76 16 76 40 Q50 28 24 40 Z" fill="#d97706" />
        <circle cx="32" cy="18" r="6" fill="#d97706" />
        <circle cx="68" cy="18" r="6" fill="#d97706" />
        <circle cx="42" cy="28" r="2" fill={INK} />
        <circle cx="58" cy="28" r="2" fill={INK} />
        <path d="M47 32 L53 32 L50 35 Z" fill={INK} />
      </>
    ),
  },
  // Atenea: casco con cresta, pelo largo y su búho en el hombro.
  10: {
    bg: '#a5b4fc',
    render: () => (
      <>
        <UserHair style="largo" color="#1f1308" part="back" />
        <path d="M36 24 C36 4 64 4 64 24 Z" fill="#1d4ed8" />
        <Shoulders color="#e2e8f0" />
        <Face skin="#f1c7a5" eyes="happy" lashes />
        <path d="M26 42 C26 22 74 22 74 42 Q50 34 26 42 Z" fill="#94a3b8" stroke="#475569" strokeWidth="1.5" />
        <g>
          <ellipse cx="80" cy="86" rx="10" ry="12" fill="#92400e" />
          <circle cx="76" cy="82" r="4" fill="#fef3c7" />
          <circle cx="84" cy="82" r="4" fill="#fef3c7" />
          <circle cx="76" cy="82" r="1.8" fill={INK} />
          <circle cx="84" cy="82" r="1.8" fill={INK} />
          <path d="M78.5 86 L81.5 86 L80 89 Z" fill="#f59e0b" />
          <path d="M71 76 L74 72 L76 77 M89 76 L86 72 L84 77" fill="#92400e" />
        </g>
      </>
    ),
  },
};

/**
 * Avatar del personaje de un nivel del rival.
 * @param {{level: number, size?: number, label?: string}} props
 */
export function RivalAvatar({ level, size = 40, label }) {
  const r = RIVALS[level] ?? RIVALS[6];
  return (
    <Frame bg={r.bg} size={size} label={label ?? `Avatar del nivel ${level}`} testId={`rival-avatar-${level}`}>
      {r.render()}
    </Frame>
  );
}
