import React from 'react';
import { useI18n } from '../i18n/useI18n';

function StockfishPanel({ hiddenBest, bestMoveSan, evaluationText }) {
  const { t } = useI18n();
  return (
<div className="bg-ink-900 text-white p-6 rounded-[2rem] relative overflow-hidden flex-shrink-0">
                  <h3 className="text-sm font-black mb-2 z-10 relative uppercase tracking-wider text-brand-400">Stockfish 17.1</h3>
                  <div className="grid grid-cols-2 gap-4 z-10 relative mt-2">
                     <div className="bg-white/10 p-3 rounded-xl">
                        <p className="text-[10px] text-ink-400 font-bold uppercase">{t('engine.bestMove')}</p>
                        {/* Con Alfred, en tu turno la mejor jugada se oculta: para eso están las pistas. */}
                        {hiddenBest ? (
                            <p data-testid="best-move" data-hidden="true" data-san={bestMoveSan ?? ''} className="text-xs text-ink-400 mt-1">{t('engine.hiddenBest')}</p>
                        ) : (
                            <p data-testid="best-move" className="text-lg font-mono text-amber-300 truncate">{bestMoveSan || "..."}</p>
                        )}
                     </div>
                     <div className="bg-white/10 p-3 rounded-xl">
                        <p className="text-[10px] text-ink-400 font-bold uppercase">{t('engine.evaluation')}</p>
                        <p data-testid="evaluation" className="text-lg font-mono text-white">{evaluationText || "-"}</p>
                     </div>
                  </div>
               </div>
  );
}

export default React.memo(StockfishPanel);
