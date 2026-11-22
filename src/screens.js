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
  report: () => import('./report/ReportScreen.jsx'),
  welcome: () => import('./welcome/Welcome.jsx'),
  premium: () => import('./account/PremiumScreen.jsx'),
  gameSummary: () => import('./components/GameSummary.jsx'),
  engineDiagnostics: () => import('./engine/EngineDiagnostics.jsx'),
};

export const ProgressPage = lazy(loaders.progress);
export const PuzzleTrainer = lazy(loaders.puzzles);
export const MyGames = lazy(loaders.games);
export const AvatarEditor = lazy(loaders.avatarEditor);
export const AiSettings = lazy(loaders.aiSettings);
export const ReportScreen = lazy(loaders.report);
export const Welcome = lazy(loaders.welcome);
export const PremiumScreen = lazy(loaders.premium);
export const GameSummary = lazy(loaders.gameSummary);
export const EngineDiagnostics = lazy(loaders.engineDiagnostics);

/** Descarga las pantallas diferidas en segundo plano, cuando el motor ya está listo. */
export function prefetchScreens() {
  afterStartup(() => {
    for (const [name, load] of Object.entries(loaders)) {
      // La IA y el diagnóstico se evalúan solo cuando el usuario los necesita. El SW los precachea.
      if (name !== 'aiSettings' && name !== 'engineDiagnostics') load().catch(() => {});
    }
  });
}
