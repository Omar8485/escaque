import { computeProgress } from './metrics.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ metrics: computeProgress(data) }); }
  catch { self.postMessage({ error: true }); }
};
