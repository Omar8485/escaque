import React from 'react';
import { Chess } from 'chess.js';
import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast } from 'lucide-react';
import { PieceIcon } from './ChessPiece';
import { figurine } from '../coach/templates';
import { lineFens, numberedMoves } from '../coach/refutationLine';
import { useI18n } from '../i18n/useI18n';

const FILES = 'abcdefgh';
const center = (sq, flip) => {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return flip ? { x: 7 - f + 0.5, y: r + 0.5 } : { x: f + 0.5, y: 7 - r + 0.5 };
};

/** Flecha en coordenadas de casilla (viewBox 0 0 8 8). */
const Arrow = ({ from, to, flip, color, dashed = false, id }) => {
  const a = center(from, flip);
  const b = center(to, flip);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const k = (len - 0.32) / len; // que la punta no tape la pieza de destino
  return (
    <g opacity={dashed ? 0.55 : 0.85}>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={color} />
        </marker>
      </defs>
      <line
        x1={a.x}
        y1={a.y}
        x2={a.x + (b.x - a.x) * k}
        y2={a.y + (b.y - a.y) * k}
        stroke={color}
        strokeWidth="0.17"
        strokeLinecap="round"
        strokeDasharray={dashed ? '0.25 0.18' : undefined}
        markerEnd={`url(#${id})`}
      />
    </g>
  );
};

/**
 * Mini tablero de solo lectura para reproducir la línea de refutación de "¿Por qué?" (v1.1).
 * Tablero propio y mínimo (las piezas son las de ChessPiece, sin arrastre): ChessBoard trae
 * arrastre, medidas y controles que aquí sobran. Flecha de la jugada actual (y, al inicio, de la
 * siguiente), casillas resaltadas y botones ⏮ ◀ ▶ ⏭; las jugadas de la lista también llevan a su
 * posición. Mismo dibujo de madera que el tablero principal.
 * @param {{line: import('../coach/refutationLine').RefutationLine, orientation?: 'w'|'b', size?: number}} props
 */
export default function MiniBoard({ line, orientation = 'w', size = 208 }) {
  const fens = React.useMemo(() => lineFens(line), [line]);
  const [ply, setPly] = React.useState(0);
  const last = line.moves.length;
  const current = Math.min(ply, last);
  const board = React.useMemo(() => new Chess(fens[current]).board(), [fens, current]);
  const flip = orientation === 'b';
  const played = current > 0 ? line.moves[current - 1] : null;
  const next = current === 0 ? line.moves[0] : null;
  const rows = flip ? [...board].reverse().map((r) => [...r].reverse()) : board;
  const sqSize = size / 8;
  const moves = numberedMoves(line);
  const uid = React.useId().replace(/:/g, '');
  const { t } = useI18n();

  const nav = (label, testid, Icon, target, disabled) => (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => setPly(target)}
      className="p-1 rounded-md bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700 disabled:opacity-40"
    >
      <Icon size={14} />
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <ol data-testid="why-line" aria-label={t('coach.line.label')} className="flex flex-wrap gap-x-1 gap-y-0.5 text-xs font-mono list-none p-0 m-0">
        {moves.map((m) => (
          <li key={m.index}>
            {m.prefix && <span className="text-ink-500 dark:text-ink-400">{m.prefix}</span>}
            <button
              type="button"
              data-testid={`why-line-move-${m.index}`}
              aria-current={current === m.index + 1 ? 'step' : undefined}
              onClick={() => setPly(m.index + 1)}
              className={`px-0.5 rounded font-bold bg-transparent ${current === m.index + 1 ? 'bg-brand-600 text-white' : 'text-brand-700 dark:text-brand-300 hover:underline'}`}
            >
              {figurine(m.san)}
            </button>
          </li>
        ))}
      </ol>

      <div
        data-testid="mini-board"
        data-ply={current}
        data-fen={fens[current]}
        role="img"
        aria-label={played ? t('coach.line.after', { san: played.san }) : t('coach.line.afterYours')}
        className="relative rounded-md overflow-hidden border-2 border-[#2e1b0e] shadow-sm"
        style={{ width: size, height: size }}
      >
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
          {rows.flatMap((row, ri) =>
            row.map((cell, fi) => {
              const file = flip ? 7 - fi : fi;
              const rank = flip ? ri + 1 : 8 - ri;
              const sq = `${FILES[file]}${rank}`;
              const dark = (file + rank) % 2 === 1; // a1 oscura
              const lit = played && (played.from === sq || played.to === sq);
              return (
                <div key={sq} className={`relative ${dark ? 'sq-wood-dark' : 'sq-wood-light'}`} style={{ '--grain': `${(file * 37 + rank * 11) % 180}deg` }}>
                  {lit && <span aria-hidden="true" className="absolute inset-0 bg-yellow-300/45" />}
                  {cell && <PieceIcon type={cell.type} color={cell.color} size={sqSize} className="relative" />}
                </div>
              );
            }),
          )}
        </div>
        <svg viewBox="0 0 8 8" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          {played && <Arrow id={`a-${uid}`} from={played.from} to={played.to} flip={flip} color={played.color === line.startColor ? '#dc2626' : '#2563eb'} />}
          {next && <Arrow id={`n-${uid}`} from={next.from} to={next.to} flip={flip} color="#dc2626" dashed />}
        </svg>
      </div>

      <div className="flex items-center gap-1" role="group" aria-label={t('coach.line.nav')}>
        {nav(t('coach.line.first'), 'mini-first', ChevronFirst, 0, current === 0)}
        {nav(t('coach.line.prev'), 'mini-prev', ChevronLeft, current - 1, current === 0)}
        {nav(t('coach.line.next'), 'mini-next', ChevronRight, current + 1, current >= last)}
        {nav(t('coach.line.last'), 'mini-last', ChevronLast, last, current >= last)}
        <span className="text-[11px] text-ink-500 dark:text-ink-400 ml-1 tabular-nums">{current}/{last}</span>
      </div>
    </div>
  );
}
