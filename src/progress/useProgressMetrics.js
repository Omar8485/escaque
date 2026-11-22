import { useEffect, useState } from 'react';

/** Worker por snapshot/filtro: terminarlo cancela cálculos que ya no interesan. */
export function useProgressMetrics(data, filters) {
  const key = JSON.stringify(filters);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (data.loading || data.error) return;
    const worker = new Worker(new URL('./metrics.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: response }) => setResult({ input: data, key, ...response });
    worker.onerror = () => setResult({ input: data, key, error: true });
    worker.postMessage({ ...data, filters: JSON.parse(key), now: Date.now() });
    return () => worker.terminate();
  }, [data, key]);
  const current = result?.input === data && result?.key === key ? result : null;
  return { metrics: current?.metrics ?? null, error: data.error || current?.error, loading: data.loading || (!current && !data.error) };
}
