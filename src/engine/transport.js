/**
 * Canal UCI independiente del motor. Cada fábrica debe crear una sesión nueva.
 * @typedef {object} UciTransport
 * @property {(line: string) => void} send
 * @property {(listener: (line: string) => void) => (() => void)} onLine
 * @property {(listener: (error: {message?: string}) => void) => (() => void)} onError
 * @property {() => void} terminate
 */

/**
 * Transporte actual: Web Worker clásico. Conserva createWorker para las pruebas existentes.
 * La creación sigue siendo síncrona; un bridge nativo asíncrono debe encolar sus comandos.
 * @param {{url?: string, createWorker?: () => Worker}} options
 * @returns {UciTransport}
 */
export function createWorkerTransport({ url, createWorker = () => new Worker(url) } = {}) {
  const worker = createWorker();
  const lines = new Set();
  const errors = new Set();
  let active = true;
  worker.onmessage = (event) => {
    if (!active) return;
    for (const raw of String(event.data).split('\n')) {
      const line = raw.trim();
      if (line) for (const listener of lines) listener(line);
    }
  };
  worker.onerror = (error) => {
    if (active) for (const listener of errors) listener(error);
  };
  const subscribe = (listeners, listener) => {
    if (active) listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    send(line) { if (active) worker.postMessage(line); },
    onLine: (listener) => subscribe(lines, listener),
    onError: (listener) => subscribe(errors, listener),
    terminate() {
      if (!active) return;
      active = false;
      lines.clear();
      errors.clear();
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    },
  };
}
