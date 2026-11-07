import React, { useId } from 'react';
import { useI18n } from '../i18n/useI18n';

// Avatar de Alfred: señor mayor de barba y bigote blancos, gafas redondas y saco de tweed con
// un caballo de ajedrez en la solapa. SVG propio (sin imágenes externas: COEP require-corp).
//
// `mood` cambia cejas, ojos y boca:
//   feliz      → elogio (cejas arriba, sonrisa, mejillas)
//   neutral    → comentario normal
//   pensativo  → imprecisión / pista (mira hacia arriba, una ceja levantada)
//   preocupado → error o error grave (cejas en ángulo, boca hacia abajo)
//   pensando   → analizando tu jugada (ojos arriba, boca pequeña)

export const MOODS = Object.freeze(['feliz', 'neutral', 'pensativo', 'preocupado', 'pensando']);

const SKIN = '#f1c7a5';
const SKIN_SHADE = '#e2a982';
const HAIR = '#f8fafc';
const HAIR_LINE = '#cbd5e1';
const INK = '#1e293b';

const BROWS = {
  feliz: ['M41 44 Q48 39 56 43', 'M64 43 Q72 39 79 44'],
  neutral: ['M41 46 Q48 43 56 46', 'M64 46 Q72 43 79 46'],
  pensativo: ['M41 46 Q48 44 56 46', 'M64 43 Q72 38 79 42'],
  preocupado: ['M41 46 Q49 45 56 41', 'M64 41 Q71 45 79 46'],
  pensando: ['M41 44 Q48 41 56 44', 'M64 44 Q72 41 79 44'],
};

const EYES = {
  feliz: { dy: 0, dx: 0, happy: true },
  neutral: { dy: 0, dx: 0 },
  pensativo: { dy: -1.5, dx: 1.5 },
  preocupado: { dy: 0.5, dx: 0 },
  pensando: { dy: -2, dx: -1 },
};

const MOUTHS = {
  feliz: 'M52 80 Q60 88 68 80',
  neutral: 'M54 81 Q60 82 66 81',
  pensativo: 'M55 81 Q61 80 66 82',
  preocupado: 'M53 84 Q60 78 67 84',
  pensando: 'M57 81 Q60 83 63 81',
};

const AlfredAvatar = ({ mood = 'neutral', size = 64, className = '' }) => {
  const face = MOODS.includes(mood) ? mood : 'neutral';
  const clipId = useId();
  const { t } = useI18n();
  const eyes = EYES[face];
  const [browL, browR] = BROWS[face];

  return (
    <svg
      data-testid="alfred-avatar" data-coach="alfred"
      data-mood={face}
      role="img"
      aria-label={t('coach.avatarLabel', { name: 'Alfred' })}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`flex-shrink-0 drop-shadow-sm ${className}`}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle cx="60" cy="60" r="60" fill="#e9dfcf" />
        <circle cx="60" cy="60" r="46" fill="#d6c3a5" opacity="0.6" />

        {/* Saco de tweed, camisa y pajarita */}
        <path d="M10 120 C12 99 32 89 60 89 C88 89 108 99 110 120 Z" fill="#7c5a3a" />
        <path d="M10 120 C12 99 32 89 60 89 C88 89 108 99 110 120 Z" fill="none" stroke="#5b4129" strokeWidth="1" opacity="0.6" />
        <path d="M30 104 l4 4 M36 100 l4 4 M84 100 l-4 4 M90 104 l-4 4 M26 112 l4 4 M94 112 l-4 4" stroke="#5b4129" strokeWidth="1" opacity="0.5" />
        <path d="M44 90 L60 112 L76 90 Z" fill="#f8fafc" />
        <path d="M44 90 L54 120 L36 120 L34 96 Z" fill="#6b4c30" />
        <path d="M76 90 L66 120 L84 120 L86 96 Z" fill="#6b4c30" />
        <path d="M52 99 L60 103 L52 107 Z M68 99 L60 103 L68 107 Z" fill="#b91c1c" />
        <circle cx="60" cy="103" r="2" fill="#991b1b" />
        <text x="79" y="113" fontSize="11" fill="#facc15" textAnchor="middle" aria-hidden="true">♞</text>

        {/* Orejas y cabeza */}
        <ellipse cx="33" cy="62" rx="5" ry="8" fill={SKIN_SHADE} />
        <ellipse cx="87" cy="62" rx="5" ry="8" fill={SKIN_SHADE} />
        <ellipse cx="60" cy="58" rx="27" ry="31" fill={SKIN} />
        <ellipse cx="57" cy="35" rx="9" ry="3" fill="#ffffff" opacity="0.4" />

        {/* Pelo blanco a los lados */}
        <path d="M33 58 C28 44 33 32 44 30 C40 38 38 46 39 56 Z" fill={HAIR} stroke={HAIR_LINE} strokeWidth="1" />
        <path d="M87 58 C92 44 87 32 76 30 C80 38 82 46 81 56 Z" fill={HAIR} stroke={HAIR_LINE} strokeWidth="1" />

        {/* Barba */}
        <path
          d="M33 60 C32 84 44 102 60 104 C76 102 88 84 87 60 C83 72 74 77 60 77 C46 77 37 72 33 60 Z"
          fill={HAIR}
          stroke={HAIR_LINE}
          strokeWidth="1.2"
        />
        <path d="M46 90 q3 4 0 8 M60 94 q3 4 0 8 M74 90 q-3 4 0 8" stroke={HAIR_LINE} strokeWidth="1" fill="none" />

        {/* Mejillas (contento) */}
        {face === 'feliz' && (
          <>
            <circle cx="43" cy="67" r="4.5" fill="#fca5a5" opacity="0.55" />
            <circle cx="77" cy="67" r="4.5" fill="#fca5a5" opacity="0.55" />
          </>
        )}

        {/* Nariz */}
        <path d="M60 56 C58 63 56 67 59 69 C61 70 64 69 63 67" fill="none" stroke={SKIN_SHADE} strokeWidth="2" strokeLinecap="round" />

        {/* Boca y bigote */}
        <path d={MOUTHS[face]} fill="none" stroke="#7f1d1d" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M43 76 C49 68 57 70 60 73 C63 70 71 68 77 76 C70 78 64 77 60 75 C56 77 50 78 43 76 Z"
          fill="#eef2f7"
          stroke={HAIR_LINE}
          strokeWidth="1.2"
        />

        {/* Ojos */}
        {eyes.happy ? (
          <>
            <path d="M46 58 Q49 55 52 58" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
            <path d="M68 58 Q71 55 74 58" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx={49 + eyes.dx} cy={57 + eyes.dy} r="2.6" fill={INK} />
            <circle cx={71 + eyes.dx} cy={57 + eyes.dy} r="2.6" fill={INK} />
          </>
        )}

        {/* Gafas redondas */}
        <circle cx="49" cy="57" r="8" fill="#ffffff" fillOpacity="0.15" stroke="#475569" strokeWidth="2" />
        <circle cx="71" cy="57" r="8" fill="#ffffff" fillOpacity="0.15" stroke="#475569" strokeWidth="2" />
        <path d="M57 56 Q60 54 63 56 M41 56 L34 54 M79 56 L86 54" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" />

        {/* Cejas blancas y pobladas */}
        {[browL, browR].map((d) => (
          <g key={d}>
            <path d={d} fill="none" stroke={HAIR_LINE} strokeWidth="6" strokeLinecap="round" />
            <path d={d} fill="none" stroke={HAIR} strokeWidth="4.2" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </svg>
  );
};

export default AlfredAvatar;
