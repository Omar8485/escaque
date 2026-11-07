// Pantallas que no se ven al abrir la app: se cargan bajo demanda (React.lazy) para que el bundle
// inicial solo lleve Entrenar/Análisis. Recharts va con Progreso. prefetchScreens() las descarga
// cuando el motor ya está listo y el navegador libre, así cambiar de pestaña no espera a la red (y, con el service
// worker, también quedan disponibles sin conexión).
import { lazy } from 'react';
import { afterStartup } from './startup.js';

const loaders = {
  progress: () => import('./progress/ProgressPage.jsx'),
  puzzles: () => import('./puzzles/PuzzleTrainer.jsx'),
  games: () => import('./components/MyGames.jsx'),
  avatarEditor: () => import('./components/AvatarEditor.jsx'),
  aiSettings: () => import('./components/AiSettings.jsx'),
  welcome: () => import('./welcome/Welcome.jsx'),
  premium: () => import('./account/PremiumScreen.jsx'),
};

export const ProgressPage = lazy(loaders.progress);
export const PuzzleTrainer = lazy(loaders.puzzles);
export const MyGames = lazy(loaders.games);
export const AvatarEditor = lazy(loaders.avatarEditor);
export const AiSettings = lazy(loaders.aiSettings);
export const Welcome = lazy(loaders.welcome);
export const PremiumScreen = lazy(loaders.premium);

/** Descarga las pantallas diferidas en segundo plano, cuando el motor ya está listo. */
export function prefetchScreens() {
  afterStartup(() => {
    for (const load of Object.values(loaders)) load().catch(() => {});
  });
}
