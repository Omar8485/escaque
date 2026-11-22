import React from 'react';
import { PieceIcon } from './ChessPiece';
import { useI18n } from '../i18n/useI18n';

const formatClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Segundos por debajo de los cuales el reloj activo se pone en rojo. */
const LOW_TIME = 20;

// Barra de un jugador junto al tablero (arriba el rival, abajo tú): nombre, piezas que capturó,
// ventaja de material (+N, como lichess/chess.com) y su reloj.
// variant 'row': una línea encima/debajo del tablero (chess.com). 'column': bloque en la columna
// lateral, a la altura de su lado del tablero (lichess); ChessBoard elige según el espacio.
// `speech`: globo de diálogo del rival (<RivalSpeech/>); se le pasan variant/position/hasClock.
const PlayerBar = ({ color, name, detail, avatar = null, captured = [], advantage = 0, clock = null, clockActive = false, isTurn = false, variant = 'row', position = 'top', speech = null }) => {
  const { t } = useI18n();
  const victim = color === 'w' ? 'b' : 'w';
  const groups = [];
  for (const t of captured) {
    const last = groups.at(-1);
    if (last?.type === t) last.n += 1;
    else groups.push({ type: t, n: 1 });
  }
  const low = clock !== null && clock <= LOW_TIME;
  const clockStyle = clockActive
    ? low
      ? 'bg-rose-600 text-white'
      : 'bg-brand-600 text-white'
    : 'bg-ink-200 text-ink-500 dark:bg-ink-800 dark:text-ink-400';

  const capturedRow = (
      <div data-testid={`captured-${color}`} className="flex items-center min-w-0 overflow-hidden" title={t('bar.captured')}>
        {groups.map((g) => (
          <span key={g.type} className="flex items-center mr-1">
            {Array.from({ length: g.n }, (_, i) => (
              <PieceIcon
                key={i}
                type={g.type}
                color={victim}
                size={18}
                // Las piezas negras capturadas llevan un contorno claro en el tema oscuro para verse.
                className={`${i > 0 ? '-ml-2.5' : ''} ${victim === 'b' ? 'dark:drop-shadow-[0_0_1px_rgba(255,255,255,0.9)]' : ''}`}
              />
            ))}
          </span>
        ))}
        {advantage > 0 && (
          <span data-testid={`advantage-${color}`} className="text-xs font-bold text-ink-600 dark:text-ink-300 ml-0.5">
            +{advantage}
          </span>
        )}
      </div>
  );
  const clockEl =
    clock !== null ? (
      <span
        data-testid={`bar-clock-${color}`}
        className={`flex-shrink-0 font-mono font-bold rounded-lg tabular-nums ${variant === 'column' ? 'text-2xl px-3 py-1 text-center' : 'ml-auto text-lg px-3 py-0.5'} ${clockStyle}`}
      >
        {formatClock(clock)}
      </span>
    ) : null;
  // Avatar (si lo hay) con un puntito del color de sus piezas; si no, el cuadrito de color.
  const colorDot = `${color === 'w' ? 'bg-white border-ink-400' : 'bg-ink-900 border-ink-500'}`;
  const swatch = avatar ? (
    <span data-testid={`bar-avatar-${color}`} className={`relative flex-shrink-0 rounded-full ${isTurn ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-white dark:ring-offset-ink-900' : ''}`}>
      {avatar}
      <span
        aria-label={color === 'w' ? t('bar.playsWhite') : t('bar.playsBlack')}
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border ${colorDot}`}
      />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className={`w-5 h-5 rounded-md flex-shrink-0 border ${colorDot} ${isTurn ? 'ring-2 ring-brand-500' : ''}`}
    />
  );
  const speechEl = speech ? React.cloneElement(speech, { variant, position, hasClock: clock !== null }) : null;
  const nameEl = (
    <div className="min-w-0 flex items-baseline gap-1.5">
      <span className="font-bold text-sm text-ink-800 dark:text-ink-100 truncate">{name}</span>
      {detail && <span className="text-xs text-ink-500 dark:text-ink-400 whitespace-nowrap">{detail}</span>}
    </div>
  );

  if (variant === 'column') {
    // El reloj queda pegado al tablero: abajo del bloque si es el rival (arriba), arriba si eres tú.
    const info = (
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">{swatch}{nameEl}</div>
        <div className="min-h-[18px]">{capturedRow}</div>
      </div>
    );
    return (
      <div data-testid={`player-bar-${color}`} data-turn={isTurn ? 'true' : 'false'} data-variant="column" className="w-full flex flex-col gap-1.5">
        {position === 'top' ? <>{info}{speechEl}{clockEl}</> : <>{clockEl}{speechEl}{info}</>}
      </div>
    );
  }

  return (
    <div data-testid={`player-bar-${color}`} data-turn={isTurn ? 'true' : 'false'} className="relative w-full h-full flex items-center gap-2 min-w-0">
      {swatch}
      {nameEl}
      {capturedRow}
      {clockEl}
      {speechEl}
    </div>
  );
};

export default PlayerBar;
