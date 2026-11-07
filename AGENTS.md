# AGENTS.md

Instrucciones para agentes de código (Codex y otros) en este repositorio.

- **Tareas y reglas:** lee **`codex_task.md`**. Ahí están las tareas pendientes, las reglas obligatorias y cómo se verifica cada entrega.
- **Contexto técnico:** `docs/HANDOFF.md` (estado y mapa del código), `docs/COACH_DESIGN.md` (diseño del coach) y `docs/I18N.md` (idiomas).
- **Antes de abrir un PR**, deben pasar:
  ```bash
  npm ci
  npm test
  npx eslint . --max-warnings 0
  npx vite build
  ```
- **Convenciones:** JavaScript + JSDoc; textos visibles solo con `t()` y claves en `src/i18n/es.js` y `src/i18n/en.js`; datos del usuario en IndexedDB (`src/storage/db.js`); SAN en inglés; commits en español con prefijo convencional; una tarea por rama `codex/<id>-<slug>` y un PR contra `main`.
