import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';

// Hoja inferior (bottom sheet) común de la ronda M (diseño móvil interno §3): sube desde abajo, encima
// de la barra inferior, respeta el área segura y se desplaza por dentro si su contenido es largo.
// `footer` queda fijo abajo y siempre visible (p. ej. Retroceder / ¿Por qué? / Seguir).
// Se cierra con Esc, con la X o tocando fuera (si `dismissible`).

/**
 * @param {object} p
 * @param {boolean} p.open
 * @param {() => void} p.onClose
 * @param {React.ReactNode} [p.title]        título (también da nombre accesible al diálogo)
 * @param {string} [p.testId]                data-testid de la hoja
 * @param {React.ReactNode} [p.footer]       zona fija al pie
 * @param {boolean} [p.dismissible=true]     false: ni Esc ni tocar fuera la cierran (sin X)
 * @param {boolean} [p.backdrop=true]        velo detrás (modal); false deja ver y tocar lo de atrás
 * @param {string} [p.maxHeight='75dvh']     alto máximo
 * @param {'center'|'end'} [p.align='center'] 'end': pegada a la derecha (teléfono en horizontal,
 *        para no tapar un tablero que está a la izquierda)
 * @param {React.ReactNode} p.children
 */
export default function BottomSheet({ open, onClose, title = null, testId, footer = null, dismissible = true, backdrop = true, maxHeight = '75dvh', align = 'center', children }) {
  const { t } = useI18n();
  const titleId = useId();
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    boxRef.current?.focus({ preventScroll: true });
    if (!dismissible) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);

  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-[70] flex flex-col justify-end ${backdrop ? '' : 'pointer-events-none'}`}>
      {backdrop && (
        <div
          data-testid={testId ? `${testId}-backdrop` : undefined}
          aria-hidden="true"
          className="absolute inset-0 bg-ink-900/40 dark:bg-black/60"
          onClick={() => dismissible && onClose()}
        />
      )}
      <section
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={backdrop ? 'true' : undefined}
        aria-labelledby={title ? titleId : undefined}
        data-testid={testId}
        style={{ maxHeight }}
        className={`relative pointer-events-auto w-full flex flex-col rounded-t-3xl ${align === 'end' ? 'max-w-[min(32rem,58vw)] ml-auto mr-0' : 'max-w-lg mx-auto'} bg-white dark:bg-ink-900 border border-b-0 border-ink-200 dark:border-ink-700 shadow-2xl outline-none pb-[env(safe-area-inset-bottom,0px)]`}
      >
        <div aria-hidden="true" className="mx-auto mt-2 mb-1 h-1.5 w-10 rounded-full bg-ink-200 dark:bg-ink-700 flex-shrink-0" />
        {(title || dismissible) && (
          <div className="flex items-center justify-between gap-2 px-4 pb-1 flex-shrink-0">
            {title ? (
              <h2 id={titleId} className="text-base font-black text-ink-800 dark:text-ink-100 truncate">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {dismissible && (
              <button
                type="button"
                data-testid={testId ? `${testId}-close` : undefined}
                aria-label={t('common.close')}
                onClick={onClose}
                className="w-11 h-11 p-0 flex items-center justify-center rounded-xl bg-transparent text-ink-500 dark:text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-3">{children}</div>
        {footer && <div className="flex-shrink-0 px-4 pt-2 pb-3 border-t border-ink-100 dark:border-ink-800">{footer}</div>}
      </section>
    </div>
  );
}
