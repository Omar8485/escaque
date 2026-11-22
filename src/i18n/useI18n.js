import { useContext } from 'react';
import { I18nContext } from './context.js';

/** Idioma activo, elección del usuario y traductor `t`. @returns {import('./context.js').I18nValue} */
export const useI18n = () => useContext(I18nContext);
