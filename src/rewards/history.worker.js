import { recognizeHistory } from './history.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ model: recognizeHistory(data.model, data.snapshot, data.now, data.timeZone) }); }
  catch { self.postMessage({ error: true }); }
};
