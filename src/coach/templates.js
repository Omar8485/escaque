// Plantillas deterministas de los coaches (docs/COACH_DESIGN.md §7.1): el coach funciona completo
// sin LLM. Usan solo hechos del CoachRequest y escriben las jugadas como [[SAN]], igual que el
// LLM, para que la UI las renderice del mismo modo.

import { getT, isLang, lookup } from '../i18n/core.js';

// Los textos viven en los diccionarios (src/i18n/es.js y en.js, espacio `tpl.*` y las voces en
// `voice.<coach>.*`). Cada función recibe el idioma; las que reciben un CoachRequest lo leen de
// `req.locale` ('es' por defecto). Ver docs/I18N.md.

/** @typedef {'es'|'en'} Lang */
const langOf = (x) => (isLang(x) ? x : 'es');

/** Etiqueta de clasificación en el idioma ("Error grave" / "Blunder"); los valores internos siguen en inglés. */
export function labelText(label, lang = 'es') {
  return getT(langOf(lang))(`moveLabel.${label}`);
}

/** Etiquetas en español (compatibilidad). */
export const LABEL_ES = Object.freeze(Object.fromEntries(['Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'].map((l) => [l, labelText(l, 'es')])));

/** Expresión del avatar de Alfred según el tono del comentario (contrato §5.1). */
export function moodForTone(tone) {
  return { elogio: 'feliz', neutral: 'neutral', advertencia: 'pensativo', alerta: 'preocupado' }[tone] ?? 'neutral';
}

/** Nombre de pieza ("caballo" / "knight"). @param {'p'|'n'|'b'|'r'|'q'|'k'} piece */
export function pieceName(piece, lang = 'es') {
  return getT(langOf(lang))(`tpl.piece.${piece}`);
}

/** Nombres de pieza en español (compatibilidad). */
export const PIECE_ES = Object.freeze(Object.fromEntries(['p', 'n', 'b', 'r', 'q', 'k'].map((p) => [p, pieceName(p, 'es')])));

// Valores de `coachFacts.evalLabel*` (enum del contrato, en español) → clave de texto.
const EVAL_KEYS = Object.freeze({
  ganando: 'winning',
  'ventaja clara': 'clearAdvantage',
  'ligera ventaja': 'slightAdvantage',
  igualdad: 'equal',
  'ligera desventaja': 'slightDisadvantage',
  'desventaja clara': 'clearDisadvantage',
  perdiendo: 'losing',
});
const evalText = (label, t) => (EVAL_KEYS[label] ? t(`tpl.eval.${EVAL_KEYS[label]}`) : label);

/**
 * Frases de un coach en un idioma (por defecto, Alfred en español). Los datos de ajedrez son los
 * mismos; cambia cómo lo dicen.
 * @returns {{praise: string[], great: string, retry: string, invite: string, idle: string, analyzing: string, wrong: string, keepGoing: string}}
 */
const voices = new Map();
export function coachVoice(coachId, lang = 'es') {
  const l = langOf(lang);
  const id = lookup(l, `voice.${coachId}.great`) ? coachId : 'alfred';
  const cacheKey = `${id}|${l}`;
  if (!voices.has(cacheKey)) voices.set(cacheKey, buildVoice(id, l));
  return voices.get(cacheKey);
}

function buildVoice(id, l) {
  const t = getT(l);
  const k = (name) => t(`voice.${id}.${name}`);
  return Object.freeze({
    praise: lookup(l, `voice.${id}.praise`),
    great: k('great'),
    retry: k('retry'),
    invite: k('invite'),
    idle: k('idle'),
    analyzing: k('analyzing'),
    wrong: k('wrong'),
    keepGoing: k('keepGoing'),
  });
}

/** Elogio de plantilla (rotación estable por ply). */
export function praiseText(moveSan, ply = 0, coachId = 'alfred', lang = 'es') {
  const list = coachVoice(coachId, lang).praise;
  return list[Math.abs(ply) % list.length].replace('{san}', moveSan);
}

/** "caballo de e5 y alfil de c4" / "knight on e5 and bishop on c4". */
function piecesList(targets, t) {
  return targets.map((x) => t('tpl.pieceAt', { piece: t(`tpl.piece.${x.piece}`), square: x.square })).join(t('tpl.and'));
}

/** Frase con la consecuencia concreta de la refutación (o null si no hay hechos). */
export function refutationSentence(refutation, lang = 'es') {
  if (!refutation) return null;
  const t = getT(langOf(lang));
  const { san, motif, targets = [], mateIn, captures, to } = refutation;
  if (motif === 'mate') return mateIn ? t('tpl.ref.mateIn', { n: mateIn, san }) : t('tpl.ref.mate', { san });
  if (motif === 'ataque_doble' && targets.length) return t('tpl.ref.double', { san, pieces: piecesList(targets, t) });
  if (motif === 'jaque_y_ataque') {
    const loose = targets.filter((x) => !x.defended);
    return t('tpl.ref.checkAttack', { san, pieces: piecesList(loose.length ? loose : targets, t) });
  }
  if (captures) return t('tpl.ref.captures', { san, piece: t(`tpl.piece.${captures}`), square: to });
  if (motif === 'captura') return t('tpl.ref.winsMaterial', { san });
  return t('tpl.ref.reply', { san });
}

/**
 * Texto de plantilla para una jugada del jugador (move_feedback / why), en `req.locale`.
 * @param {object} req  CoachRequest de la jugada
 * @param {{retryOf?: boolean, detailed?: boolean}} [opts]
 *   `retryOf`: la jugada corrige un intento retrocedido; `detailed`: respuesta a "¿Por qué?"
 * @returns {{text: string, tone: 'elogio'|'neutral'|'advertencia'|'alerta'}}
 */
export function feedbackTemplate(req, { retryOf = false, detailed = false } = {}) {
  const lang = langOf(req.locale);
  const t = getT(lang);
  const c = req.classification;
  const f = req.coachFacts ?? {};
  const san = c.moveSan ?? c.moveUci;
  const good = c.label === 'Best' || c.label === 'Excellent';

  const voice = coachVoice(req.coach, lang);
  if (retryOf && (good || f.greatMove)) return { text: voice.retry.replace('{san}', san), tone: 'elogio' };
  if (f.greatMove) return { text: voice.great.replace('{san}', san), tone: 'elogio' };
  if (good) return { text: praiseText(san, req.game?.ply, req.coach, lang), tone: 'elogio' };
  if (c.label === 'Good' && !detailed) return { text: t('tpl.fb.good', { san }), tone: 'neutral' };

  const parts = [];
  if (f.mateAllowed) parts.push(t('tpl.fb.mateAllowed'));
  else if (f.mateMissed) parts.push(t('tpl.fb.mateMissed'));
  else if (c.label === 'Blunder') parts.push(t('tpl.fb.blunder', { san }));
  else if (c.label === 'Mistake') parts.push(t('tpl.fb.mistake', { san }));
  else if (c.label === 'Inaccuracy') parts.push(t('tpl.fb.inaccuracy', { san }));
  else parts.push(t('tpl.fb.okButBetter', { san }));

  const ref = refutationSentence(req.refutation, lang);
  if (ref && (c.label !== 'Good' || detailed)) parts.push(ref);
  const hanging = (req.hanging ?? []).filter((h) => h.confirmedByEngine && h.square !== req.refutation?.to);
  if (detailed && hanging.length) parts.push(t('tpl.hanging', { pieces: piecesList(hanging, t) }));
  if (detailed && f.evalLabelBefore && f.evalLabelAfter && f.evalLabelBefore !== f.evalLabelAfter) {
    parts.push(t('tpl.fb.evalShift', { before: evalText(f.evalLabelBefore, t), after: evalText(f.evalLabelAfter, t) }));
  }
  if (f.stillWinning) parts.push(t('tpl.stillWinning'));
  if (req.policy?.revealBestMove && c.bestMoveSan) parts.push(t('tpl.fb.bestWas', { san: c.bestMoveSan }));
  if (req.policy?.offerTakeback) parts.push(voice.invite);

  const tone = req.policy?.offerTakeback || c.label === 'Mistake' || c.label === 'Blunder' ? 'alerta' : c.label === 'Inaccuracy' ? 'advertencia' : 'neutral';
  return { text: parts.join(' '), tone };
}

// ---------- "¿Por qué?" (v1.1) ----------

const LOOSE_FIRST = (targets) => (targets.filter((x) => !x.defended).length ? targets.filter((x) => !x.defended) : targets);
const WHY_MECHANISM = {
  ataque_doble: (r, t) => (r.targets?.length ? t('tpl.why.doubleTargets', { san: r.san, pieces: piecesList(r.targets, t) }) : t('tpl.why.double', { san: r.san })),
  jaque_y_ataque: (r, t) => (r.targets?.length ? t('tpl.why.checkTargets', { san: r.san, pieces: piecesList(LOOSE_FIRST(r.targets), t) }) : t('tpl.why.check', { san: r.san })),
  captura: (r, t) => (r.captures ? t('tpl.why.capture', { san: r.san, piece: t(`tpl.piece.${r.captures}`), square: r.to }) : t('tpl.why.material', { san: r.san })),
  mate: (r, t) => t('tpl.why.mate', { san: r.san }),
};
const LESSON_KEYS = { ataque_doble: 'double', jaque_y_ataque: 'check', captura: 'capture', mate: 'mate' };

/** Lo que pierdes en la línea, en palabras ("un caballo y un peón" o "≈ 3 peones de material"). */
export function lossText(line, net, lang = 'es') {
  const t = getT(langOf(lang));
  const loss = -(line?.materialSwing ?? 0);
  if (loss <= 0) return null;
  const sum = net.reduce((a, p) => a + ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 })[p], 0);
  if (net.length && net.length <= 2 && sum === loss) return net.map((p) => t(`tpl.article.${p}`)).join(t('tpl.and'));
  return t('tpl.materialPawns', { n: loss });
}

/**
 * Explicación de plantilla para "¿Por qué?": NO repite el comentario inicial; explica el mecanismo
 * de la refutación, lo que gana el rival al final de la línea de Stockfish y una idea para la
 * próxima vez. Solo usa hechos del CoachRequest (incluido `refutationLine`), en `req.locale`.
 * @param {object} req  CoachRequest (why o move_feedback con explainWhy)
 * @param {{netLoss?: string[]}} [opts]  pérdida neta ya calculada (refutationLine.js)
 * @returns {{text: string, tone: 'advertencia'|'alerta'|'neutral'}}
 */
export function whyTemplate(req, { netLoss = [] } = {}) {
  const lang = langOf(req.locale);
  const t = getT(lang);
  const r = req.refutation;
  const line = req.refutationLine ?? null;
  const f = req.coachFacts ?? {};
  const parts = [];
  if (req.classification?.label === 'Good' || req.classification?.label === 'Excellent') {
    return { text: t('tpl.why.small'), tone: 'neutral' };
  }
  if (r) parts.push((WHY_MECHANISM[r.motif] ?? ((x) => t('tpl.ref.reply', { san: x.san })))(r, t));
  if (line?.mate) parts.push(line.mateIn ? t('tpl.why.mateLineIn', { n: line.mateIn }) : t('tpl.why.mateLine'));
  else if (line) {
    const loss = lossText(line, netLoss, lang);
    if (loss) parts.push(t('tpl.why.lose', { loss }));
    else if (f.evalLabelBefore && f.evalLabelAfter && f.evalLabelBefore !== f.evalLabelAfter) {
      parts.push(t('tpl.why.noMaterialEval', { before: evalText(f.evalLabelBefore, t), after: evalText(f.evalLabelAfter, t) }));
    } else parts.push(t('tpl.why.noMaterial'));
  }
  const hanging = (req.hanging ?? []).filter((h) => h.confirmedByEngine && h.square !== r?.to && !(r?.targets ?? []).some((x) => x.square === h.square));
  if (hanging.length) parts.push(t('tpl.hanging', { pieces: piecesList(hanging, t) }));
  if (f.stillWinning) parts.push(t('tpl.stillWinning'));
  if (r?.motif && LESSON_KEYS[r.motif]) parts.push(t(`tpl.lesson.${LESSON_KEYS[r.motif]}`));
  if (!parts.length) parts.push(t('tpl.why.noRefutation'));
  const c = req.classification;
  const tone = c?.label === 'Mistake' || c?.label === 'Blunder' || f.mateAllowed ? 'alerta' : c?.label === 'Inaccuracy' ? 'advertencia' : 'neutral';
  return { text: parts.join(' '), tone };
}

/** Mensaje inmediato al interrumpir, antes de tener los hechos completos o el LLM. */
export const interruptText = (lang = 'es') => getT(langOf(lang))('tpl.interrupt');
export const INTERRUPT_TEXT = interruptText('es');

/**
 * Pista de plantilla (niveles 1–2), en `req.locale`. El nivel 3 es la flecha.
 * @param {object} req  CoachRequest de tipo hint
 */
export function hintTemplate(req) {
  const t = getT(langOf(req.locale));
  const h = req.hintFacts ?? {};
  const idea = h.motif ? t('tpl.hint.motif', { idea: t(`tpl.motifIdea.${h.motif}`) }) : t('tpl.hint.generic');
  if (req.policy?.hintLevel >= 2 && h.bestPiece) return `${idea} ${t('tpl.hint.piece', { piece: t(`tpl.piece.${h.bestPiece}`), square: h.bestFrom })}`;
  const loose = req.opponentLoose ?? [];
  if (!h.motif && loose.length) return `${idea} ${t('tpl.hint.loose', { piece: t(`tpl.piece.${loose[0].piece}`), square: loose[0].square })}`;
  return idea;
}

// ---------- Notación ----------

const FIGURINES = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };

/** SAN con figuras: "Nxe5" → "♘xe5" (peones y enroques igual). */
export function figurine(san) {
  return san.replace(/^[KQRBN]/, (p) => FIGURINES[p]).replace(/=([QRBN])/, (_, p) => `=${FIGURINES[p]}`);
}

/**
 * Parte un texto con [[SAN]] en segmentos para renderizar.
 * @param {string} text
 * @returns {({type:'text', value:string} | {type:'move', san:string})[]}
 */
export function segmentText(text) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'move', san: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Texto plano (sin corchetes, con figuras). */
export function plainText(text) {
  return segmentText(text)
    .map((s) => (s.type === 'move' ? figurine(s.san) : s.value))
    .join('');
}
