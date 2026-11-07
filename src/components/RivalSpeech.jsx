import React from 'react';
import { useI18n } from '../i18n/useI18n';

// Globo de diálogo del rival junto a su avatar (lo aloja PlayerBar).
// - variant 'row' (barra encima/debajo del tablero): flota sobre la barra, a la derecha del
//   avatar y antes del reloj, centrado en vertical; como mucho 3 líneas, así solo puede asomar
//   sobre el marco del tablero, nunca sobre las casillas.
// - variant 'column' (columna lateral estilo lichess): bloque bajo el nombre (o encima si la
//   barra es la de abajo), a lo ancho de la columna.
// La región `role="status"` existe siempre para que los lectores de pantalla anuncien cada frase.
// Clic (o Enter) en el globo lo cierra. Animaciones en index.css (.rival-speech-in/out).
const RivalSpeech = ({ speech, onDismiss, name, variant = 'row', position = 'top', hasClock = true }) => {
  const { t } = useI18n();
  const row = variant !== 'column';
  const wrapper = row
    ? `absolute inset-y-0 left-9 ${hasClock ? 'right-[4.75rem]' : 'right-0'} z-30 flex items-center pointer-events-none`
    : // En la columna el globo flota (altura 0): no empuja las barras ni los controles, así tu
      // barra sigue alineada con el borde inferior del tablero mientras el rival habla.
      'relative w-full h-0 z-30';
  // Colita del globo apuntando al avatar.
  const tail = row
    ? '-left-[5px] top-1/2 -translate-y-1/2 border-l border-b'
    : position === 'top'
      ? 'left-3 -top-[5px] border-l border-t'
      : 'left-3 -bottom-[5px] border-r border-b';

  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="rival-speech-region" className={wrapper}>
      {speech && (
        <button
          type="button"
          key={speech.id}
          data-testid="rival-speech"
          data-event={speech.event}
          data-level={speech.level}
          onClick={onDismiss}
          title={t('rivals.clickToClose')}
          className={`${row ? 'relative' : `absolute left-0 right-0 ${position === 'top' ? 'top-1' : 'bottom-1'}`} pointer-events-auto max-w-full text-left rounded-xl px-2.5 py-1 shadow-lg border bg-white dark:bg-ink-800 border-brand-200 dark:border-ink-600 text-ink-800 dark:text-ink-100 font-medium text-[11.5px] sm:text-xs leading-[1.2] hover:border-brand-400 dark:hover:border-brand-500 ${
            speech.closing ? 'rival-speech-out' : 'rival-speech-in'
          }`}
        >
          <span aria-hidden="true" className={`absolute w-2.5 h-2.5 rotate-45 bg-white dark:bg-ink-800 border-brand-200 dark:border-ink-600 ${tail}`} />
          <span className="sr-only">{t('rivals.says', { name })} </span>
          <span className={`relative block ${row ? 'line-clamp-3' : ''}`}>{speech.text}</span>
        </button>
      )}
    </div>
  );
};

export default RivalSpeech;
