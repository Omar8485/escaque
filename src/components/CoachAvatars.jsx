import React, { useId } from 'react';
import AlfredAvatar from './AlfredAvatar';
import { useI18n } from '../i18n/useI18n';

// Avatares de los coaches elegibles, con las mismas cinco expresiones (feliz, neutral, pensativo,
// preocupado, pensando). Alfred tiene su propio dibujo (AlfredAvatar.jsx).
//  - Kairós: el dios del momento oportuno; joven, con el famoso mechón en la frente (la ocasión
//    se toma "por los pelos") y alitas.
//  - Ariadna: trenza larga con el hilo rojo que sacó a Teseo del laberinto.

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
  feliz: 'M50 72 Q60 82 70 72',
  neutral: 'M53 74 Q60 76 67 74',
  pensativo: 'M54 74 Q61 73 67 75',
  preocupado: 'M52 77 Q60 70 68 77',
  pensando: 'M57 74 Q60 76 63 74',
};

const MOODS = ['feliz', 'neutral', 'pensativo', 'preocupado', 'pensando'];

function MoodFace({ mood, browColor, lashes = false }) {
  const eyes = EYES[mood];
  return (
    <g>
      {eyes.happy ? (
        <>
          <path d="M46 58 Q49 55 52 58" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M68 58 Q71 55 74 58" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx={49 + eyes.dx} cy={57 + eyes.dy} r="2.8" fill={INK} />
          <circle cx={71 + eyes.dx} cy={57 + eyes.dy} r="2.8" fill={INK} />
          <circle cx={50 + eyes.dx} cy={56 + eyes.dy} r="0.9" fill="#fff" />
          <circle cx={72 + eyes.dx} cy={56 + eyes.dy} r="0.9" fill="#fff" />
        </>
      )}
      {lashes && <path d="M44 53 l-2.5 -2 M46.5 51.5 l-1.2 -2.6 M73.5 51.5 l1.2 -2.6 M76 53 l2.5 -2" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />}
      {BROWS[mood].map((d) => (
        <path key={d} d={d} fill="none" stroke={browColor} strokeWidth="3" strokeLinecap="round" />
      ))}
      <path d="M60 60 C58 64 57 66 60 67" fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="1.8" strokeLinecap="round" />
      <path d={MOUTHS[mood]} fill="none" stroke="#7f1d1d" strokeWidth="2.2" strokeLinecap="round" />
      {mood === 'feliz' && (
        <>
          <circle cx="43" cy="66" r="4.5" fill="#fb7185" opacity="0.4" />
          <circle cx="77" cy="66" r="4.5" fill="#fb7185" opacity="0.4" />
        </>
      )}
    </g>
  );
}

function Frame({ size, name, mood, coach, bg, children }) {
  const clip = useId();
  const { t } = useI18n();
  const label = t('coach.avatarLabel', { name });
  return (
    <svg
      data-testid={`coach-avatar-${coach}`}
      data-mood={mood}
      role="img"
      aria-label={label}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="flex-shrink-0 drop-shadow-sm"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <circle cx="60" cy="60" r="60" fill={bg[0]} />
        <circle cx="60" cy="60" r="46" fill={bg[1]} opacity="0.6" />
        {children}
      </g>
    </svg>
  );
}

export function KairosAvatar({ mood = 'neutral', size = 64 }) {
  const m = MOODS.includes(mood) ? mood : 'neutral';
  const skin = '#d9a066';
  return (
    <Frame size={size} name="Kairós" mood={m} coach="kairos" bg={['#f6e2b3', '#eccb7a']}>
      {/* alitas */}
      <path d="M14 104 C2 88 4 70 16 64 C16 78 24 88 36 94 Z" fill="#fff" stroke="#cbb68a" strokeWidth="1.5" />
      <path d="M106 104 C118 88 116 70 104 64 C104 78 96 88 84 94 Z" fill="#fff" stroke="#cbb68a" strokeWidth="1.5" />
      {/* túnica */}
      <path d="M12 120 C14 99 34 89 60 89 C86 89 106 99 108 120 Z" fill="#0f766e" />
      <path d="M44 90 L60 106 L76 90 Z" fill={skin} />
      <path d="M70 90 L84 120 L92 120 L78 92 Z" fill="#f59e0b" />
      {/* cabeza */}
      <ellipse cx="33" cy="62" rx="5" ry="8" fill={skin} />
      <ellipse cx="87" cy="62" rx="5" ry="8" fill={skin} />
      <ellipse cx="60" cy="58" rx="27" ry="31" fill={skin} />
      {/* pelo corto atrás y el famoso mechón en la frente */}
      <path d="M33 52 C31 32 44 26 60 26 C76 26 89 32 87 52 C82 40 72 36 60 36 C48 36 38 40 33 52 Z" fill="#3b2314" />
      <path d="M56 27 C46 20 50 6 62 8 C56 12 58 18 66 20 C72 22 72 34 62 40 C66 32 62 28 56 27 Z" fill="#3b2314" />
      <MoodFace mood={m} browColor="#3b2314" />
    </Frame>
  );
}

export function AriadnaAvatar({ mood = 'neutral', size = 64 }) {
  const m = MOODS.includes(mood) ? mood : 'neutral';
  const skin = '#f1c7a5';
  return (
    <Frame size={size} name="Ariadna" mood={m} coach="ariadna" bg={['#f8dccf', '#efb9a3']}>
      {/* pelo de atrás */}
      <path d="M30 60 C26 28 44 18 60 18 C76 18 94 28 90 60 L92 96 L80 92 L82 64 L38 64 L40 92 L28 96 Z" fill="#2b1810" />
      {/* vestido */}
      <path d="M12 120 C14 99 34 89 60 89 C86 89 106 99 108 120 Z" fill="#7c3aed" />
      <path d="M44 90 L60 104 L76 90 Z" fill={skin} />
      {/* cabeza */}
      <ellipse cx="33" cy="62" rx="5" ry="8" fill={skin} />
      <ellipse cx="87" cy="62" rx="5" ry="8" fill={skin} />
      <ellipse cx="60" cy="58" rx="27" ry="31" fill={skin} />
      {/* flequillo */}
      <path d="M33 54 C32 32 46 24 60 24 C76 24 90 32 87 54 C80 40 70 34 60 38 C52 34 40 40 33 54 Z" fill="#2b1810" />
      {/* trenza sobre el hombro con lazo rojo */}
      <g fill="#2b1810">
        <ellipse cx="86" cy="82" rx="7" ry="6" />
        <ellipse cx="88" cy="93" rx="6.5" ry="5.5" />
        <ellipse cx="89" cy="103" rx="6" ry="5" />
      </g>
      <path d="M84 108 L94 108 L90 114 Z" fill="#dc2626" />
      {/* el hilo rojo */}
      <path d="M90 110 C98 116 104 106 112 112" stroke="#dc2626" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="113" cy="113" r="5" fill="#ef4444" stroke="#991b1b" strokeWidth="1.2" />
      <MoodFace mood={m} browColor="#2b1810" lashes />
    </Frame>
  );
}

/** Avatar del coach elegido. */
export function CoachAvatar({ coach = 'alfred', mood = 'neutral', size = 64 }) {
  if (coach === 'kairos') return <KairosAvatar mood={mood} size={size} />;
  if (coach === 'ariadna') return <AriadnaAvatar mood={mood} size={size} />;
  return <AlfredAvatar mood={mood} size={size} />;
}
