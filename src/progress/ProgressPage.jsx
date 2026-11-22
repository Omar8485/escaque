import React from 'react';
import ProgressScreen from './ProgressScreen';
import TrainingPlan from './TrainingPlan';
import { useProgressData } from './useProgressData';

/** Pestaña Progreso: datos + pantalla + plan. Se carga bajo demanda (src/screens.js), con Recharts. */
export default function ProgressPage({ onAction, ...props }) {
  const data = useProgressData();
  return <ProgressScreen data={data} {...props} plan={(metrics) => <TrainingPlan metrics={metrics} resources={data} onAction={onAction} />} />;
}
