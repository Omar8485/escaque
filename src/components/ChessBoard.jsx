import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import ChessPiece, { PieceIcon } from './ChessPiece';
import { RotateCcw, ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, Palette } from 'lucide-react';
import { boardLayout, ASIDE_WIDTH, GAP, CONTROLS_SIDE_WIDTH, PLAYER_BAR_HEIGHT, PLAYER_BAR_GAP, SIDE_COLUMN_WIDTH } from '../utils/boardLayout';
import { DndContext, useDroppable, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useI18n } from '../i18n/useI18n';
import { usePremium } from '../premium/planStore';
import { effectiveBoardTheme, nextBoardTheme } from '../premium/gate';

// Temas del tablero. 'madera': veta dibujada con degradados CSS (index.css, .sq-wood-*);
// 'verde': el clásico verde y crema.
const BOARD_THEMES = {
  madera: {
    labelKey: 'board.wood',
    square: (isDark) => (isDark ? 'sq-wood-dark' : 'sq-wood-light'),
    frame: 'bg-[#4a2c17] border-[#2e1b0e]',
  },
  verde: {
    labelKey: 'board.green',
    square: (isDark) => (isDark ? 'bg-[#769656]' : 'bg-[#eeeed2]'),
    frame: 'bg-ink-800 border-ink-300 dark:border-ink-700',
  },
  // Temas extra de Premium (src/premium/limits.js).
  azul: {
    labelKey: 'board.blue',
    square: (isDark) => (isDark ? 'bg-[#8ca2ad]' : 'bg-[#dee3e6]'),
    frame: 'bg-[#4b6470] border-[#2f434d]',
  },
  arena: {
    labelKey: 'board.sand',
    square: (isDark) => (isDark ? 'bg-[#b58863]' : 'bg-[#f0d9b5]'),
    frame: 'bg-[#7a5236] border-[#5a3a24]',
  },
};

// Square Wrapper for Droppable
const DroppableSquare = ({ square, children, isDark, isSelected, isPossible, isLastMove = false, boardTheme = 'madera', grain = 90, onClick, onContextMenu, onMouseDown, onMouseUp }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: square,
  });

  return (
    <div
      ref={setNodeRef}
      data-square={square}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      style={boardTheme === 'madera' ? { '--grain': `${grain}deg` } : undefined}
      className={`relative flex items-center justify-center cursor-pointer w-full h-full
        ${BOARD_THEMES[boardTheme].square(isDark)}
        ${isSelected ? 'ring-4 ring-inset ring-brand-500' : ''}
        ${isOver ? 'ring-4 ring-inset ring-amber-400' : ''}
      `}
    >
      {/* Última jugada: casillas de origen y destino resaltadas (como lichess) */}
      {isLastMove && <div data-last-move="true" className="absolute inset-0 bg-[rgba(255,214,0,0.38)] pointer-events-none" />}
      {isPossible && (
        <div className={`absolute rounded-full z-10 ${children ? 'w-full h-full border-[6px] border-black/10 rounded-full' : 'w-4 h-4 bg-black/20'}`}></div>
      )}
      {children}
    </div>
  );
};

/** Piezas del selector de coronación, de la más cercana al borde a la más lejana. */
export const PROMOTION_PIECES = Object.freeze(['q', 'n', 'r', 'b']);
const PROMOTION_KEYS = { q: 'board.queen', n: 'board.knight', r: 'board.rook', b: 'board.bishop' };

/**
 * Selector de coronación (estilo lichess): una columna de 4 casillas que sale de la casilla de
 * coronación hacia el centro del tablero, sobre un velo que cancela al hacer clic. Esc cancela.
 * Posiciones en % del tablero, así funciona en ambas orientaciones y a cualquier tamaño.
 */
const PromotionPicker = ({ square, color, isWhite, onSelect, onCancel }) => {
  const { t } = useI18n();
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const col = isWhite ? file : 7 - file;
  const row = isWhite ? 8 - rank : rank - 1;
  const down = row === 0; // borde superior: la columna baja; borde inferior: sube
  return (
    <div
      data-testid="promotion-picker"
      data-promotion-square={square}
      role="dialog"
      aria-label={t('board.promotionPick')}
      className="absolute inset-0 z-40"
    >
      <div data-testid="promotion-backdrop" className="absolute inset-0 bg-black/45 cursor-pointer" onClick={onCancel} />
      {PROMOTION_PIECES.map((piece, i) => {
        const r = down ? row + i : row - i;
        return (
          <button
            key={piece}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            data-testid={`promote-${piece}`}
            aria-label={t('board.promoteTo', { piece: t(PROMOTION_KEYS[piece]) })}
            title={t(PROMOTION_KEYS[piece])}
            onClick={() => onSelect(piece)}
            className="absolute p-0 border-0 flex items-center justify-center rounded-full bg-[radial-gradient(circle,#f5f0e6_0%,#d6cbb8_70%)] hover:bg-[radial-gradient(circle,#fff_0%,#e8c99d_75%)] shadow-lg ring-2 ring-white/70 hover:ring-brand-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500 transition-[background,box-shadow] cursor-pointer"
            style={{ left: `${col * 12.5}%`, top: `${r * 12.5}%`, width: '12.5%', height: '12.5%' }}
          >
            <PieceIcon type={piece} color={color} size="88%" className="pointer-events-none" />
          </button>
        );
      })}
    </div>
  );
};

const NAV_BTN = 'p-1.5 bg-transparent hover:bg-white dark:hover:bg-ink-700 rounded-lg disabled:opacity-30 transition-all text-ink-700 dark:text-ink-200 flex items-center justify-center';
const ACTION_BTN = 'px-3 py-1.5 bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 rounded-xl text-sm font-bold hover:bg-ink-200 dark:hover:bg-ink-700 flex items-center justify-center gap-1.5 whitespace-nowrap';

/**
 * Navegación, Girar, Reiniciar y evaluación.
 * variant: 'row' (una fila debajo), 'column' (columna estrecha al lado), 'wide' (dentro de la
 * columna lateral con las barras de jugador: navegación en una fila y Girar/Reiniciar juntos).
 */
const BoardControls = ({ variant, onNavigate, canGoBack, canGoForward, onRotate, onReset, evaluation, boardTheme, onBoardThemeChange, showEval = true, showNavigation = true, resetLabel }) => {
  const { t } = useI18n();
  const premium = usePremium();
  const nextTheme = nextBoardTheme(boardTheme, premium);
  const vertical = variant !== 'row';
  return (
  <div
    data-testid="board-controls"
    className={vertical ? 'flex flex-col gap-2 flex-shrink-0' : 'flex flex-wrap items-center justify-center gap-2 w-full flex-shrink-0'}
    style={variant === 'column' ? { width: CONTROLS_SIDE_WIDTH } : undefined}
  >
    {showNavigation && <div className={`${variant === 'column' ? 'grid grid-cols-2' : 'flex items-center justify-between'} gap-1 bg-ink-100 dark:bg-ink-800 p-1 rounded-xl`}>
      <button aria-label={t('board.first')} onClick={() => onNavigate('start')} disabled={!canGoBack} className={NAV_BTN}><ChevronFirst size={18} /></button>
      <button aria-label={t('board.prev')} onClick={() => onNavigate('prev')} disabled={!canGoBack} className={NAV_BTN}><ChevronLeft size={18} /></button>
      <button aria-label={t('board.next')} onClick={() => onNavigate('next')} disabled={!canGoForward} className={NAV_BTN}><ChevronRight size={18} /></button>
      <button aria-label={t('board.last')} onClick={() => onNavigate('end')} disabled={!canGoForward} className={NAV_BTN}><ChevronLast size={18} /></button>
    </div>}
    <div className={variant === 'wide' ? 'grid grid-cols-2 gap-2' : 'contents'}>
      <button onClick={onRotate} className={ACTION_BTN}><RotateCcw size={15} /> {t('board.rotate')}</button>
      <button onClick={onReset} className={ACTION_BTN}>{resetLabel ?? t('board.reset')}</button>
    </div>
    {onBoardThemeChange && (
      <button
        data-testid="board-theme"
        data-theme={boardTheme}
        onClick={() => onBoardThemeChange(nextTheme)}
        title={t('board.change')}
        className={ACTION_BTN}
      >
        <Palette size={15} /> {t(BOARD_THEMES[nextTheme].labelKey)}
      </button>
    )}
    {showEval && (
      <div className="px-3 py-1.5 bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 rounded-xl text-sm font-bold border border-brand-100 dark:border-brand-900 text-center whitespace-nowrap">
        Eval: {evaluation || '...'}
      </div>
    )}
  </div>
  );
};

const ChessBoard = ({
  board,
  onSquareClick,
  onPieceDrop,
  selectedSquare,
  possibleMoves,
  onReset,
  evaluation,
  onNavigate,
  canGoBack,
  canGoForward,
  orientation = 'white',
  onRotate,
  // Flechas controladas desde fuera (p. ej. la pista de nivel 3 de Alfred): { start, end, color }.
  extraArrows = [],
  // Tamaño: con `fitHeight` el tablero ocupa el mayor cuadrado que cabe en el alto y ancho del
  // contenedor (descontando los controles, al lado o debajo); sin él, se ajusta al ancho con un
  // tope del 80 % del alto de la ventana (diseño apilado: pantallas estrechas o zoom alto).
  fitHeight = true,
  // Elemento a la derecha del tablero con su misma altura (la barra de evaluación).
  aside = null,
  // Barras de jugador encima y debajo del tablero (nombre, capturas, ventaja y reloj).
  topBar = null,
  bottomBar = null,
  // Última jugada { from, to }: se resaltan sus casillas.
  lastMove = null,
  // Jugada a animar { from, to, key } (la del rival): la pieza se desliza hasta su destino.
  animateMove = null,
  // Tema del tablero (BOARD_THEMES; los extra solo con Premium) y cambio desde el botón de los controles.
  boardTheme: requestedTheme = 'madera',
  onBoardThemeChange = null,
  // Puzles: sin evaluación (la delataría) ni navegación; "Reiniciar" pasa a "Reintentar".
  showEval = true,
  showNavigation = true,
  resetLabel,
  // Coronación pendiente { square, color }: muestra el selector de pieza sobre esa casilla.
  promotion = null,
  onPromotionSelect = null,
  onPromotionCancel = null,
  // Color del rey derrotado ('w' | 'b'): se inclina al terminar la partida con un ganador.
  defeatedKing = null
}) => {
  const { t } = useI18n();
  // Un tema Premium guardado se muestra como madera si el plan ya no lo incluye.
  const boardTheme = effectiveBoardTheme(requestedTheme, usePremium());
  // Textos de accesibilidad de dnd-kit (por defecto vienen en inglés) en el idioma activo.
  const dndAccessibility = {
    screenReaderInstructions: { draggable: t('board.dragInstructions') },
    announcements: {
      onDragStart: ({ active }) => t('board.dragStart', { square: active.id }),
      onDragOver: ({ over }) => (over ? t('board.dragOver', { square: over.id }) : undefined),
      onDragEnd: ({ active, over }) => (over ? t('board.dragEnd', { from: active.id, to: over.id }) : t('board.dragCancel', { square: active.id })),
      onDragCancel: ({ active }) => t('board.dragCancel', { square: active.id }),
    },
  };
  // ---- Tamaño del tablero ----
  const rootRef = useRef(null);
  const [layout, setLayout] = useState({ side: 0, controls: 'below', bars: 'edges' });
  const { side } = layout;
  const hasAside = Boolean(aside);
  const barsHeight = ((topBar ? 1 : 0) + (bottomBar ? 1 : 0)) * (PLAYER_BAR_HEIGHT + PLAYER_BAR_GAP);
  const columnBars = layout.bars === 'column';
  const controls = (variant) => (
    <BoardControls
      variant={variant}
      onNavigate={onNavigate}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onRotate={onRotate}
      onReset={onReset}
      evaluation={evaluation}
      boardTheme={boardTheme}
      onBoardThemeChange={onBoardThemeChange}
      showEval={showEval}
      showNavigation={showNavigation}
      resetLabel={resetLabel}
    />
  );
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const compute = () => {
      const { width, height } = el.getBoundingClientRect();
      const next = boardLayout({ width, height, fitHeight, hasAside, viewportHeight: window.innerHeight, barsHeight });
      setLayout((prev) => (prev.side === next.side && prev.controls === next.controls && prev.bars === next.bars ? prev : next));
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [fitHeight, hasAside, barsHeight]);

  // Logic to render from white or black perspective
  const isWhite = orientation === 'white';
  const renderRows = isWhite ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const renderCols = isWhite ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const [activeId, setActiveId] = useState(null);
  const [activePiece, setActivePiece] = useState(null);

  // Arrow state
  const [arrows, setArrows] = useState([]); // Array of { start: 'e2', end: 'e4', color: 'blue' }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragStart = (event) => {
    const { active } = event;
    setActiveId(active.id);
    setActivePiece(active.data.current);
    // Clear arrows on move
    setArrows([]);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    setActivePiece(null);

    if (over && active.id !== over.id) {
        if (typeof onPieceDrop === 'function') {
             onPieceDrop(active.id, over.id);
        }
        // Also clear arrows
        setArrows([]);
    }
  };

  // --- Arrow Logic ---
  // Flechas con clic derecho: ver handleMouseDown/handleMouseUp más abajo.

  // We need to override simple click for clearing arrows
  const handleSquareLeftClick = (r, c) => {
      setArrows([]); // Clear arrows on left click
      onSquareClick(r, c);
  };

  // Refined Arrow Drawing: Mouse Down/Enter/Up
  // Since we have DnD, we must be careful not to conflict.
  // Right click usually doesn't trigger DnD.
  // We'll attach handlers to a wrapper.

  const [rightClickStart, setRightClickStart] = useState(null);

  const handleMouseDown = (e, square) => {
      if (e.button === 2) { // Right click
          setRightClickStart(square);
      }
  };

  const handleMouseUp = (e, square) => {
      if (e.button === 2 && rightClickStart) {
          if (rightClickStart !== square) {
              // Draw Arrow
              const color = e.shiftKey ? '#d32f2f' : '#1565c0'; // Red : Blue
              const newArrow = { start: rightClickStart, end: square, color };
              setArrows(prev => {
                  // Toggle logic matches standard chess GUIs
                  const exists = prev.find(a => a.start === newArrow.start && a.end === newArrow.end);
                  if (exists) return prev.filter(a => a !== exists);
                  return [...prev, newArrow];
              });
          } else {
              // Clicked same square (Circle - optional but good)
              // For now just ignore or maybe add circle support? Requirement says "flechas".
          }
          setRightClickStart(null);
      }
  };

  // Helper to calculate arrow coords
  const getSquareCenter = (sq) => {
      // 0-7 based on square name (e.g. "a1" -> col 0, row 7 if white bottom)
      // BUT our grid is responsive. We should use percentages.
      const colFile = sq.charCodeAt(0) - 97; // 0-7
      const rowRank = parseInt(sq[1]) - 1; // 0-7 (1 is index 0)

      // If white: a is left (0%), 1 is bottom (87.5% center? No, 1 is row 7 index visually)
      // row 0 is top (rank 8). row 7 is bottom (rank 1).
      // x = (colFile + 0.5) * 12.5
      // y = (7 - rowRank + 0.5) * 12.5 (if white)

      const x = (isWhite ? colFile : 7 - colFile) * 12.5 + 6.25;
      const y = (isWhite ? 7 - rowRank : rowRank) * 12.5 + 6.25;

      return { x, y };
  };

  return (
    <DndContext accessibility={dndAccessibility} sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div
      ref={rootRef}
      data-controls={layout.controls}
      data-bars={layout.bars}
      className={`w-full flex items-center justify-center gap-3 ${fitHeight ? 'h-full min-h-0' : ''} ${layout.controls === 'below' ? 'flex-col' : 'flex-row'}`}
    >
      <div className="flex flex-col flex-shrink-0" style={{ gap: PLAYER_BAR_GAP }}>
      {topBar && !columnBars && <div style={{ width: side || undefined, height: PLAYER_BAR_HEIGHT }}>{topBar}</div>}
      <div className="flex items-center">
      <div
        data-testid="board-frame"
        data-board-theme={boardTheme}
        className={`aspect-square p-2 rounded-2xl shadow-2xl border-4 relative flex-shrink-0 ${BOARD_THEMES[boardTheme].frame}`}
        style={{ width: side || undefined, height: side || undefined, visibility: side ? 'visible' : 'hidden' }}
        onContextMenu={(e) => e.preventDefault()} // Global prevent context menu on board
      >
        <div className="grid grid-cols-8 grid-rows-8 w-full h-full border-2 border-ink-700 relative z-10">
          {renderRows.map((r) =>
            renderCols.map((c) => {
              // Get actual piece from the board state (which is always white-top-left indexed 0,0 to 7,7)
              // board[0][0] is a8. board[7][7] is h1.
              const piece = board[r][c];

              const file = String.fromCharCode(97 + c);
              const rank = 8 - r;
              const square = `${file}${rank}`;

              // Color logic depends on coordinates sum
              const isDark = (r + c) % 2 === 1;
              const isSelected = selectedSquare === square;
              const isPossible = possibleMoves.includes(square);
              const isLastMove = Boolean(lastMove && (square === lastMove.from || square === lastMove.to));
              const anim = animateMove && square === animateMove.to ? animateMove : null;
              let animStyle;
              if (anim) {
                // Desplazamiento en casillas desde el origen; 1 casilla = 100 % / 0,93 del tamaño de la pieza.
                const pos = (sq) => {
                  const f = sq.charCodeAt(0) - 97;
                  const r = Number(sq[1]);
                  return { col: isWhite ? f : 7 - f, row: isWhite ? 8 - r : r - 1 };
                };
                const a = pos(anim.from);
                const b = pos(anim.to);
                animStyle = { '--dx': `${((a.col - b.col) * 100) / 0.93}%`, '--dy': `${((a.row - b.row) * 100) / 0.93}%` };
              }

              return (
                <DroppableSquare
                    key={square}
                    square={square}
                    isDark={isDark}
                    isSelected={isSelected}
                    isPossible={isPossible}
                    isLastMove={isLastMove}
                    boardTheme={boardTheme}
                    grain={(isDark ? 90 : 0) + (((r * 7 + c * 3) % 9) - 4)}
                    onClick={() => handleSquareLeftClick(r, c)}
                    onContextMenu={(e) => e.preventDefault()}
                    onMouseDown={(e) => handleMouseDown(e, square)}
                    onMouseUp={(e) => handleMouseUp(e, square)}
                >
                  {/* La pieza recibe el puntero para poder arrastrarla (dnd-kit); clic derecho y
                      clic normal burbujean hasta la casilla (flechas y selección). */}
                  {piece && (
                    <div
                      key={anim ? `anim-${anim.key}` : 'static'}
                      data-animating={anim ? 'true' : undefined}
                      className={`w-[93%] h-[93%] ${anim ? 'z-[25] piece-slide' : 'z-20'}`}
                      style={animStyle}
                    >
                      {/* Rey derrotado: se inclina hacia la izquierda (transición en index.css, .king-tilt). */}
                      <div
                        data-king={piece.type === 'k' ? piece.color : undefined}
                        data-defeated={piece.type === 'k' && piece.color === defeatedKing ? 'true' : undefined}
                        className={`w-full h-full ${piece.type === 'k' ? 'king-tilt' : ''} ${piece.type === 'k' && piece.color === defeatedKing ? 'king-defeated' : ''}`}
                      >
                        <ChessPiece type={piece.type} color={piece.color} square={square} />
                      </div>
                    </div>
                  )}

                  {/* Rank/File Labels - Adjust position based on orientation if desired, but standard is corners */}
                  {(isWhite ? c === 0 : c === 7) && (
                    <span className={`absolute top-0.5 left-0.5 text-[8px] sm:text-[10px] md:text-xs font-bold ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                      {rank}
                    </span>
                  )}
                  {(isWhite ? r === 7 : r === 0) && (
                    <span className={`absolute bottom-0.5 right-0.5 text-[8px] sm:text-[10px] md:text-xs font-bold ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                      {file}
                    </span>
                  )}
                </DroppableSquare>
              );
            })
          )}
          {promotion && onPromotionSelect && (
            <PromotionPicker
              square={promotion.square}
              color={promotion.color}
              isWhite={isWhite}
              onSelect={onPromotionSelect}
              onCancel={onPromotionCancel ?? (() => {})}
            />
          )}
        </div>

        {/* Arrow Layer */}
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-30 p-2" viewBox="0 0 100 100" preserveAspectRatio="none">
            {[...arrows, ...extraArrows].map((arrow, i) => {
                const start = getSquareCenter(arrow.start);
                const end = getSquareCenter(arrow.end);
                // Math for arrow head
                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                const headLen = 3;

                // Shorten line so it doesn't overlap head
                const lineEnd = {
                    x: end.x - headLen * Math.cos(angle),
                    y: end.y - headLen * Math.sin(angle)
                };

                return (
                    <g key={i} opacity="0.8">
                        <line x1={start.x} y1={start.y} x2={lineEnd.x} y2={lineEnd.y} stroke={arrow.color} strokeWidth="1.2" strokeLinecap="round" />
                        <polygon
                            points={`${end.x},${end.y} ${end.x - headLen * Math.cos(angle - Math.PI / 6)},${end.y - headLen * Math.sin(angle - Math.PI / 6)} ${end.x - headLen * Math.cos(angle + Math.PI / 6)},${end.y - headLen * Math.sin(angle + Math.PI / 6)}`}
                            fill={arrow.color}
                        />
                    </g>
                );
            })}
        </svg>

      </div>
      {aside && (
        <div className="flex-shrink-0" style={{ width: ASIDE_WIDTH, height: side || undefined, marginLeft: GAP }}>
          {aside}
        </div>
      )}
      </div>
      {bottomBar && !columnBars && <div style={{ width: side || undefined, height: PLAYER_BAR_HEIGHT }}>{bottomBar}</div>}
      </div>

      <DragOverlay>
        {activeId && activePiece ? (
            <div className="pointer-events-none cursor-grabbing" style={{ width: Math.max(32, (side - 28) / 8), height: Math.max(32, (side - 28) / 8) }}>
                <ChessPiece type={activePiece.type} color={activePiece.color} square={activeId} />
            </div>
        ) : null}
      </DragOverlay>

      {columnBars ? (
        // Columna lateral (estilo lichess): rival arriba, controles, tú abajo; misma altura que el tablero.
        <div data-testid="side-column" className="flex flex-col justify-between gap-2 flex-shrink-0" style={{ width: SIDE_COLUMN_WIDTH, height: side || undefined }}>
          {topBar && React.cloneElement(topBar, { variant: 'column', position: 'top' })}
          {controls('wide')}
          {bottomBar && React.cloneElement(bottomBar, { variant: 'column', position: 'bottom' })}
        </div>
      ) : (
        controls(layout.controls === 'side' ? 'column' : 'row')
      )}
    </div>
    </DndContext>
  );
};

export default ChessBoard;
